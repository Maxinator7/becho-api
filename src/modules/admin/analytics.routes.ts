import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../../common/prisma.js';
import { authenticateToken, requireRole } from '../../common/middleware/auth-guard.js';
import { asyncHandler as wrap } from '../../common/async-handler.js';
import { ListingStatus, OfferStatus, UserRole, UserStatus } from '../../common/types/enums.js';

export const analyticsRouter = Router();
analyticsRouter.use(authenticateToken, requireRole(UserRole.ADMIN, UserRole.MODERATOR));

const TZ = 'Asia/Kolkata';
const query = z.object({ days: z.coerce.number().int().min(7).max(365).default(30) });

type DayRow = { day: string; count: bigint };

/** Count of rows per IST calendar day for the last `days` days, zero-filled. */
async function daily(table: string, column: string, days: number, extraWhere = Prisma.empty): Promise<Map<string, number>> {
  const rows = await prisma.$queryRaw<DayRow[]>`
    SELECT to_char(date_trunc('day', ${Prisma.raw(`"${column}"`)} AT TIME ZONE 'UTC' AT TIME ZONE ${TZ}), 'YYYY-MM-DD') AS day,
           count(*)::bigint AS count
    FROM ${Prisma.raw(`"${table}"`)}
    WHERE ${Prisma.raw(`"${column}"`)} >= now() - make_interval(days => ${days}::int) ${extraWhere}
    GROUP BY 1`;
  return new Map(rows.map((r) => [r.day, Number(r.count)]));
}

function dayKeys(days: number) {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
  return Array.from({ length: days }, (_, i) => fmt.format(new Date(Date.now() - (days - 1 - i) * 86_400_000)));
}

analyticsRouter.get('/', wrap(async (req, res) => {
  const { days } = query.parse(req.query);
  const since = new Date(Date.now() - days * 86_400_000);

  const [
    usersTotal, usersByStatus, usersNew, usersActiveInPeriod,
    listingsByStatus, listingsVerified, listingsNew,
    offersInPeriod, dealsInPeriod, soldInPeriod, messagesInPeriod, conversationsInPeriod,
    queueSize,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.user.count({ where: { createdAt: { gte: since } } }),
    prisma.user.count({ where: { lastLoginAt: { gte: since } } }),
    prisma.listing.groupBy({ by: ['status'], where: { status: { not: ListingStatus.DELETED } }, _count: { _all: true } }),
    prisma.listing.count({ where: { verifiedAt: { not: null }, status: { in: [ListingStatus.LIVE, ListingStatus.RESERVED] } } }),
    prisma.listing.count({ where: { createdAt: { gte: since } } }),
    prisma.offer.count({ where: { createdAt: { gte: since }, parentOfferId: null } }),
    prisma.auditLog.count({ where: { action: 'OFFER_ACCEPTED', createdAt: { gte: since } } }),
    prisma.listing.count({ where: { soldAt: { gte: since } } }),
    prisma.message.count({ where: { createdAt: { gte: since }, kind: 'TEXT' } }),
    prisma.conversation.count({ where: { createdAt: { gte: since } } }),
    prisma.listing.count({ where: { status: { in: [ListingStatus.PENDING_REVIEW, ListingStatus.SUBMITTED] } } }),
  ]);

  // Daily series for charts.
  const [newUsers, newListings, offers, messages, sold, deals] = await Promise.all([
    daily('users', 'created_at', days),
    daily('listings', 'created_at', days),
    daily('offers', 'created_at', days, Prisma.sql`AND parent_offer_id IS NULL`),
    daily('messages', 'created_at', days, Prisma.sql`AND kind = 'TEXT'`),
    daily('listings', 'sold_at', days),
    daily('audit_logs', 'created_at', days, Prisma.sql`AND action = 'OFFER_ACCEPTED'`),
  ]);
  const series = dayKeys(days).map((day) => ({
    day,
    newUsers: newUsers.get(day) ?? 0,
    newListings: newListings.get(day) ?? 0,
    offers: offers.get(day) ?? 0,
    messages: messages.get(day) ?? 0,
    deals: deals.get(day) ?? 0,
    sold: sold.get(day) ?? 0,
  }));

  // Where live supply is: by city and by top-level category.
  const [byCityRaw, areas, byCategoryRaw] = await Promise.all([
    prisma.listing.groupBy({ by: ['cityCode'], where: { status: ListingStatus.LIVE }, _count: { _all: true } }),
    prisma.serviceArea.findMany({ select: { cityCode: true, cityName: true } }),
    prisma.$queryRaw<{ name: string; count: bigint }[]>`
      SELECT coalesce(p.name, c.name) AS name, count(*)::bigint AS count
      FROM listings l
      JOIN categories c ON c.id = l.category_id
      LEFT JOIN categories p ON p.id = c.parent_id
      WHERE l.status = ${ListingStatus.LIVE}
      GROUP BY 1 ORDER BY 2 DESC`,
  ]);
  const cityName = new Map(areas.map((a) => [a.cityCode, a.cityName]));
  const byCity = byCityRaw
    .map((r) => ({ cityCode: r.cityCode, cityName: cityName.get(r.cityCode) ?? r.cityCode, count: r._count._all }))
    .sort((a, b) => b.count - a.count);
  const byCategory = byCategoryRaw.map((r) => ({ name: r.name, count: Number(r.count) }));

  // Marketplace funnel for listings published in the period.
  const [published, withOffer, withDeal, soldFromPublished] = await Promise.all([
    prisma.listing.count({ where: { publishedAt: { gte: since } } }),
    prisma.listing.count({ where: { publishedAt: { gte: since }, offers: { some: {} } } }),
    prisma.listing.count({ where: { publishedAt: { gte: since }, offers: { some: { status: OfferStatus.ACCEPTED } } } }),
    prisma.listing.count({ where: { publishedAt: { gte: since }, status: ListingStatus.SOLD } }),
  ]);

  // Moderation speed: hours from submission to approval for listings approved in the period.
  const [reviewSpeed] = await prisma.$queryRaw<{ avg_hours: number | null; reviewed: bigint }[]>`
    SELECT avg(extract(epoch FROM (approved_at - submitted_at)) / 3600)::float AS avg_hours, count(*)::bigint AS reviewed
    FROM listings WHERE approved_at >= ${since} AND submitted_at IS NOT NULL AND approved_at > submitted_at`;
  const reviewActions = await prisma.listingReview.groupBy({ by: ['action'], where: { createdAt: { gte: since } }, _count: { _all: true } });

  const byStatus = (groups: { status: string; _count: { _all: number } }[]) => Object.fromEntries(groups.map((g) => [g.status, g._count._all]));

  res.json({
    success: true,
    data: {
      periodDays: days,
      generatedAt: new Date().toISOString(),
      totals: {
        users: {
          total: usersTotal,
          byStatus: byStatus(usersByStatus),
          active: usersByStatus.find((g) => g.status === UserStatus.ACTIVE)?._count._all ?? 0,
          newInPeriod: usersNew,
          signedInInPeriod: usersActiveInPeriod,
        },
        listings: { byStatus: byStatus(listingsByStatus), verifiedLive: listingsVerified, newInPeriod: listingsNew },
        offersInPeriod,
        dealsInPeriod,
        soldInPeriod,
        messagesInPeriod,
        conversationsInPeriod,
      },
      series,
      byCity,
      byCategory,
      funnel: { published, withOffer, withDeal, sold: soldFromPublished },
      moderation: {
        queueSize,
        reviewedInPeriod: Number(reviewSpeed?.reviewed ?? 0),
        avgHoursToApprove: reviewSpeed?.avg_hours != null ? Math.round(reviewSpeed.avg_hours * 10) / 10 : null,
        actions: Object.fromEntries(reviewActions.map((r) => [r.action, r._count._all])),
      },
    },
  });
}));
