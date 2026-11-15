import { prisma } from '../../common/prisma.js';
import { ApiError } from '../../common/errors/api-error.js';

const profileSelect = {
  id: true,
  userCode: true,
  displayName: true,
  email: true,
  phone: true,
  status: true,
  role: true,
  emailVerifiedAt: true,
  phoneVerifiedAt: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

export class UsersService {
  static async getProfile(userId: string) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: profileSelect });
    if (!user) throw ApiError.notFound('User profile not found', 'USER_NOT_FOUND');
    return user;
  }

  /**
   * Name can always be changed. A mobile number can be added once by accounts created before
   * mobile became mandatory; changing an existing number needs SMS verification (coming with DLT).
   */
  static async updateProfile(userId: string, data: { displayName?: string; phone?: string }) {
    const current = await prisma.user.findUnique({ where: { id: userId }, select: { phone: true } });
    if (!current) throw ApiError.notFound('User profile not found', 'USER_NOT_FOUND');

    if (data.phone !== undefined && data.phone !== current.phone) {
      if (current.phone) {
        throw ApiError.badRequest('To change your mobile number, please contact support.', 'PHONE_CHANGE_NOT_ALLOWED');
      }
      const taken = await prisma.user.findUnique({ where: { phone: data.phone }, select: { id: true } });
      if (taken) throw ApiError.badRequest('This mobile number is already registered to another account', 'PHONE_TAKEN');
    }

    return prisma.user.update({
      where: { id: userId },
      data: { ...(data.displayName ? { displayName: data.displayName } : {}), ...(data.phone && !current.phone ? { phone: data.phone } : {}) },
      select: profileSelect,
    });
  }
}
