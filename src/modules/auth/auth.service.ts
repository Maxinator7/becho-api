import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../../common/prisma.js';
import { env } from '../../config/env.js';
import { ApiError } from '../../common/errors/api-error.js';
import { RegisterInput, LoginInput, VerifyOtpInput } from './auth.schema.js';
import { UserRole, UserStatus, VerificationChannel } from '../../common/types/enums.js';

export interface TokenPayload {
  userId: string;
  role: UserRole;
  status: UserStatus;
}

export class AuthService {
  private static generateTokens(payload: TokenPayload) {
    const accessToken = jwt.sign(payload, env.JWT_SECRET, { expiresIn: '15m' });
    const refreshToken = jwt.sign({ userId: payload.userId }, env.JWT_REFRESH_SECRET, { expiresIn: '30d' });
    return { accessToken, refreshToken };
  }

  static async register(input: RegisterInput) {
    // Check if email or phone is already taken
    if (input.email) {
      const existingEmail = await prisma.user.findUnique({ where: { email: input.email } });
      if (existingEmail) throw ApiError.badRequest('Email is already registered', 'EMAIL_TAKEN');
    }

    if (input.phone) {
      const existingPhone = await prisma.user.findUnique({ where: { phone: input.phone } });
      if (existingPhone) throw ApiError.badRequest('Phone number is already registered', 'PHONE_TAKEN');
    }

    const passwordHash = await bcrypt.hash(input.password, 10);

    const user = await prisma.user.create({
      data: {
        displayName: input.displayName,
        email: input.email || null,
        phone: input.phone || null,
        passwordHash,
        status: UserStatus.PENDING_VERIFICATION,
        role: UserRole.USER,
      },
    });

    // Generate mock verification code (6 digits)
    const verificationChannel = input.email ? VerificationChannel.EMAIL : VerificationChannel.PHONE;
    const otpCode = '123456'; // Default mock OTP for dev
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 mins

    await prisma.userVerification.create({
      data: {
        userId: user.id,
        channel: verificationChannel,
        code: otpCode,
        expiresAt,
      },
    });

    const tokens = this.generateTokens({
      userId: user.id,
      role: user.role as UserRole,
      status: user.status as UserStatus,
    });

    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        token: tokens.refreshToken,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
      },
    });

    return {
      user: {
        id: user.id,
        displayName: user.displayName,
        email: user.email,
        phone: user.phone,
        status: user.status,
        role: user.role,
      },
      tokens,
      verificationMessage: `Verification code sent via ${verificationChannel}. Mock code is: ${otpCode}`,
    };
  }

  static async login(input: LoginInput) {
    const user = await prisma.user.findFirst({
      where: {
        OR: [
          ...(input.email ? [{ email: input.email }] : []),
          ...(input.phone ? [{ phone: input.phone }] : []),
        ],
      },
    });

    if (!user) throw ApiError.unauthorized('Invalid email/phone or password', 'INVALID_CREDENTIALS');

    if (user.status === UserStatus.BANNED) {
      throw ApiError.forbidden('Your account has been banned', 'ACCOUNT_BANNED');
    }

    const isMatch = await bcrypt.compare(input.password, user.passwordHash);
    if (!isMatch) throw ApiError.unauthorized('Invalid email/phone or password', 'INVALID_CREDENTIALS');

    const tokens = this.generateTokens({
      userId: user.id,
      role: user.role as UserRole,
      status: user.status as UserStatus,
    });

    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        token: tokens.refreshToken,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });

    return {
      user: {
        id: user.id,
        displayName: user.displayName,
        email: user.email,
        phone: user.phone,
        status: user.status,
        role: user.role,
        emailVerifiedAt: user.emailVerifiedAt,
        phoneVerifiedAt: user.phoneVerifiedAt,
      },
      tokens,
    };
  }

  static async verifyOtp(input: VerifyOtpInput) {
    const verification = await prisma.userVerification.findFirst({
      where: {
        userId: input.userId,
        channel: input.channel,
        code: input.code,
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
    });

    if (!verification) {
      throw ApiError.badRequest('Invalid or expired verification code', 'INVALID_OTP');
    }

    // Mark verification used
    await prisma.userVerification.update({
      where: { id: verification.id },
      data: { usedAt: new Date() },
    });

    // Update user status and verification timestamp
    const now = new Date();
    const updateData: Record<string, any> = { status: UserStatus.ACTIVE };
    if (input.channel === VerificationChannel.EMAIL) updateData.emailVerifiedAt = now;
    if (input.channel === VerificationChannel.PHONE) updateData.phoneVerifiedAt = now;

    const user = await prisma.user.update({
      where: { id: input.userId },
      data: updateData,
    });

    return {
      success: true,
      message: 'Account successfully verified',
      user: {
        id: user.id,
        displayName: user.displayName,
        status: user.status,
        emailVerifiedAt: user.emailVerifiedAt,
        phoneVerifiedAt: user.phoneVerifiedAt,
      },
    };
  }

  static async refresh(refreshToken: string) {
    let payload: any;
    try {
      payload = jwt.verify(refreshToken, env.JWT_REFRESH_SECRET);
    } catch {
      throw ApiError.unauthorized('Invalid or expired refresh token', 'INVALID_REFRESH_TOKEN');
    }

    const savedToken = await prisma.refreshToken.findUnique({
      where: { token: refreshToken },
      include: { user: true },
    });

    if (!savedToken || savedToken.revokedAt || savedToken.expiresAt < new Date()) {
      throw ApiError.unauthorized('Refresh token revoked or expired', 'TOKEN_REVOKED');
    }

    const user = savedToken.user;
    if (user.status === UserStatus.BANNED) {
      throw ApiError.forbidden('Account banned', 'ACCOUNT_BANNED');
    }

    const newTokens = this.generateTokens({
      userId: user.id,
      role: user.role as UserRole,
      status: user.status as UserStatus,
    });

    // Revoke old refresh token and create new one
    await prisma.refreshToken.update({
      where: { id: savedToken.id },
      data: { revokedAt: new Date() },
    });

    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        token: newTokens.refreshToken,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });

    return newTokens;
  }

  static async logout(refreshToken: string) {
    if (refreshToken) {
      await prisma.refreshToken.updateMany({
        where: { token: refreshToken },
        data: { revokedAt: new Date() },
      });
    }
    return { success: true, message: 'Logged out successfully' };
  }
}
