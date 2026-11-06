import { prisma } from '../../common/prisma.js';
import { ApiError } from '../../common/errors/api-error.js';

export class FavoritesService {
  static async toggleFavorite(userId: string, listingId: string) {
    const existing = await prisma.favorite.findUnique({
      where: {
        userId_listingId: { userId, listingId },
      },
    });

    if (existing) {
      await prisma.favorite.delete({
        where: { id: existing.id },
      });
      return { favorited: false };
    } else {
      await prisma.favorite.create({
        data: { userId, listingId },
      });
      return { favorited: true };
    }
  }

  static async getUserFavorites(userId: string) {
    const favorites = await prisma.favorite.findMany({
      where: { userId },
      include: {
        listing: {
          include: {
            category: { select: { id: true, name: true, slug: true } },
            media: { orderBy: { sortOrder: 'asc' }, take: 1 },
            seller: { select: { id: true, displayName: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return favorites.map((f) => f.listing);
  }
}
