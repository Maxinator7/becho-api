import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { Prisma } from '@prisma/client';
import { prisma } from '../../common/prisma.js';
import { env } from '../../config/env.js';
import { ApiError } from '../../common/errors/api-error.js';
import { asyncHandler as wrap } from '../../common/async-handler.js';
import { authenticateToken, optionalAuth, requireRole } from '../../common/middleware/auth-guard.js';
import { id } from '../../common/validation.js';
import { UserRole } from '../../common/types/enums.js';

const SOURCES = ['WEB', 'MOBILE', 'ADMIN'] as const;
const CATEGORIES = ['BUG', 'IDEA', 'CONFUSING', 'PRAISE', 'OTHER'] as const;
const STATUSES = ['NEW', 'IN_PROGRESS', 'DONE', 'WONT_FIX'] as const;

/** Beta testers send feedback from the website, app or admin portal (signed in or not). */
export const feedbackRouter = Router();

const feedbackLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { success: false, error: { code: 'RATE_LIMITED', message: 'Thanks! You have sent a lot of feedback this hour — please try again later.' } },
  skip: () => env.NODE_ENV === 'test',
});

const submitSchema = z.object({
  source: z.enum(SOURCES),
  category: z.enum(CATEGORIES).default('OTHER'),
  rating: z.number().int().min(1).max(5).optional(),
  message: z.string().trim().min(3, 'Tell us a little more (at least 3 characters)').max(2000),
  page: z.string().trim().max(300).optional(),
  appVersion: z.string().trim().max(40).optional(),
  contactOk: z.boolean().default(false),
});

feedbackRouter.post('/', feedbackLimit, optionalAuth, wrap(async (req, res) => {
  const input = submitSchema.parse(req.body);
  const created = await prisma.feedback.create({
    data: {
      ...input,
      userId: req.user?.userId ?? null,
      userAgent: String(req.headers['user-agent'] ?? '').slice(0, 300) || null,
    },
    select: { id: true, createdAt: true },
  });
  res.status(201).json({ success: true, data: { ...created, message: 'Thank you — your feedback was sent to the Becho team.' } });
}));

/** Staff inbox for beta feedback. */
export const adminFeedbackRouter = Router();
adminFeedbackRouter.use(authenticateToken, requireRole(UserRole.ADMIN, UserRole.MODERATOR));

const listQuery = z.object({
  status: z.enum(STATUSES).optional(),
  source: z.enum(SOURCES).optional(),
  category: z.enum(CATEGORIES).optional(),
  search: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

adminFeedbackRouter.get('/', wrap(async (req, res) => {
  const q = listQuery.parse(req.query);
  const where: Prisma.FeedbackWhereInput = {};
  if (q.status) where.status = q.status;
  if (q.source) where.source = q.source;
  if (q.category) where.category = q.category;
  if (q.search) where.message = { contains: q.search, mode: 'insensitive' };

  const [total, items, byStatus, avg] = await Promise.all([
    prisma.feedback.count({ where }),
    prisma.feedback.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (q.page - 1) * q.limit,
      take: q.limit,
      include: { user: { select: { id: true, userCode: true, displayName: true, email: true, phone: true } } },
    }),
    prisma.feedback.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.feedback.aggregate({ _avg: { rating: true }, _count: { rating: true } }),
  ]);
  res.json({
    success: true,
    data: {
      items,
      pagination: { total, page: q.page, limit: q.limit, totalPages: Math.ceil(total / q.limit) },
      summary: {
        byStatus: Object.fromEntries(byStatus.map((g) => [g.status, g._count._all])),
        averageRating: avg._avg.rating != null ? Math.round(avg._avg.rating * 10) / 10 : null,
        ratedCount: avg._count.rating,
      },
    },
  });
}));

const updateSchema = z.object({
  status: z.enum(STATUSES).optional(),
  staffNote: z.string().trim().max(2000).nullable().optional(),
}).refine((d) => d.status !== undefined || d.staffNote !== undefined, 'Nothing to update');

adminFeedbackRouter.patch('/:id', wrap(async (req, res) => {
  const feedbackId = id.parse(req.params.id);
  const input = updateSchema.parse(req.body);
  const existing = await prisma.feedback.findUnique({ where: { id: feedbackId }, select: { id: true } });
  if (!existing) throw ApiError.notFound('Feedback not found', 'FEEDBACK_NOT_FOUND');
  const updated = await prisma.feedback.update({ where: { id: feedbackId }, data: input });
  res.json({ success: true, data: updated });
}));
