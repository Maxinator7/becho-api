import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { User } from '@prisma/client';
import { prisma } from '../../common/prisma.js';
import { env, isProduction } from '../../config/env.js';
import { ApiError } from '../../common/errors/api-error.js';
import { RegisterInput, LoginInput, VerifyOtpInput } from './auth.schema.js';
import { UserRole, UserStatus, VerificationChannel } from '../../common/types/enums.js';

export interface TokenPayload {
  userId: string;
  role: UserRole;
  status: UserStatus;
}

const ACCESS_TOKEN_TTL = '15m';
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const OTP_TTL_MS = 15 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const OTP_RESEND_COOLDOWN_MS = 60 * 1000;

function publicUser(user: User) {
  return {
    id: user.id,
    displayName: user.displayName,
    email: user.email,
    phone: user.phone,
    status: user.status,
    role: user.role,
    emailVerifiedAt: user.emailVerifiedAt,
    phoneVerifiedAt: user.phoneVerifiedAt,
  };
}

export class AuthService {
  /** Signs a new access/refresh pair and persists the refresh token. */
  private static async issueTokens(user: User) {
    const payload: TokenPayload = { userId: user.id, role: user.role as UserRole, status: user.status as UserStatus };
    const accessToken = jwt.sign(payload, env.JWT_SECRET, { expiresIn: ACCESS_TOKEN_TTL });
    // jti makes every refresh token unique even when two are issued in the same second.
    const refreshToken = jwt.sign({ userId: user.id }, env.JWT_REFRESH_SECRET, {
      expiresIn: REFRESH_TOKEN_TTL_MS / 1000,
      jwtid: crypto.randomUUID(),
    });
    await prisma.refreshToken.create({
      data: { userId: user.id, token: refreshToken, expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS) },
    });
    return { accessToken, refreshToken };
  }

  /**
   * Creates a fresh OTP (invalidating older unused ones).
   * TODO(Phase 1): deliver via SMS/email provider instead of returning it.
   */
  private static async createOtp(userId: string, channel: VerificationChannel) {
    const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
    await prisma.$transaction([
      prisma.userVerification.updateMany({ where: { userId, usedAt: null }, data: { usedAt: new Date() } }),
      prisma.userVerification.create({ data: { userId, channel, code, expiresAt: new Date(Date.now() + OTP_TTL_MS) } }),
    ]);
    return code;
  }

  private static verificationResponse(channel: VerificationChannel, code: string) {
    return {
      verificationMessage: `Verification code sent via ${channel}.`,
      // Only exposed outside production until a real SMS/email provider is wired up.
      ...(isProduction ? {} : { devOtp: code }),
    };
  }

  static async register(input: RegisterInput) {
    if (input.email && (await prisma.user.findUnique({ where: { email: input.email } }))) {
      throw ApiError.badRequest('Email is already registered', 'EMAIL_TAKEN');
    }
    if (input.phone && (await prisma.user.findUnique({ where: { phone: input.phone } }))) {
      throw ApiError.badRequest('Phone number is already registered', 'PHONE_TAKEN');
    }

    const user = await prisma.user.create({
      data: {
        displayName: input.displayName,
        email: input.email || null,
        phone: input.phone || null,
        passwordHash: await bcrypt.hash(input.password, 10),
        status: UserStatus.PENDING_VERIFICATION,
        role: UserRole.USER,
      },
    });

    // India-first: prefer phone verification when a phone number is given.
    const channel = input.phone ? VerificationChannel.PHONE : VerificationChannel.EMAIL;
    const code = await this.createOtp(user.id, channel);
    const tokens = await this.issueTokens(user);

    return { user: publicUser(user), tokens, ...this.verificationResponse(channel, code) };
  }

  static async login(input: LoginInput) {
    const user = await prisma.user.findFirst({
      where: { OR: [...(input.email ? [{ email: input.email }] : []), ...(input.phone ? [{ phone: input.phone }] : [])] },
    });

    if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) {
      throw ApiError.unauthorized('Invalid email/phone or password', 'INVALID_CREDENTIALS');
    }
    if (user.status === UserStatus.BANNED) {
      throw ApiError.forbidden('Your account has been banned', 'ACCOUNT_BANNED');
    }

    return { user: publicUser(user), tokens: await this.issueTokens(user) };
  }

  /** Verifies the OTP of the authenticated user and returns fresh tokens carrying the ACTIVE status. */
  static async verifyOtp(userId: string, input: VerifyOtpInput) {
    const verification = await prisma.userVerification.findFirst({
      where: {
        userId,
        ...(input.channel ? { channel: input.channel } : {}),
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!verification || verification.attempts >= OTP_MAX_ATTEMPTS) {
      throw ApiError.badRequest('Verification code expired. Please request a new one.', 'OTP_EXPIRED');
    }

    if (verification.code !== input.code) {
      await prisma.userVerification.update({ where: { id: verification.id }, data: { attempts: { increment: 1 } } });
      throw ApiError.badRequest('Invalid verification code', 'INVALID_OTP');
    }

    const now = new Date();
    const [, user] = await prisma.$transaction([
      prisma.userVerification.update({ where: { id: verification.id }, data: { usedAt: now } }),
      prisma.user.update({
        where: { id: userId },
        data: {
          status: UserStatus.ACTIVE,
          ...(verification.channel === VerificationChannel.EMAIL ? { emailVerifiedAt: now } : { phoneVerifiedAt: now }),
        },
      }),
    ]);

    return { message: 'Account successfully verified', user: publicUser(user), tokens: await this.issueTokens(user) };
  }

  static async resendOtp(userId: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw ApiError.notFound('User not found', 'USER_NOT_FOUND');
    if (user.status !== UserStatus.PENDING_VERIFICATION) {
      throw ApiError.badRequest('Account is already verified', 'ALREADY_VERIFIED');
    }

    const last = await prisma.userVerification.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' } });
    if (last && Date.now() - last.createdAt.getTime() < OTP_RESEND_COOLDOWN_MS) {
      throw ApiError.badRequest('Please wait a minute before requesting another code', 'OTP_COOLDOWN');
    }

    const channel = user.phone ? VerificationChannel.PHONE : VerificationChannel.EMAIL;
    const code = await this.createOtp(userId, channel);
    return this.verificationResponse(channel, code);
  }

  static async refresh(refreshToken: string) {
    try {
      jwt.verify(refreshToken, env.JWT_REFRESH_SECRET);
    } catch {
      throw ApiError.unauthorized('Invalid or expired refresh token', 'INVALID_REFRESH_TOKEN');
    }

    const savedToken = await prisma.refreshToken.findUnique({ where: { token: refreshToken }, include: { user: true } });
    if (!savedToken || savedToken.revokedAt || savedToken.expiresAt < new Date()) {
      throw ApiError.unauthorized('Refresh token revoked or expired', 'TOKEN_REVOKED');
    }
    if (savedToken.user.status === UserStatus.BANNED) {
      throw ApiError.forbidden('Account banned', 'ACCOUNT_BANNED');
    }

    // Rotate: revoke the used token, issue a new pair with the user's current role/status.
    await prisma.refreshToken.update({ where: { id: savedToken.id }, data: { revokedAt: new Date() } });
    return this.issueTokens(savedToken.user);
  }

  static async logout(refreshToken?: string) {
    if (refreshToken) {
      await prisma.refreshToken.updateMany({ where: { token: refreshToken }, data: { revokedAt: new Date() } });
    }
    return { message: 'Logged out successfully' };
  }
}
