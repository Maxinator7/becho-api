import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../../common/prisma.js';
import { ApiError } from '../../common/errors/api-error.js';
import { authenticateToken, requireRole } from '../../common/middleware/auth-guard.js';
import { UserRole, ListingStatus, SanitizationStatus } from '../../common/types/enums.js';
import { NotificationsService } from '../notifications/notifications.service.js';

export const moderationRouter = Router();

// Require Moderator or Admin for all endpoints
moderationRouter.use(authenticateToken, requireRole(UserRole.ADMIN, UserRole.MODERATOR));

// GET /api/v1/admin/moderation/queue
moderationRouter.get('/queue', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const queue = await prisma.listing.findMany({
      where: {
        status: { in: [ListingStatus.PENDING_REVIEW, ListingStatus.SUBMITTED] },
      },
      include: {
        seller: { select: { id: true, displayName: true, email: true, phone: true } },
        category: { select: { name: true } },
        sanitization: true,
        media: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    res.json({ success: true, data: queue });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/admin/moderation/listings/:id/approve
moderationRouter.post('/listings/:id/approve', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const listingId = req.params.id;
    const actorId = req.user!.userId;

    const listing = await prisma.listing.update({
      where: { id: listingId },
      data: {
        status: ListingStatus.LIVE,
        approvedAt: new Date(),
        publishedAt: new Date(),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });

    await prisma.listingSanitization.updateMany({
      where: { listingId },
      data: {
        status: SanitizationStatus.PASSED,
        reviewedBy: actorId,
        reviewedAt: new Date(),
      },
    });

    await prisma.auditLog.create({
      data: {
        actorId,
        action: 'LISTING_APPROVED',
        targetType: 'LISTING',
        targetId: listingId,
        details: JSON.stringify({ note: req.body?.note || 'Manually approved by moderator' }),
      },
    });

    // Notify seller
    NotificationsService.notifyListingApproved(listing.sellerId, listing.title, listing.id).catch(() => {});

    res.json({ success: true, data: listing });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/admin/moderation/listings/:id/reject
moderationRouter.post('/listings/:id/reject', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const listingId = req.params.id;
    const actorId = req.user!.userId;

    const listing = await prisma.listing.update({
      where: { id: listingId },
      data: { status: ListingStatus.REJECTED },
    });

    await prisma.auditLog.create({
      data: {
        actorId,
        action: 'LISTING_REJECTED',
        targetType: 'LISTING',
        targetId: listingId,
        details: JSON.stringify({ reason: req.body?.reason || 'Violates community guidelines' }),
      },
    });

    // Notify seller
    NotificationsService.notifyListingRejected(listing.sellerId, listing.title, listingId, req.body?.reason).catch(() => {});

    res.json({ success: true, data: listing });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/admin/moderation/listings/:id/suspend
moderationRouter.post('/listings/:id/suspend', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const listingId = req.params.id;
    const actorId = req.user!.userId;

    const listing = await prisma.listing.update({
      where: { id: listingId },
      data: { status: ListingStatus.SUSPENDED },
    });

    await prisma.auditLog.create({
      data: {
        actorId,
        action: 'LISTING_SUSPENDED',
        targetType: 'LISTING',
        targetId: listingId,
        details: JSON.stringify({ reason: req.body?.reason || 'Suspended by admin' }),
      },
    });

    // Notify seller
    NotificationsService.notifyListingSuspended(listing.sellerId, listing.title, listingId, req.body?.reason).catch(() => {});

    res.json({ success: true, data: listing });
  } catch (err) {
    next(err);
  }
});
