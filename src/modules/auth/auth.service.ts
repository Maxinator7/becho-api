import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Prisma, User } from '@prisma/client';
import { prisma } from '../../common/prisma.js';
import { env, exposeDevOtp } from '../../config/env.js';
import { ApiError } from '../../common/errors/api-error.js';
import { uniqueUserCode } from '../../common/user-code.js';
import { maskEmail, passwordResetEmail, sendEmail, verificationCodeEmail } from '../../common/email/email.service.js';
import { track } from '../../common/analytics.js';
import { ChangePasswordInput, Identifier, LoginInput, RegisterInput, ResetPasswordInput, VerifyOtpInput } from './auth.schema.js';
import { UserRole, UserStatus, VerificationChannel } from '../../common/types/enums.js';

export interface TokenPayload {
  userId: string;
  role: UserRole;
  status: UserStatus;
}

export const VerificationPurpose = { VERIFY: 'VERIFY', PASSWORD_RESET: 'PASSWORD_RESET' } as const;
type VerificationPurpose = typeof VerificationPurpose[keyof typeof VerificationPurpose];

const ACCESS_TOKEN_TTL = '15m';
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const OTP_TTL_MS = 15 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
/** Lock an account for LOCK_MINUTES after this many consecutive wrong passwords. */
export const MAX_FAILED_LOGINS = 10;
const LOCK_MINUTES = 15;
/** Compared against when the account doesn't exist, so timing doesn't reveal which accounts exist. */
const DUMMY_HASH = bcrypt.hashSync('becho-timing-equaliser', 10);

export function publicUser(user: User) {
  return {
    id: user.id,
    userCode: user.userCode,
    displayName: user.displayName,
    email: user.email,
    phone: user.phone,
    status: user.status,
    role: user.role,
    emailVerifiedAt: user.emailVerifiedAt,
    phoneVerifiedAt: user.phoneVerifiedAt,
  };
}

const whereIdentifier = (id: Identifier): Prisma.UserWhereUniqueInput =>
  id.kind === 'email' ? { email: id.value } : id.kind === 'phone' ? { phone: id.value } : { userCode: id.value };

function assertNotBlocked(user: User) {
  if (user.status === UserStatus.BANNED) {
    throw ApiError.forbidden('This account has been banned. Contact support if you think this is a mistake.', 'ACCOUNT_BANNED');
  }
  if (user.status === UserStatus.SUSPENDED) {
    throw ApiError.forbidden(`This account is suspended${user.statusReason ? `: ${user.statusReason}` : ''}. Contact support for help.`, 'ACCOUNT_SUSPENDED');
  }
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

  /** Creates a fresh OTP for one purpose, invalidating older unused codes for that purpose. */
  private static async createOtp(userId: string, channel: VerificationChannel, purpose: VerificationPurpose) {
    const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
    await prisma.$transaction([
      prisma.userVerification.updateMany({ where: { userId, purpose, usedAt: null }, data: { usedAt: new Date() } }),
      prisma.userVerification.create({ data: { userId, channel, purpose, code, expiresAt: new Date(Date.now() + OTP_TTL_MS) } }),
    ]);
    return code;
  }

  private static async assertCooldown(userId: string, purpose: VerificationPurpose) {
    const last = await prisma.userVerification.findFirst({ where: { userId, purpose }, orderBy: { createdAt: 'desc' } });
    if (last && Date.now() - last.createdAt.getTime() < OTP_RESEND_COOLDOWN_MS) {
      throw ApiError.tooManyRequests('Please wait a minute before requesting another code', 'OTP_COOLDOWN');
    }
  }

  /** Emails the account verification code. SMS (phone) verification follows once DLT registration is done. */
  private static async sendVerification(user: User) {
    if (!user.email) throw ApiError.badRequest('Add an email address to verify your account', 'EMAIL_REQUIRED');
    const code = await this.createOtp(user.id, VerificationChannel.EMAIL, VerificationPurpose.VERIFY);
    const delivered = await sendEmail(verificationCodeEmail(user.email, user.displayName, code));
    return {
      otpChannel: VerificationChannel.EMAIL,
      otpSentTo: maskEmail(user.email),
      verificationMessage: delivered
        ? `We sent a 6-digit code to ${maskEmail(user.email)}.`
        : 'We could not send the email right now. Please use "Resend code" in a minute.',
      // Shown on screen only in development/staging (EXPOSE_DEV_OTP).
      ...(exposeDevOtp ? { devOtp: code } : {}),
    };
  }

  static async register(input: RegisterInput) {
    if (await prisma.user.findUnique({ where: { phone: input.phone } })) {
      throw ApiError.badRequest('This mobile number is already registered. Try signing in or resetting your password.', 'PHONE_TAKEN');
    }
    if (await prisma.user.findUnique({ where: { email: input.email } })) {
      throw ApiError.badRequest('This email is already registered. Try signing in or resetting your password.', 'EMAIL_TAKEN');
    }

    const user = await prisma.user.create({
      data: {
        userCode: await uniqueUserCode(),
        displayName: input.displayName,
        email: input.email,
        phone: input.phone,
        passwordHash: await bcrypt.hash(input.password, 10),
        status: UserStatus.PENDING_VERIFICATION,
        role: UserRole.USER,
      },
    });
    track(user.id, 'user_signed_up', { userCode: user.userCode });

    const verification = await this.sendVerification(user);
    return { user: publicUser(user), tokens: await this.issueTokens(user), ...verification };
  }

  static async login(input: LoginInput) {
    const user = await prisma.user.findUnique({ where: whereIdentifier(input.identifier) });
    const invalid = () => ApiError.unauthorized('Incorrect email/mobile or password', 'INVALID_CREDENTIALS');
    if (!user) {
      // Spend similar time as a real check so response time doesn't reveal whether the account exists.
      await bcrypt.compare(input.password, DUMMY_HASH);
      throw invalid();
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const minutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000);
      throw ApiError.tooManyRequests(
        `Too many wrong passwords. Try again in ${minutes} minute${minutes === 1 ? '' : 's'} or reset your password.`,
        'ACCOUNT_LOCKED'
      );
    }

    if (!(await bcrypt.compare(input.password, user.passwordHash))) {
      const failed = user.failedLoginCount + 1;
      const lock = failed >= MAX_FAILED_LOGINS;
      await prisma.user.update({
        where: { id: user.id },
        data: lock
          ? { failedLoginCount: 0, lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60_000) }
          : { failedLoginCount: failed },
      });
      if (lock) {
        await prisma.auditLog.create({ data: { actorId: user.id, action: 'ACCOUNT_LOCKED', targetType: 'USER', targetId: user.id } });
        throw ApiError.tooManyRequests(`Too many wrong passwords. Your account is locked for ${LOCK_MINUTES} minutes — or reset your password.`, 'ACCOUNT_LOCKED');
      }
      throw invalid();
    }

    assertNotBlocked(user);
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
    });
    return { user: publicUser(updated), tokens: await this.issueTokens(updated) };
  }

  /** Verifies the OTP of the authenticated user and returns fresh tokens carrying the ACTIVE status. */
  static async verifyOtp(userId: string, input: VerifyOtpInput) {
    const verification = await prisma.userVerification.findFirst({
      where: {
        userId,
        purpose: VerificationPurpose.VERIFY,
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
    track(user.id, 'user_verified');

    return { message: 'Account successfully verified', user: publicUser(user), tokens: await this.issueTokens(user) };
  }

  static async resendOtp(userId: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw ApiError.notFound('User not found', 'USER_NOT_FOUND');
    if (user.status !== UserStatus.PENDING_VERIFICATION) {
      throw ApiError.badRequest('Account is already verified', 'ALREADY_VERIFIED');
    }
    await this.assertCooldown(userId, VerificationPurpose.VERIFY);
    return this.sendVerification(user);
  }

  /**
   * Step 1 of "forgot password". Always answers the same way whether or not the account exists,
   * so the form can't be used to discover who is registered.
   */
  static async forgotPassword(id: Identifier) {
    const generic = { message: 'If an account matches, we sent a 6-digit code to its email address.' };
    const user = await prisma.user.findUnique({ where: whereIdentifier(id) });
    if (!user || !user.email || user.status === UserStatus.BANNED) return generic;

    // Within the cooldown, silently skip sending (an error here would reveal that the account exists).
    const last = await prisma.userVerification.findFirst({
      where: { userId: user.id, purpose: VerificationPurpose.PASSWORD_RESET },
      orderBy: { createdAt: 'desc' },
    });
    if (last && Date.now() - last.createdAt.getTime() < OTP_RESEND_COOLDOWN_MS) return generic;

    const code = await this.createOtp(user.id, VerificationChannel.EMAIL, VerificationPurpose.PASSWORD_RESET);
    await sendEmail(passwordResetEmail(user.email, user.displayName, code));
    // devOtp only exists on dev/staging (EXPOSE_DEV_OTP), where showing the code is the point.
    return { ...generic, ...(exposeDevOtp ? { devOtp: code } : {}) };
  }

  /** Step 2: code from the email + new password. Signs out every existing session. */
  static async resetPassword(input: ResetPasswordInput) {
    const failure = () => ApiError.badRequest('That code is incorrect or has expired. Request a new one.', 'INVALID_RESET_CODE');
    const user = await prisma.user.findUnique({ where: whereIdentifier(input.identifier) });
    if (!user) throw failure();

    const verification = await prisma.userVerification.findFirst({
      where: { userId: user.id, purpose: VerificationPurpose.PASSWORD_RESET, usedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!verification || verification.attempts >= OTP_MAX_ATTEMPTS) throw failure();
    if (verification.code !== input.code) {
      await prisma.userVerification.update({ where: { id: verification.id }, data: { attempts: { increment: 1 } } });
      throw failure();
    }

    const now = new Date();
    await prisma.$transaction([
      prisma.userVerification.update({ where: { id: verification.id }, data: { usedAt: now } }),
      prisma.user.update({
        where: { id: user.id },
        data: {
          passwordHash: await bcrypt.hash(input.newPassword, 10),
          failedLoginCount: 0,
          lockedUntil: null,
          // The code arrived by email, so the email is proven; finish verification for pending accounts.
          emailVerifiedAt: user.emailVerifiedAt ?? now,
          ...(user.status === UserStatus.PENDING_VERIFICATION ? { status: UserStatus.ACTIVE } : {}),
        },
      }),
      prisma.refreshToken.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: now } }),
      prisma.auditLog.create({ data: { actorId: user.id, action: 'PASSWORD_RESET', targetType: 'USER', targetId: user.id } }),
    ]);
    return { message: 'Password updated. You can now sign in with your new password.' };
  }

  /** Signed-in password change; other devices are signed out. */
  static async changePassword(userId: string, input: ChangePasswordInput, currentRefreshToken?: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw ApiError.notFound('User not found', 'USER_NOT_FOUND');
    if (!(await bcrypt.compare(input.currentPassword, user.passwordHash))) {
      throw ApiError.badRequest('Your current password is incorrect', 'INVALID_CURRENT_PASSWORD');
    }
    const now = new Date();
    await prisma.$transaction([
      prisma.user.update({ where: { id: userId }, data: { passwordHash: await bcrypt.hash(input.newPassword, 10) } }),
      prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null, ...(currentRefreshToken ? { token: { not: currentRefreshToken } } : {}) },
        data: { revokedAt: now },
      }),
      prisma.auditLog.create({ data: { actorId: userId, action: 'PASSWORD_CHANGED', targetType: 'USER', targetId: userId } }),
    ]);
    return { message: 'Password changed. Other devices have been signed out.' };
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
    assertNotBlocked(savedToken.user);

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
