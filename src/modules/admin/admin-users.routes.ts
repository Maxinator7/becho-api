import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../../common/prisma.js';
import { ApiError } from '../../common/errors/api-error.js';
import { authenticateToken, requireRole } from '../../common/middleware/auth-guard.js';
import { asyncHandler as wrap } from '../../common/async-handler.js';
import { id } from '../../common/validation.js';
import { ListingStatus, OfferStatus, UserRole, UserStatus } from '../../common/types/enums.js';
import { normalizeIndianPhone } from '../auth/auth.schema.js';

export const adminUsersRouter = Router();
adminUsersRouter.use(authenticateToken, requireRole(UserRole.ADMIN, UserRole.MODERATOR));

const STAFF: string[] = [UserRole.ADMIN, UserRole.MODERATOR];

const listQuery = z.object({
  search: z.string().trim().max(100).optional(),
  status: z.nativeEnum(UserStatus).optional(),
  role: z.nativeEnum(UserRole).optional(),
  sort: z.enum(['newest', 'oldest', 'last_login', 'name']).default('newest'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

const userListSelect = {
  id: true,
  userCode: true,
  displayName: true,
  email: true,
  phone: true,
  status: true,
  role: true,
  emailVerifiedAt: true,
  phoneVerifiedAt: true,
  lockedUntil: true,
  lastLoginAt: true,
  createdAt: true,
  _count: { select: { listings: true, buyerOffers: true } },
} satisfies Prisma.UserSelect;

// Search by name, email, mobile (any format) or user code.
adminUsersRouter.get('/', wrap(async (req, res) => {
  const q = listQuery.parse(req.query);
  const where: Prisma.UserWhereInput = {};
  if (q.status) where.status = q.status;
  if (q.role) where.role = q.role;
  if (q.search) {
    const term = q.search;
    const digits = term.replace(/\D/g, '');
    // Only treat the search as a phone number when it is mostly digits (so "BCH-T8EZM9" doesn't match every phone with an 8).
    const looksLikePhone = digits.length >= 4 && digits.length >= term.replace(/[\s+()-]/g, '').length - 1;
    const phone = normalizeIndianPhone(term);
    where.OR = [
      { displayName: { contains: term, mode: 'insensitive' } },
      { email: { contains: term, mode: 'insensitive' } },
      { userCode: { contains: term.toUpperCase() } },
      ...(looksLikePhone ? [{ phone: { contains: phone ?? digits } }] : []),
    ];
  }
  const orderBy: Prisma.UserOrderByWithRelationInput =
    q.sort === 'oldest' ? { createdAt: 'asc' }
    : q.sort === 'last_login' ? { lastLoginAt: { sort: 'desc', nulls: 'last' } }
    : q.sort === 'name' ? { displayName: 'asc' }
    : { createdAt: 'desc' };

  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({ where, select: userListSelect, orderBy: [orderBy, { id: 'asc' }], skip: (q.page - 1) * q.limit, take: q.limit }),
  ]);
  res.json({ success: true, data: { users, pagination: { total, page: q.page, limit: q.limit, totalPages: Math.ceil(total / q.limit) } } });
}));

// Full profile for review: activity counts, recent listings, staff notes and account history.
adminUsersRouter.get('/:id', wrap(async (req, res) => {
  const userId = id.parse(req.params.id);
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { ...userListSelect, failedLoginCount: true, statusReason: true, updatedAt: true },
  });
  if (!user) throw ApiError.notFound('User not found', 'USER_NOT_FOUND');

  const [listingsByStatus, offersMade, offersReceived, dealsAsBuyer, dealsAsSeller, messagesSent, recentListings, notes, history] = await Promise.all([
    prisma.listing.groupBy({ by: ['status'], where: { sellerId: userId }, _count: { _all: true } }),
    prisma.offer.count({ where: { buyerId: userId, proposedById: userId } }),
    prisma.offer.count({ where: { sellerId: userId } }),
    prisma.offer.count({ where: { buyerId: userId, status: OfferStatus.ACCEPTED } }),
    prisma.offer.count({ where: { sellerId: userId, status: OfferStatus.ACCEPTED } }),
    prisma.message.count({ where: { senderId: userId, kind: 'TEXT' } }),
    prisma.listing.findMany({
      where: { sellerId: userId, status: { not: ListingStatus.DELETED } },
      select: { id: true, title: true, price: true, status: true, verifiedAt: true, cityCode: true, createdAt: true, media: { take: 1, orderBy: { sortOrder: 'asc' }, select: { url: true } } },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
    prisma.userNote.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, note: true, createdAt: true, author: { select: { id: true, displayName: true } } },
    }),
    prisma.auditLog.findMany({
      where: { targetType: 'USER', targetId: userId },
      orderBy: { createdAt: 'desc' },
      take: 30,
      select: { id: true, action: true, actorId: true, details: true, createdAt: true },
    }),
  ]);

  // Name who did each action in the account history.
  const actorIds = [...new Set(history.map((h) => h.actorId))];
  const actors = actorIds.length
    ? await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, displayName: true, role: true } })
    : [];
  const actorById = new Map(actors.map((a) => [a.id, a]));

  res.json({
    success: true,
    data: {
      user,
      stats: {
        listingsByStatus: Object.fromEntries(listingsByStatus.map((g) => [g.status, g._count._all])),
        offersMade,
        offersReceived,
        dealsAsBuyer,
        dealsAsSeller,
        messagesSent,
      },
      recentListings,
      notes,
      history: history.map((h) => ({ ...h, actor: actorById.get(h.actorId) ?? null })),
    },
  });
}));

const statusSchema = z
  .object({
    status: z.enum([UserStatus.ACTIVE, UserStatus.SUSPENDED, UserStatus.BANNED]),
    reason: z.string().trim().max(500).optional(),
  })
  .refine((d) => d.status === UserStatus.ACTIVE || (d.reason && d.reason.length >= 5), {
    path: ['reason'],
    message: 'Give a reason (at least 5 characters) — the user sees it when they try to sign in',
  });

// Suspend / ban / reactivate. Admins only; staff accounts can't be changed here.
adminUsersRouter.post('/:id/status', requireRole(UserRole.ADMIN), wrap(async (req, res) => {
  const userId = id.parse(req.params.id);
  const { status, reason } = statusSchema.parse(req.body);
  const actorId = req.user!.userId;
  if (userId === actorId) throw ApiError.badRequest('You cannot change your own account status', 'CANNOT_CHANGE_SELF');

  const target = await prisma.user.findUnique({ where: { id: userId }, select: { role: true, status: true, emailVerifiedAt: true, phoneVerifiedAt: true } });
  if (!target) throw ApiError.notFound('User not found', 'USER_NOT_FOUND');
  if (STAFF.includes(target.role)) throw ApiError.forbidden('Staff accounts cannot be suspended or banned here', 'STAFF_ACCOUNT');

  const now = new Date();
  // Reactivating an account that never verified puts it back to "pending verification".
  const nextStatus = status === UserStatus.ACTIVE && !target.emailVerifiedAt && !target.phoneVerifiedAt ? UserStatus.PENDING_VERIFICATION : status;
  const blocking = status !== UserStatus.ACTIVE;

  const [user] = await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: { status: nextStatus, statusReason: blocking ? reason : null, ...(blocking ? {} : { lockedUntil: null, failedLoginCount: 0 }) },
      select: userListSelect,
    }),
    // Sign them out everywhere; their listings drop out of search automatically while blocked.
    ...(blocking ? [prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } })] : []),
    ...(blocking ? [prisma.offer.updateMany({ where: { OR: [{ buyerId: userId }, { sellerId: userId }], status: OfferStatus.PENDING }, data: { status: OfferStatus.CANCELLED } })] : []),
    prisma.auditLog.create({
      data: { actorId, action: `USER_${status}`, targetType: 'USER', targetId: userId, details: { from: target.status, to: nextStatus, reason: reason ?? null } },
    }),
  ]);
  res.json({ success: true, data: user });
}));

const noteSchema = z.object({ note: z.string().trim().min(2, 'Note is too short').max(2000) });

adminUsersRouter.post('/:id/notes', wrap(async (req, res) => {
  const userId = id.parse(req.params.id);
  const { note } = noteSchema.parse(req.body);
  if (!(await prisma.user.findUnique({ where: { id: userId }, select: { id: true } }))) throw ApiError.notFound('User not found', 'USER_NOT_FOUND');
  const created = await prisma.userNote.create({
    data: { userId, authorId: req.user!.userId, note },
    select: { id: true, note: true, createdAt: true, author: { select: { id: true, displayName: true } } },
  });
  res.status(201).json({ success: true, data: created });
}));

// Clear a temporary lock after too many wrong passwords (e.g. after confirming identity on a support call).
adminUsersRouter.post('/:id/unlock', wrap(async (req, res) => {
  const userId = id.parse(req.params.id);
  const user = await prisma.user.update({ where: { id: userId }, data: { lockedUntil: null, failedLoginCount: 0 }, select: userListSelect });
  await prisma.auditLog.create({ data: { actorId: req.user!.userId, action: 'USER_UNLOCKED', targetType: 'USER', targetId: userId } });
  res.json({ success: true, data: user });
}));
