import { Prisma } from '@prisma/client';
import { prisma } from '../../common/prisma.js';
import { ApiError } from '../../common/errors/api-error.js';
import { AuthenticatedUser } from '../../common/middleware/auth-guard.js';
import { ListingStatus, MediaType, OfferStatus, SanitizationStatus, UserRole } from '../../common/types/enums.js';
import { SanitizationEngine } from '../sanitization/sanitization.engine.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { CreateListingInput, ListingQuery, UpdateListingInput } from './listings.schema.js';

export const LISTING_TTL_DAYS = 30;
const LISTING_TTL_MS = LISTING_TTL_DAYS * 24 * 60 * 60 * 1000;

/** Statuses anyone may view. Everything else is visible only to the owner and moderators. */
const PUBLIC_STATUSES: string[] = [ListingStatus.LIVE, ListingStatus.RESERVED, ListingStatus.SOLD];
/** Statuses a seller may edit and (re)submit. */
const EDITABLE_STATUSES: string[] = [ListingStatus.DRAFT, ListingStatus.REJECTED];
const DELETABLE_STATUSES: string[] = [ListingStatus.DRAFT, ListingStatus.EXPIRED, ListingStatus.REJECTED, ListingStatus.SOLD];

const listingDetailInclude = {
  seller: { select: { id: true, displayName: true, status: true, createdAt: true } },
  category: { select: { id: true, name: true, slug: true, parentId: true } },
  attributes: {
    include: { attributeDefinition: { select: { id: true, name: true, slug: true, dataType: true } } },
  },
  media: { orderBy: { sortOrder: 'asc' as const } },
} satisfies Prisma.ListingInclude;

type AttributeInput = CreateListingInput['attributes'][number];
type MediaInput = CreateListingInput['media'][number];

function toAttributeRows(attributes: AttributeInput[]) {
  return attributes.map((attr) => ({
    attributeDefinitionId: attr.attributeDefinitionId,
    valueText: attr.valueText ?? null,
    valueNumber: attr.valueNumber ?? null,
    valueBoolean: attr.valueBoolean ?? null,
    valueJson: attr.valueJson === undefined ? Prisma.JsonNull : (attr.valueJson as Prisma.InputJsonValue),
  }));
}

function toMediaRows(media: MediaInput[]) {
  return media.map((item, i) => ({
    mediaType: MediaType.IMAGE,
    storageKey: item.storageKey || item.url,
    url: item.url,
    mimeType: item.mimeType || 'image/jpeg',
    sortOrder: i + 1,
  }));
}

export class ListingsService {
  // ───────────────────────── validation helpers ─────────────────────────

  private static async assertCategory(categoryId: string) {
    const category = await prisma.category.findUnique({ where: { id: categoryId } });
    if (!category || !category.isActive) throw ApiError.badRequest('Category not found', 'INVALID_CATEGORY');
    return category;
  }

  private static async assertSellingArea(countryCode: string, stateCode: string, cityCode: string) {
    const area = await prisma.serviceArea.findUnique({
      where: { countryCode_stateCode_cityCode: { countryCode, stateCode, cityCode } },
    });
    if (!area || !area.isActive || !area.sellingEnabled) {
      throw ApiError.badRequest('Selling is not available in this city yet', 'AREA_NOT_SERVED');
    }
  }

  /** Every attribute must belong to the category; with `requireAll`, required ones must be present. */
  private static async assertAttributes(categoryId: string, attributes: AttributeInput[], requireAll: boolean) {
    const definitions = await prisma.attributeDefinition.findMany({ where: { categoryId, isActive: true } });
    const known = new Set(definitions.map((d) => d.id));
    const unknown = attributes.find((a) => !known.has(a.attributeDefinitionId));
    if (unknown) throw ApiError.badRequest('Attribute does not belong to this category', 'INVALID_ATTRIBUTE');

    if (requireAll) {
      const provided = new Set(
        attributes
          .filter((a) => a.valueText || a.valueNumber !== undefined || a.valueBoolean !== undefined || a.valueJson !== undefined)
          .map((a) => a.attributeDefinitionId)
      );
      const missing = definitions.filter((d) => d.isRequired && !provided.has(d.id));
      if (missing.length > 0) {
        throw ApiError.badRequest(`Missing required details: ${missing.map((d) => d.name).join(', ')}`, 'MISSING_ATTRIBUTES');
      }
    }
  }

  private static async getOwnedListing(listingId: string, sellerId: string) {
    const listing = await prisma.listing.findUnique({ where: { id: listingId } });
    if (!listing) throw ApiError.notFound('Listing not found', 'LISTING_NOT_FOUND');
    if (listing.sellerId !== sellerId) throw ApiError.forbidden('Forbidden', 'NOT_OWNER');
    return listing;
  }

  /** Runs automated checks and moves the listing to LIVE or PENDING_REVIEW. */
  private static async runChecksAndPublish(listing: { id: string; title: string; description: string; price: number }) {
    const result = SanitizationEngine.analyzeListing(listing);
    const passed = result.status === SanitizationStatus.PASSED;
    const now = new Date();
    const sanitization = {
      status: result.status,
      score: result.score,
      reasons: result.reasons,
      checks: result.checks,
      reviewedBy: null,
      reviewedAt: null,
    };

    await prisma.$transaction([
      prisma.listingSanitization.upsert({
        where: { listingId: listing.id },
        create: { listingId: listing.id, ...sanitization },
        update: sanitization,
      }),
      prisma.listing.update({
        where: { id: listing.id },
        data: {
          status: passed ? ListingStatus.LIVE : ListingStatus.PENDING_REVIEW,
          submittedAt: now,
          publishedAt: passed ? now : null,
          approvedAt: passed ? now : null,
          expiresAt: passed ? new Date(now.getTime() + LISTING_TTL_MS) : null,
          reservedAt: null,
          soldAt: null,
        },
      }),
    ]);

    return this.getListingById(listing.id);
  }

  // ───────────────────────── seller operations ─────────────────────────

  static async createListingDraft(sellerId: string, input: CreateListingInput) {
    await this.assertCategory(input.categoryId);
    await this.assertSellingArea(input.countryCode, input.stateCode, input.cityCode);
    await this.assertAttributes(input.categoryId, input.attributes, false);

    const listing = await prisma.listing.create({
      data: {
        sellerId,
        categoryId: input.categoryId,
        title: input.title,
        description: input.description,
        price: input.price,
        condition: input.condition,
        countryCode: input.countryCode,
        stateCode: input.stateCode,
        cityCode: input.cityCode,
        metadata: (input.metadata as Prisma.InputJsonValue) ?? undefined,
        status: ListingStatus.DRAFT,
        attributes: { create: toAttributeRows(input.attributes) },
        media: { create: toMediaRows(input.media) },
      },
    });

    return this.getListingById(listing.id);
  }

  static async submitListing(listingId: string, sellerId: string) {
    const listing = await this.getOwnedListing(listingId, sellerId);
    if (!EDITABLE_STATUSES.includes(listing.status)) {
      throw ApiError.badRequest('Only draft or rejected listings can be submitted', 'LISTING_NOT_SUBMITTABLE');
    }

    const attributes = await prisma.listingAttribute.findMany({ where: { listingId } });
    await this.assertAttributes(
      listing.categoryId,
      attributes.map((a) => ({
        attributeDefinitionId: a.attributeDefinitionId,
        valueText: a.valueText ?? undefined,
        valueNumber: a.valueNumber ?? undefined,
        valueBoolean: a.valueBoolean ?? undefined,
        valueJson: a.valueJson ?? undefined,
      })),
      true
    );

    return this.runChecksAndPublish(listing);
  }

  static async updateListingDraft(listingId: string, sellerId: string, input: UpdateListingInput) {
    const listing = await this.getOwnedListing(listingId, sellerId);
    if (!EDITABLE_STATUSES.includes(listing.status)) {
      throw ApiError.badRequest('Only draft or rejected listings can be edited', 'LISTING_NOT_EDITABLE');
    }

    const categoryId = input.categoryId ?? listing.categoryId;
    if (input.categoryId) await this.assertCategory(input.categoryId);
    if (input.countryCode || input.stateCode || input.cityCode) {
      await this.assertSellingArea(
        input.countryCode ?? listing.countryCode,
        input.stateCode ?? listing.stateCode,
        input.cityCode ?? listing.cityCode
      );
    }
    if (input.attributes) await this.assertAttributes(categoryId, input.attributes, false);

    const { attributes, media, metadata, ...fields } = input;

    await prisma.$transaction(async (tx) => {
      await tx.listing.update({
        where: { id: listingId },
        data: {
          ...fields,
          ...(metadata !== undefined ? { metadata: metadata as Prisma.InputJsonValue } : {}),
          // Editing a rejected listing turns it back into a draft that can be resubmitted.
          status: ListingStatus.DRAFT,
        },
      });
      if (attributes) {
        await tx.listingAttribute.deleteMany({ where: { listingId } });
        await tx.listingAttribute.createMany({ data: toAttributeRows(attributes).map((a) => ({ ...a, listingId })) });
      }
      if (media) {
        await tx.listingMedia.deleteMany({ where: { listingId } });
        await tx.listingMedia.createMany({ data: toMediaRows(media).map((m) => ({ ...m, listingId })) });
      }
    });

    return this.getListingById(listingId);
  }

  /** Seller marks a LIVE or RESERVED listing as SOLD; any open offers are closed. */
  static async markListingSold(listingId: string, sellerId: string) {
    const listing = await this.getOwnedListing(listingId, sellerId);
    if (listing.status !== ListingStatus.LIVE && listing.status !== ListingStatus.RESERVED) {
      throw ApiError.badRequest('Only live or reserved listings can be marked as sold', 'LISTING_NOT_LIVE');
    }

    await prisma.$transaction([
      prisma.listing.update({ where: { id: listingId }, data: { status: ListingStatus.SOLD, soldAt: new Date() } }),
      prisma.offer.updateMany({ where: { listingId, status: OfferStatus.PENDING }, data: { status: OfferStatus.REJECTED } }),
      prisma.auditLog.create({ data: { actorId: sellerId, action: 'LISTING_MARKED_SOLD', targetType: 'LISTING', targetId: listingId } }),
    ]);

    return this.getListingById(listingId);
  }

  /** Seller releases a reservation (deal fell through) and puts the listing back on sale. */
  static async markListingAvailable(listingId: string, sellerId: string) {
    const listing = await this.getOwnedListing(listingId, sellerId);
    if (listing.status !== ListingStatus.RESERVED) {
      throw ApiError.badRequest('Only reserved listings can be made available again', 'LISTING_NOT_RESERVED');
    }

    await prisma.$transaction([
      prisma.listing.update({ where: { id: listingId }, data: { status: ListingStatus.LIVE, reservedAt: null } }),
      prisma.offer.updateMany({ where: { listingId, status: OfferStatus.ACCEPTED }, data: { status: OfferStatus.CANCELLED } }),
      prisma.auditLog.create({ data: { actorId: sellerId, action: 'LISTING_RESERVATION_RELEASED', targetType: 'LISTING', targetId: listingId } }),
    ]);

    return this.getListingById(listingId);
  }

  static async deleteListing(listingId: string, sellerId: string) {
    const listing = await this.getOwnedListing(listingId, sellerId);
    if (!DELETABLE_STATUSES.includes(listing.status)) {
      throw ApiError.badRequest('Only draft, expired, rejected, or sold listings can be deleted', 'LISTING_NOT_DELETABLE');
    }

    await prisma.listing.update({ where: { id: listingId }, data: { status: ListingStatus.DELETED } });
    return { deleted: true };
  }

  /** Renew an expired listing — re-runs automated checks. */
  static async renewListing(listingId: string, sellerId: string) {
    const listing = await this.getOwnedListing(listingId, sellerId);
    if (listing.status !== ListingStatus.EXPIRED) {
      throw ApiError.badRequest('Only expired listings can be renewed', 'LISTING_NOT_EXPIRED');
    }
    return this.runChecksAndPublish(listing);
  }

  // ───────────────────────── reads ─────────────────────────

  static async getListingById(id: string) {
    const listing = await prisma.listing.findUnique({ where: { id }, include: listingDetailInclude });
    if (!listing) throw ApiError.notFound('Listing not found', 'LISTING_NOT_FOUND');
    return listing;
  }

  /** Public view: non-public listings look like 404 to anyone but the owner or a moderator. */
  static async getListingForViewer(id: string, viewer?: AuthenticatedUser) {
    const listing = await this.getListingById(id);
    const isOwner = viewer?.userId === listing.sellerId;
    const isStaff = viewer?.role === UserRole.ADMIN || viewer?.role === UserRole.MODERATOR;
    if (!PUBLIC_STATUSES.includes(listing.status) && !isOwner && !isStaff) {
      throw ApiError.notFound('Listing not found', 'LISTING_NOT_FOUND');
    }
    return listing;
  }

  static async getPublicListings(query: ListingQuery) {
    const where: Prisma.ListingWhereInput = { status: ListingStatus.LIVE };

    if (query.categoryId) {
      // A top-level category also matches listings in its subcategories.
      const children = await prisma.category.findMany({ where: { parentId: query.categoryId }, select: { id: true } });
      where.categoryId = { in: [query.categoryId, ...children.map((c) => c.id)] };
    }
    if (query.countryCode) where.countryCode = query.countryCode;
    if (query.stateCode) where.stateCode = query.stateCode;
    if (query.cityCode) where.cityCode = query.cityCode;
    if (query.condition) where.condition = query.condition;
    if (query.minPrice !== undefined || query.maxPrice !== undefined) {
      where.price = { gte: query.minPrice, lte: query.maxPrice };
    }
    if (query.search) {
      where.OR = [
        { title: { contains: query.search, mode: 'insensitive' } },
        { description: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const orderBy: Prisma.ListingOrderByWithRelationInput =
      query.sort === 'price_asc' ? { price: 'asc' }
      : query.sort === 'price_desc' ? { price: 'desc' }
      : query.sort === 'oldest' ? { publishedAt: 'asc' }
      : { publishedAt: 'desc' };

    const [total, listings] = await Promise.all([
      prisma.listing.count({ where }),
      prisma.listing.findMany({
        where,
        include: {
          category: { select: { id: true, name: true, slug: true } },
          media: { orderBy: { sortOrder: 'asc' }, take: 1 },
          seller: { select: { id: true, displayName: true } },
        },
        orderBy: [orderBy, { id: 'asc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
    ]);

    return {
      listings,
      pagination: { total, page: query.page, limit: query.limit, totalPages: Math.ceil(total / query.limit) },
    };
  }

  static async getUserListings(sellerId: string) {
    return prisma.listing.findMany({
      where: { sellerId, status: { not: ListingStatus.DELETED } },
      include: {
        category: { select: { name: true } },
        media: { orderBy: { sortOrder: 'asc' }, take: 1 },
        sanitization: { select: { status: true, reasons: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ───────────────────────── background job ─────────────────────────

  /** Expire LIVE listings past their expires_at date. */
  static async expireListings() {
    const expired = await prisma.listing.findMany({
      where: { status: ListingStatus.LIVE, expiresAt: { lte: new Date() } },
      select: { id: true, sellerId: true, title: true },
    });
    if (expired.length === 0) return { expiredCount: 0 };

    const ids = expired.map((l) => l.id);
    await prisma.$transaction([
      prisma.listing.updateMany({ where: { id: { in: ids }, status: ListingStatus.LIVE }, data: { status: ListingStatus.EXPIRED } }),
      prisma.offer.updateMany({ where: { listingId: { in: ids }, status: OfferStatus.PENDING }, data: { status: OfferStatus.EXPIRED } }),
      prisma.auditLog.createMany({
        data: ids.map((id) => ({ actorId: 'SYSTEM', action: 'LISTING_EXPIRED', targetType: 'LISTING', targetId: id })),
      }),
    ]);

    for (const listing of expired) {
      NotificationsService.notifyListingExpired(listing.sellerId, listing.title, listing.id).catch(() => {});
    }
    return { expiredCount: expired.length };
  }
}
