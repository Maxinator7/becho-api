import { prisma } from '../../common/prisma.js';
import { ApiError } from '../../common/errors/api-error.js';
import { ListingStatus, MediaType } from '../../common/types/enums.js';
import { SanitizationEngine } from '../sanitization/sanitization.engine.js';

export interface CreateListingInput {
  categoryId: string;
  subcategoryId?: string;
  title: string;
  description: string;
  price: number;
  condition?: string;
  countryCode?: string;
  stateCode?: string;
  cityCode?: string;
  attributes?: { attributeDefinitionId: string; valueText?: string; valueNumber?: number; valueBoolean?: boolean }[];
  media?: { url: string; storageKey: string; mimeType?: string }[];
}

export class ListingsService {
  static async createListingDraft(sellerId: string, input: CreateListingInput) {
    const listing = await prisma.listing.create({
      data: {
        sellerId,
        categoryId: input.categoryId,
        subcategoryId: input.subcategoryId || null,
        title: input.title,
        description: input.description,
        price: input.price,
        condition: input.condition || 'USED',
        countryCode: input.countryCode || 'US',
        stateCode: input.stateCode || 'NY',
        cityCode: input.cityCode || 'NYC',
        status: ListingStatus.DRAFT,
      },
    });

    if (input.attributes && input.attributes.length > 0) {
      for (const attr of input.attributes) {
        await prisma.listingAttribute.create({
          data: {
            listingId: listing.id,
            attributeDefinitionId: attr.attributeDefinitionId,
            valueText: attr.valueText || null,
            valueNumber: attr.valueNumber !== undefined ? attr.valueNumber : null,
            valueBoolean: attr.valueBoolean !== undefined ? attr.valueBoolean : null,
          },
        });
      }
    }

    if (input.media && input.media.length > 0) {
      for (let i = 0; i < input.media.length; i++) {
        const item = input.media[i];
        await prisma.listingMedia.create({
          data: {
            listingId: listing.id,
            mediaType: MediaType.IMAGE,
            storageKey: item.storageKey,
            url: item.url,
            mimeType: item.mimeType || 'image/jpeg',
            sortOrder: i + 1,
          },
        });
      }
    }

    return this.getListingById(listing.id);
  }

  static async submitListing(listingId: string, sellerId: string) {
    const listing = await prisma.listing.findUnique({
      where: { id: listingId },
    });

    if (!listing) throw ApiError.notFound('Listing not found', 'LISTING_NOT_FOUND');
    if (listing.sellerId !== sellerId) throw ApiError.forbidden('Forbidden', 'NOT_OWNER');

    // Run automated sanitization engine checks
    const result = SanitizationEngine.analyzeListing({
      title: listing.title,
      description: listing.description,
      price: listing.price,
    });

    // Save sanitization result record
    await prisma.listingSanitization.upsert({
      where: { listingId: listing.id },
      create: {
        listingId: listing.id,
        status: result.status,
        score: result.score,
        reasons: JSON.stringify(result.reasons),
        checks: JSON.stringify(result.checks),
      },
      update: {
        status: result.status,
        score: result.score,
        reasons: JSON.stringify(result.reasons),
        checks: JSON.stringify(result.checks),
      },
    });

    const isPassed = result.status === 'PASSED';
    const updatedStatus = isPassed ? ListingStatus.LIVE : ListingStatus.PENDING_REVIEW;

    const updated = await prisma.listing.update({
      where: { id: listingId },
      data: {
        status: updatedStatus,
        submittedAt: new Date(),
        publishedAt: isPassed ? new Date() : null,
        approvedAt: isPassed ? new Date() : null,
        expiresAt: isPassed ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) : null,
      },
    });

    return this.getListingById(updated.id);
  }

  static async getListingById(id: string) {
    const listing = await prisma.listing.findUnique({
      where: { id },
      include: {
        seller: {
          select: { id: true, displayName: true, status: true, createdAt: true },
        },
        category: {
          select: { id: true, name: true, slug: true },
        },
        attributes: {
          include: {
            attributeDefinition: {
              select: { id: true, name: true, slug: true, dataType: true },
            },
          },
        },
        media: {
          orderBy: { sortOrder: 'asc' },
        },
      },
    });

    if (!listing) throw ApiError.notFound('Listing not found', 'LISTING_NOT_FOUND');
    return listing;
  }

  static async getPublicListings(query: {
    categoryId?: string;
    subcategoryId?: string;
    cityCode?: string;
    stateCode?: string;
    countryCode?: string;
    minPrice?: number;
    maxPrice?: number;
    condition?: string;
    search?: string;
    sort?: string;
    page?: number;
    limit?: number;
  }) {
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(50, Math.max(1, query.limit || 12));
    const skip = (page - 1) * limit;

    const where: any = {
      status: ListingStatus.LIVE,
    };

    if (query.categoryId) where.categoryId = query.categoryId;
    if (query.subcategoryId) where.subcategoryId = query.subcategoryId;
    if (query.cityCode) where.cityCode = query.cityCode;
    if (query.stateCode) where.stateCode = query.stateCode;
    if (query.countryCode) where.countryCode = query.countryCode;
    if (query.condition) where.condition = query.condition;

    if (query.minPrice !== undefined || query.maxPrice !== undefined) {
      where.price = {};
      if (query.minPrice !== undefined) where.price.gte = query.minPrice;
      if (query.maxPrice !== undefined) where.price.lte = query.maxPrice;
    }

    if (query.search) {
      where.OR = [
        { title: { contains: query.search, mode: 'insensitive' } },
        { description: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    let orderBy: any = { createdAt: 'desc' };
    if (query.sort === 'price_asc') {
      orderBy = { price: 'asc' };
    } else if (query.sort === 'price_desc') {
      orderBy = { price: 'desc' };
    } else if (query.sort === 'oldest') {
      orderBy = { createdAt: 'asc' };
    }

    const [total, listings] = await Promise.all([
      prisma.listing.count({ where }),
      prisma.listing.findMany({
        where,
        include: {
          category: { select: { id: true, name: true, slug: true } },
          media: { orderBy: { sortOrder: 'asc' }, take: 1 },
          seller: { select: { id: true, displayName: true } },
        },
        orderBy,
        skip,
        take: limit,
      }),
    ]);

    return {
      listings,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  static async getUserListings(sellerId: string) {
    return prisma.listing.findMany({
      where: { sellerId },
      include: {
        category: { select: { name: true } },
        media: { orderBy: { sortOrder: 'asc' }, take: 1 },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Update a listing draft (only DRAFT status allowed).
   */
  static async updateListingDraft(listingId: string, sellerId: string, input: Partial<CreateListingInput>) {
    const listing = await prisma.listing.findUnique({
      where: { id: listingId },
    });

    if (!listing) throw ApiError.notFound('Listing not found', 'LISTING_NOT_FOUND');
    if (listing.sellerId !== sellerId) throw ApiError.forbidden('Forbidden', 'NOT_OWNER');
    if (listing.status !== ListingStatus.DRAFT) {
      throw ApiError.badRequest('Only draft listings can be edited', 'LISTING_NOT_EDITABLE');
    }

    const updateData: any = {};
    if (input.title !== undefined) updateData.title = input.title;
    if (input.description !== undefined) updateData.description = input.description;
    if (input.price !== undefined) updateData.price = input.price;
    if (input.condition !== undefined) updateData.condition = input.condition;
    if (input.categoryId !== undefined) updateData.categoryId = input.categoryId;
    if (input.subcategoryId !== undefined) updateData.subcategoryId = input.subcategoryId;
    if (input.countryCode !== undefined) updateData.countryCode = input.countryCode;
    if (input.stateCode !== undefined) updateData.stateCode = input.stateCode;
    if (input.cityCode !== undefined) updateData.cityCode = input.cityCode;

    await prisma.listing.update({
      where: { id: listingId },
      data: updateData,
    });

    // Update attributes if provided
    if (input.attributes && input.attributes.length > 0) {
      // Delete existing attributes and recreate
      await prisma.listingAttribute.deleteMany({ where: { listingId } });
      for (const attr of input.attributes) {
        await prisma.listingAttribute.create({
          data: {
            listingId,
            attributeDefinitionId: attr.attributeDefinitionId,
            valueText: attr.valueText || null,
            valueNumber: attr.valueNumber !== undefined ? attr.valueNumber : null,
            valueBoolean: attr.valueBoolean !== undefined ? attr.valueBoolean : null,
          },
        });
      }
    }

    // Update media if provided
    if (input.media && input.media.length > 0) {
      await prisma.listingMedia.deleteMany({ where: { listingId } });
      for (let i = 0; i < input.media.length; i++) {
        const item = input.media[i];
        await prisma.listingMedia.create({
          data: {
            listingId,
            mediaType: MediaType.IMAGE,
            storageKey: item.storageKey,
            url: item.url,
            mimeType: item.mimeType || 'image/jpeg',
            sortOrder: i + 1,
          },
        });
      }
    }

    return this.getListingById(listingId);
  }

  /**
   * Seller marks a LIVE listing as SOLD.
   */
  static async markListingSold(listingId: string, sellerId: string) {
    const listing = await prisma.listing.findUnique({ where: { id: listingId } });

    if (!listing) throw ApiError.notFound('Listing not found', 'LISTING_NOT_FOUND');
    if (listing.sellerId !== sellerId) throw ApiError.forbidden('Forbidden', 'NOT_OWNER');
    if (listing.status !== ListingStatus.LIVE) {
      throw ApiError.badRequest('Only live listings can be marked as sold', 'LISTING_NOT_LIVE');
    }

    const updated = await prisma.listing.update({
      where: { id: listingId },
      data: {
        status: ListingStatus.SOLD,
        soldAt: new Date(),
      },
    });

    // Audit log
    await prisma.auditLog.create({
      data: {
        actorId: sellerId,
        action: 'LISTING_MARKED_SOLD',
        targetType: 'LISTING',
        targetId: listingId,
      },
    });

    return this.getListingById(updated.id);
  }

  /**
   * Soft delete a listing (seller can delete their own DRAFT/EXPIRED/REJECTED listings).
   */
  static async deleteListing(listingId: string, sellerId: string) {
    const listing = await prisma.listing.findUnique({ where: { id: listingId } });

    if (!listing) throw ApiError.notFound('Listing not found', 'LISTING_NOT_FOUND');
    if (listing.sellerId !== sellerId) throw ApiError.forbidden('Forbidden', 'NOT_OWNER');

    const deletableStatuses = [ListingStatus.DRAFT, ListingStatus.EXPIRED, ListingStatus.REJECTED, ListingStatus.SOLD];
    if (!deletableStatuses.includes(listing.status as any)) {
      throw ApiError.badRequest(
        'Only draft, expired, rejected, or sold listings can be deleted',
        'LISTING_NOT_DELETABLE'
      );
    }

    await prisma.listing.update({
      where: { id: listingId },
      data: { status: ListingStatus.DELETED },
    });

    return { deleted: true };
  }

  /**
   * Renew an expired listing — re-submits for review.
   */
  static async renewListing(listingId: string, sellerId: string) {
    const listing = await prisma.listing.findUnique({ where: { id: listingId } });

    if (!listing) throw ApiError.notFound('Listing not found', 'LISTING_NOT_FOUND');
    if (listing.sellerId !== sellerId) throw ApiError.forbidden('Forbidden', 'NOT_OWNER');
    if (listing.status !== ListingStatus.EXPIRED) {
      throw ApiError.badRequest('Only expired listings can be renewed', 'LISTING_NOT_EXPIRED');
    }

    // Re-run sanitization
    const result = SanitizationEngine.analyzeListing({
      title: listing.title,
      description: listing.description,
      price: listing.price,
    });

    await prisma.listingSanitization.upsert({
      where: { listingId: listing.id },
      create: {
        listingId: listing.id,
        status: result.status,
        score: result.score,
        reasons: JSON.stringify(result.reasons),
        checks: JSON.stringify(result.checks),
      },
      update: {
        status: result.status,
        score: result.score,
        reasons: JSON.stringify(result.reasons),
        checks: JSON.stringify(result.checks),
      },
    });

    const isPassed = result.status === 'PASSED';
    const newStatus = isPassed ? ListingStatus.LIVE : ListingStatus.PENDING_REVIEW;

    const updated = await prisma.listing.update({
      where: { id: listingId },
      data: {
        status: newStatus,
        submittedAt: new Date(),
        publishedAt: isPassed ? new Date() : null,
        approvedAt: isPassed ? new Date() : null,
        expiresAt: isPassed ? new Date(Date.now() + 90 * 24 * 60 * 60 * 1000) : null,
        soldAt: null,
      },
    });

    return this.getListingById(updated.id);
  }

  /**
   * Background job: expire listings past their expires_at date.
   * Returns count of expired listings.
   */
  static async expireListings() {
    const now = new Date();

    const expiredListings = await prisma.listing.findMany({
      where: {
        status: ListingStatus.LIVE,
        expiresAt: { lte: now },
      },
      select: { id: true, sellerId: true, title: true },
    });

    if (expiredListings.length === 0) return { expiredCount: 0 };

    // Batch update status
    await prisma.listing.updateMany({
      where: {
        id: { in: expiredListings.map((l) => l.id) },
      },
      data: { status: ListingStatus.EXPIRED },
    });

    // Create audit logs and notify sellers
    const { NotificationsService } = await import('../notifications/notifications.service.js');
    for (const listing of expiredListings) {
      await prisma.auditLog.create({
        data: {
          actorId: 'SYSTEM',
          action: 'LISTING_EXPIRED',
          targetType: 'LISTING',
          targetId: listing.id,
        },
      });

      NotificationsService.notifyListingExpired(listing.sellerId, listing.title, listing.id).catch(() => {});
    }

    return { expiredCount: expiredListings.length };
  }
}

