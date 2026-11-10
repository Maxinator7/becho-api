import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../common/prisma.js';
import { ApiError } from '../../common/errors/api-error.js';
import { authenticateToken, requireRole } from '../../common/middleware/auth-guard.js';
import { asyncHandler as wrap } from '../../common/async-handler.js';
import { id } from '../../common/validation.js';
import { UserRole, ListingStatus, SanitizationStatus, OfferStatus } from '../../common/types/enums.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { LISTING_TTL_DAYS } from '../listings/listings.service.js';

export const moderationRouter = Router();

const REVIEWABLE: string[] = [ListingStatus.PENDING_REVIEW, ListingStatus.SUBMITTED];
const SUSPENDABLE: string[] = [ListingStatus.LIVE, ListingStatus.RESERVED, ListingStatus.PENDING_REVIEW];

const noteSchema = z.object({ note: z.string().trim().max(500).optional() }).default({});
const reasonSchema = z.object({ reason: z.string().trim().max(500).optional() }).default({});

/** Moves a listing from one of `from` statuses; throws if it changed in the meantime. */
async function transition(listingId: string, from: string[], data: Parameters<typeof prisma.listing.update>[0]['data']) {
  const { count } = await prisma.listing.updateMany({ where: { id: listingId, status: { in: from } }, data });
  if (count === 0) {
    const exists = await prisma.listing.findUnique({ where: { id: listingId }, select: { status: true } });
    if (!exists) throw ApiError.notFound('Listing not found', 'LISTING_NOT_FOUND');
    throw ApiError.badRequest(`Listing is ${exists.status} and cannot be changed by this action`, 'INVALID_LISTING_STATE');
  }
  return prisma.listing.findUniqueOrThrow({ where: { id: listingId } });
}

// Require Moderator or Admin for all endpoints
moderationRouter.use(authenticateToken, requireRole(UserRole.ADMIN, UserRole.MODERATOR));

moderationRouter.get('/queue', wrap(async (_req, res) => {
  const queue = await prisma.listing.findMany({
    where: { status: { in: REVIEWABLE } },
    include: {
      seller: { select: { id: true, displayName: true, email: true, phone: true } },
      category: { select: { name: true } },
      sanitization: true,
      media: { orderBy: { sortOrder: 'asc' } },
    },
    orderBy: { submittedAt: 'asc' },
  });
  res.json({ success: true, data: queue });
}));

moderationRouter.post('/listings/:id/approve', wrap(async (req, res) => {
  const listingId = id.parse(req.params.id);
  const { note } = noteSchema.parse(req.body ?? {});
  const actorId = req.user!.userId;
  const now = new Date();

  const listing = await transition(listingId, REVIEWABLE, {
    status: ListingStatus.LIVE,
    approvedAt: now,
    publishedAt: now,
    expiresAt: new Date(now.getTime() + LISTING_TTL_DAYS * 24 * 60 * 60 * 1000),
  });

  await prisma.$transaction([
    prisma.listingSanitization.updateMany({
      where: { listingId },
      data: { status: SanitizationStatus.PASSED, reviewedBy: actorId, reviewedAt: now },
    }),
    prisma.auditLog.create({
      data: { actorId, action: 'LISTING_APPROVED', targetType: 'LISTING', targetId: listingId, details: { note: note || 'Manually approved by moderator' } },
    }),
  ]);

  NotificationsService.notifyListingApproved(listing.sellerId, listing.title, listing.id).catch(() => {});
  res.json({ success: true, data: listing });
}));

moderationRouter.post('/listings/:id/reject', wrap(async (req, res) => {
  const listingId = id.parse(req.params.id);
  const { reason } = reasonSchema.parse(req.body ?? {});
  const actorId = req.user!.userId;

  const listing = await transition(listingId, REVIEWABLE, { status: ListingStatus.REJECTED });
  await prisma.$transaction([
    prisma.listingSanitization.updateMany({ where: { listingId }, data: { reviewedBy: actorId, reviewedAt: new Date() } }),
    prisma.auditLog.create({
      data: { actorId, action: 'LISTING_REJECTED', targetType: 'LISTING', targetId: listingId, details: { reason: reason || 'Violates community guidelines' } },
    }),
  ]);

  NotificationsService.notifyListingRejected(listing.sellerId, listing.title, listingId, reason).catch(() => {});
  res.json({ success: true, data: listing });
}));

moderationRouter.post('/listings/:id/suspend', wrap(async (req, res) => {
  const listingId = id.parse(req.params.id);
  const { reason } = reasonSchema.parse(req.body ?? {});
  const actorId = req.user!.userId;

  const listing = await transition(listingId, SUSPENDABLE, { status: ListingStatus.SUSPENDED });
  await prisma.$transaction([
    prisma.offer.updateMany({ where: { listingId, status: OfferStatus.PENDING }, data: { status: OfferStatus.CANCELLED } }),
    prisma.auditLog.create({
      data: { actorId, action: 'LISTING_SUSPENDED', targetType: 'LISTING', targetId: listingId, details: { reason: reason || 'Suspended by admin' } },
    }),
  ]);

  NotificationsService.notifyListingSuspended(listing.sellerId, listing.title, listingId, reason).catch(() => {});
  res.json({ success: true, data: listing });
}));
