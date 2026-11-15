import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../../common/prisma.js';
import { ApiError } from '../../common/errors/api-error.js';
import { authenticateToken, requireRole } from '../../common/middleware/auth-guard.js';
import { asyncHandler as wrap } from '../../common/async-handler.js';
import { id } from '../../common/validation.js';
import { ListingStatus, OfferStatus, UserRole } from '../../common/types/enums.js';
import { NotificationsService } from '../notifications/notifications.service.js';

export const adminListingsRouter = Router();
adminListingsRouter.use(authenticateToken, requireRole(UserRole.ADMIN, UserRole.MODERATOR));

const listQuery = z.object({
  status: z.nativeEnum(ListingStatus).optional(),
  search: z.string().trim().max(100).optional(),
  cityCode: z.string().trim().toUpperCase().optional(),
  categoryId: id.optional(),
  sellerId: id.optional(),
  verified: z.enum(['true', 'false']).optional(),
  sort: z.enum(['newest', 'oldest', 'price_desc', 'price_asc']).default('newest'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

// All listings (any status except deleted, unless asked for) with filters for review work.
adminListingsRouter.get('/', wrap(async (req, res) => {
  const q = listQuery.parse(req.query);
  const where: Prisma.ListingWhereInput = { status: q.status ?? { not: ListingStatus.DELETED } };
  if (q.cityCode) where.cityCode = q.cityCode;
  if (q.sellerId) where.sellerId = q.sellerId;
  if (q.verified) where.verifiedAt = q.verified === 'true' ? { not: null } : null;
  if (q.categoryId) {
    const children = await prisma.category.findMany({ where: { parentId: q.categoryId }, select: { id: true } });
    where.categoryId = { in: [q.categoryId, ...children.map((c) => c.id)] };
  }
  if (q.search) {
    where.OR = [
      { title: { contains: q.search, mode: 'insensitive' } },
      { description: { contains: q.search, mode: 'insensitive' } },
      { seller: { userCode: { contains: q.search.toUpperCase() } } },
      { seller: { displayName: { contains: q.search, mode: 'insensitive' } } },
    ];
  }
  const orderBy: Prisma.ListingOrderByWithRelationInput =
    q.sort === 'oldest' ? { createdAt: 'asc' } : q.sort === 'price_desc' ? { price: 'desc' } : q.sort === 'price_asc' ? { price: 'asc' } : { createdAt: 'desc' };

  const [total, listings] = await Promise.all([
    prisma.listing.count({ where }),
    prisma.listing.findMany({
      where,
      select: {
        id: true, title: true, price: true, status: true, condition: true, cityCode: true, stateCode: true,
        verifiedAt: true, createdAt: true, publishedAt: true, submittedAt: true,
        seller: { select: { id: true, userCode: true, displayName: true, status: true, emailVerifiedAt: true, phoneVerifiedAt: true, createdAt: true } },
        category: { select: { id: true, name: true } },
        media: { take: 1, orderBy: { sortOrder: 'asc' }, select: { url: true, mediaType: true } },
        sanitization: { select: { status: true, score: true } },
        reviews: { take: 1, orderBy: { createdAt: 'desc' }, select: { action: true, remark: true, createdAt: true } },
        _count: { select: { offers: true, conversations: true, media: true } },
      },
      orderBy: [orderBy, { id: 'asc' }],
      skip: (q.page - 1) * q.limit,
      take: q.limit,
    }),
  ]);
  res.json({ success: true, data: { listings, pagination: { total, page: q.page, limit: q.limit, totalPages: Math.ceil(total / q.limit) } } });
}));

adminListingsRouter.get('/:id', wrap(async (req, res) => {
  const listingId = id.parse(req.params.id);
  const listing = await prisma.listing.findUnique({
    where: { id: listingId },
    include: {
      seller: { select: { id: true, userCode: true, displayName: true, email: true, phone: true, status: true, createdAt: true } },
      category: { select: { id: true, name: true, parent: { select: { name: true } } } },
      attributes: { include: { attributeDefinition: { select: { name: true, dataType: true } } } },
      media: { orderBy: { sortOrder: 'asc' } },
      sanitization: true,
      reviews: { orderBy: { createdAt: 'desc' }, include: { reviewer: { select: { id: true, displayName: true } } } },
      _count: { select: { offers: true, conversations: true, favorites: true } },
    },
  });
  if (!listing) throw ApiError.notFound('Listing not found', 'LISTING_NOT_FOUND');
  const offers = await prisma.offer.groupBy({ by: ['status'], where: { listingId }, _count: { _all: true } });
  res.json({ success: true, data: { ...listing, offerStats: Object.fromEntries(offers.map((o) => [o.status, o._count._all])) } });
}));

const remarkSchema = z.object({ remark: z.string().trim().max(1000).optional() }).default({});
const requiredRemark = z.object({ remark: z.string().trim().min(5, 'Explain what the seller should change (at least 5 characters)').max(1000) });

async function loadListing(listingId: string) {
  const listing = await prisma.listing.findUnique({ where: { id: listingId }, select: { id: true, title: true, status: true, sellerId: true, verifiedAt: true } });
  if (!listing) throw ApiError.notFound('Listing not found', 'LISTING_NOT_FOUND');
  return listing;
}

const VERIFIABLE: string[] = [ListingStatus.LIVE, ListingStatus.RESERVED];

// "Verified" badge: staff have checked the listing (photos, details, seller).
adminListingsRouter.post('/:id/verify', wrap(async (req, res) => {
  const listingId = id.parse(req.params.id);
  const { remark } = remarkSchema.parse(req.body ?? {});
  const listing = await loadListing(listingId);
  if (!VERIFIABLE.includes(listing.status)) throw ApiError.badRequest('Only live or reserved listings can be verified', 'INVALID_LISTING_STATE');
  const actorId = req.user!.userId;
  await prisma.$transaction([
    prisma.listing.update({ where: { id: listingId }, data: { verifiedAt: new Date(), verifiedById: actorId } }),
    prisma.listingReview.create({ data: { listingId, reviewerId: actorId, action: 'VERIFIED', remark: remark || null } }),
    prisma.auditLog.create({ data: { actorId, action: 'LISTING_VERIFIED', targetType: 'LISTING', targetId: listingId } }),
  ]);
  if (!listing.verifiedAt) NotificationsService.notifyListingReview(listing.sellerId, listing.title, listingId, 'VERIFIED', remark).catch(() => {});
  res.json({ success: true, data: { id: listingId, verified: true } });
}));

adminListingsRouter.post('/:id/unverify', wrap(async (req, res) => {
  const listingId = id.parse(req.params.id);
  const { remark } = remarkSchema.parse(req.body ?? {});
  await loadListing(listingId);
  const actorId = req.user!.userId;
  await prisma.$transaction([
    prisma.listing.update({ where: { id: listingId }, data: { verifiedAt: null, verifiedById: null } }),
    // Internal: the seller isn't told the badge was removed.
    prisma.listingReview.create({ data: { listingId, reviewerId: actorId, action: 'UNVERIFIED', remark: remark || null, visibleToSeller: false } }),
    prisma.auditLog.create({ data: { actorId, action: 'LISTING_UNVERIFIED', targetType: 'LISTING', targetId: listingId } }),
  ]);
  res.json({ success: true, data: { id: listingId, verified: false } });
}));

const CHANGEABLE: string[] = [ListingStatus.LIVE, ListingStatus.PENDING_REVIEW, ListingStatus.SUBMITTED];

/**
 * Sends the listing back to the seller. It leaves search until edited and resubmitted;
 * open offers are cancelled because the item may change.
 */
adminListingsRouter.post('/:id/request-changes', wrap(async (req, res) => {
  const listingId = id.parse(req.params.id);
  const { remark } = requiredRemark.parse(req.body ?? {});
  const actorId = req.user!.userId;

  const { count } = await prisma.listing.updateMany({
    where: { id: listingId, status: { in: CHANGEABLE } },
    data: { status: ListingStatus.CHANGES_REQUESTED, verifiedAt: null, verifiedById: null },
  });
  const listing = await loadListing(listingId);
  if (count === 0) throw ApiError.badRequest(`A ${listing.status.toLowerCase().replace(/_/g, ' ')} listing can't be sent back for changes`, 'INVALID_LISTING_STATE');

  await prisma.$transaction([
    prisma.offer.updateMany({ where: { listingId, status: OfferStatus.PENDING }, data: { status: OfferStatus.CANCELLED } }),
    prisma.listingReview.create({ data: { listingId, reviewerId: actorId, action: 'CHANGES_REQUESTED', remark } }),
    prisma.auditLog.create({ data: { actorId, action: 'LISTING_CHANGES_REQUESTED', targetType: 'LISTING', targetId: listingId, details: { remark } } }),
  ]);
  NotificationsService.notifyListingReview(listing.sellerId, listing.title, listingId, 'CHANGES_REQUESTED', remark).catch(() => {});
  res.json({ success: true, data: { id: listingId, status: ListingStatus.CHANGES_REQUESTED } });
}));

const remarkBody = z.object({
  remark: z.string().trim().min(2, 'Remark is too short').max(1000),
  visibleToSeller: z.boolean().default(true),
});

// A note on the listing: shown to the seller (and notified), or kept internal for staff.
adminListingsRouter.post('/:id/remarks', wrap(async (req, res) => {
  const listingId = id.parse(req.params.id);
  const { remark, visibleToSeller } = remarkBody.parse(req.body);
  const listing = await loadListing(listingId);
  const review = await prisma.listingReview.create({
    data: { listingId, reviewerId: req.user!.userId, action: 'REMARK', remark, visibleToSeller },
    include: { reviewer: { select: { id: true, displayName: true } } },
  });
  if (visibleToSeller) NotificationsService.notifyListingReview(listing.sellerId, listing.title, listingId, 'REMARK', remark).catch(() => {});
  res.status(201).json({ success: true, data: review });
}));
