import { prisma } from '../../common/prisma.js';
import { ApiError } from '../../common/errors/api-error.js';

export class UsersService {
  static async getProfile(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        displayName: true,
        email: true,
        phone: true,
        status: true,
        role: true,
        emailVerifiedAt: true,
        phoneVerifiedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) throw ApiError.notFound('User profile not found', 'USER_NOT_FOUND');
    return user;
  }

  static async updateProfile(userId: string, data: { displayName?: string }) {
    const user = await prisma.user.update({
      where: { id: userId },
      data,
      select: {
        id: true,
        displayName: true,
        email: true,
        phone: true,
        status: true,
        role: true,
        updatedAt: true,
      },
    });
    return user;
  }
}
