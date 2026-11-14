import { Offer, Prisma } from '@prisma/client';
import { prisma } from '../../common/prisma.js';
import { ApiError } from '../../common/errors/api-error.js';
import { ListingStatus, OfferStatus } from '../../common/types/enums.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { ConversationEvent, postConversationEvent } from '../chat/conversation-events.js';

const OFFER_EXPIRY_HOURS = 48;
const offerExpiry = () => new Date(Date.now() + OFFER_EXPIRY_HOURS * 60 * 60 * 1000);

export interface OfferAmountInput {
  amount: number;
  message?: string;
}

const offerInclude = {
  buyer: { select: { id: true, displayName: true } },
  seller: { select: { id: true, displayName: true } },
  proposedBy: { select: { id: true, displayName: true } },
  listing: { select: { id: true, title: true, price: true, currency: true, status: true } },
  parentOffer: { select: { id: true, amount: true, status: true, proposedById: true } },
} satisfies Prisma.OfferInclude;

/**
 * Negotiation model
 * - buyerId / sellerId are fixed for the whole negotiation (seller = listing owner).
 * - proposedById is whoever put this amount on the table.
 * - Only the *other* party can accept, reject or counter an offer.
 * - Only the proposer can cancel (withdraw) it.
 */
export class OffersService {
  private static async getPendingOffer(offerId: string) {
    const offer = await prisma.offer.findUnique({ where: { id: offerId } });
    if (!offer) throw ApiError.notFound('Offer not found', 'OFFER_NOT_FOUND');
    if (offer.status !== OfferStatus.PENDING) throw ApiError.badRequest('Offer is no longer active', 'OFFER_NOT_PENDING');
    if (offer.expiresAt && offer.expiresAt < new Date()) {
      await prisma.offer.update({ where: { id: offerId }, data: { status: OfferStatus.EXPIRED } });
      throw ApiError.badRequest('Offer has expired', 'OFFER_EXPIRED');
    }
    return offer;
  }

  /** Asserts the actor is a party but NOT the proposer (i.e. it's their turn to respond). */
  private static assertResponder(offer: Offer, actorId: string) {
    if (offer.buyerId !== actorId && offer.sellerId !== actorId) {
      throw ApiError.forbidden('You are not a party to this offer', 'FORBIDDEN');
    }
    if (offer.proposedById === actorId) {
      throw ApiError.badRequest('You cannot respond to your own offer', 'OWN_OFFER');
    }
  }

  private static async assertListingLive(listingId: string) {
    const listing = await prisma.listing.findUnique({ where: { id: listingId } });
    if (!listing) throw ApiError.notFound('Listing not found', 'LISTING_NOT_FOUND');
    if (listing.status !== ListingStatus.LIVE) {
      throw ApiError.badRequest('Listing is not available for offers', 'LISTING_NOT_LIVE');
    }
    return listing;
  }

  /** Buyer opens (or restarts) a negotiation. Any open offer in this buyer's thread is superseded. */
  static async createOffer(buyerId: string, input: OfferAmountInput & { listingId: string }) {
    const listing = await this.assertListingLive(input.listingId);
    if (listing.sellerId === buyerId) {
      throw ApiError.badRequest('You cannot make an offer on your own listing', 'CANNOT_OFFER_OWN_LISTING');
    }

    const offer = await prisma.$transaction(async (tx) => {
      await tx.offer.updateMany({
        where: { listingId: listing.id, buyerId, status: OfferStatus.PENDING },
        data: { status: OfferStatus.CANCELLED },
      });
      const created = await tx.offer.create({
        data: {
          listingId: listing.id,
          buyerId,
          sellerId: listing.sellerId,
          proposedById: buyerId,
          amount: input.amount,
          message: input.message || null,
          status: OfferStatus.PENDING,
          expiresAt: offerExpiry(),
        },
        include: offerInclude,
      });
      await postConversationEvent({
        listingId: created.listingId, buyerId, sellerId: created.sellerId, actorId: buyerId,
        actorName: created.buyer.displayName, event: ConversationEvent.OFFER_MADE, amount: created.amount, offerId: created.id,
      }, tx);
      return created;
    });

    NotificationsService.notifyOfferCreated(
      offer.sellerId, offer.buyer.displayName, offer.amount, offer.listing.title, offer.id, offer.listingId
    ).catch(() => {});

    return offer;
  }

  /** The responding party proposes a different amount. */
  static async counterOffer(offerId: string, actorId: string, input: OfferAmountInput) {
    const offer = await this.getPendingOffer(offerId);
    this.assertResponder(offer, actorId);
    await this.assertListingLive(offer.listingId);

    const counter = await prisma.$transaction(async (tx) => {
      const { count } = await tx.offer.updateMany({
        where: { id: offerId, status: OfferStatus.PENDING },
        data: { status: OfferStatus.COUNTERED },
      });
      if (count === 0) throw ApiError.badRequest('Offer is no longer active', 'OFFER_NOT_PENDING');

      const created = await tx.offer.create({
        data: {
          listingId: offer.listingId,
          buyerId: offer.buyerId,
          sellerId: offer.sellerId,
          proposedById: actorId,
          amount: input.amount,
          message: input.message || null,
          status: OfferStatus.PENDING,
          parentOfferId: offerId,
          expiresAt: offerExpiry(),
        },
        include: offerInclude,
      });
      await postConversationEvent({
        listingId: created.listingId, buyerId: created.buyerId, sellerId: created.sellerId, actorId,
        actorName: created.proposedBy.displayName, event: ConversationEvent.OFFER_COUNTERED, amount: created.amount, offerId: created.id,
      }, tx);
      return created;
    });

    const recipientId = actorId === offer.sellerId ? offer.buyerId : offer.sellerId;
    NotificationsService.notifyOfferCountered(
      recipientId, counter.proposedBy.displayName, counter.amount, counter.listing.title, counter.id, counter.listingId
    ).catch(() => {});

    return counter;
  }

  /**
   * The responding party accepts. The listing becomes RESERVED for this buyer and every
   * other open offer on the listing is rejected. Race-safe: concurrent accepts can't both win.
   */
  static async acceptOffer(offerId: string, actorId: string) {
    const offer = await this.getPendingOffer(offerId);
    this.assertResponder(offer, actorId);

    const { accepted, competing } = await prisma.$transaction(async (tx) => {
      const offerUpdate = await tx.offer.updateMany({
        where: { id: offerId, status: OfferStatus.PENDING },
        data: { status: OfferStatus.ACCEPTED },
      });
      if (offerUpdate.count === 0) throw ApiError.badRequest('Offer is no longer active', 'OFFER_NOT_PENDING');

      const listingUpdate = await tx.listing.updateMany({
        where: { id: offer.listingId, status: ListingStatus.LIVE },
        data: { status: ListingStatus.RESERVED, reservedAt: new Date() },
      });
      if (listingUpdate.count === 0) {
        throw ApiError.badRequest('Listing is no longer available', 'LISTING_NOT_LIVE');
      }

      const competing = await tx.offer.findMany({
        where: { listingId: offer.listingId, status: OfferStatus.PENDING, id: { not: offerId } },
        select: { id: true, buyerId: true, sellerId: true, amount: true },
      });
      await tx.offer.updateMany({
        where: { id: { in: competing.map((o) => o.id) } },
        data: { status: OfferStatus.REJECTED },
      });

      await tx.auditLog.create({
        data: {
          actorId,
          action: 'OFFER_ACCEPTED',
          targetType: 'OFFER',
          targetId: offerId,
          details: { listingId: offer.listingId, amount: offer.amount },
        },
      });

      const accepted = await tx.offer.findUniqueOrThrow({ where: { id: offerId }, include: offerInclude });
      const actorName = actorId === accepted.sellerId ? accepted.seller.displayName : accepted.buyer.displayName;
      await postConversationEvent({
        listingId: accepted.listingId, buyerId: accepted.buyerId, sellerId: accepted.sellerId, actorId,
        actorName, event: ConversationEvent.OFFER_ACCEPTED, amount: accepted.amount, offerId,
      }, tx);
      // Other buyers' open offers are closed because the item is now reserved for someone else.
      for (const other of competing) {
        await postConversationEvent({
          listingId: offer.listingId, buyerId: other.buyerId, sellerId: other.sellerId, actorId: other.sellerId,
          actorName: accepted.seller.displayName, event: ConversationEvent.OFFER_REJECTED, amount: other.amount, offerId: other.id,
        }, tx);
      }

      return { accepted, competing };
    });

    const actorName = actorId === accepted.sellerId ? accepted.seller.displayName : accepted.buyer.displayName;
    NotificationsService.notifyOfferAccepted(
      accepted.proposedById, actorName, accepted.amount, accepted.listing.title, accepted.id, accepted.listingId
    ).catch(() => {});
    for (const other of competing) {
      NotificationsService.notifyOfferRejected(
        other.buyerId, accepted.seller.displayName, other.amount, accepted.listing.title, other.id, accepted.listingId
      ).catch(() => {});
    }

    return accepted;
  }

  /** The responding party declines. */
  static async rejectOffer(offerId: string, actorId: string) {
    const offer = await this.getPendingOffer(offerId);
    this.assertResponder(offer, actorId);

    const actorName = await prisma.$transaction(async (tx) => {
      const { count } = await tx.offer.updateMany({ where: { id: offerId, status: OfferStatus.PENDING }, data: { status: OfferStatus.REJECTED } });
      if (count === 0) throw ApiError.badRequest('Offer is no longer active', 'OFFER_NOT_PENDING');
      const actor = await tx.user.findUniqueOrThrow({ where: { id: actorId }, select: { displayName: true } });
      await postConversationEvent({
        listingId: offer.listingId, buyerId: offer.buyerId, sellerId: offer.sellerId, actorId,
        actorName: actor.displayName, event: ConversationEvent.OFFER_REJECTED, amount: offer.amount, offerId,
      }, tx);
      return actor.displayName;
    });
    const updated = await prisma.offer.findUniqueOrThrow({ where: { id: offerId }, include: offerInclude });

    NotificationsService.notifyOfferRejected(
      updated.proposedById, actorName, updated.amount, updated.listing.title, updated.id, updated.listingId
    ).catch(() => {});

    return updated;
  }

  /** The proposer withdraws their own pending offer. */
  static async cancelOffer(offerId: string, actorId: string) {
    const offer = await prisma.offer.findUnique({ where: { id: offerId } });
    if (!offer) throw ApiError.notFound('Offer not found', 'OFFER_NOT_FOUND');
    if (offer.proposedById !== actorId) throw ApiError.forbidden('Only the person who made this offer can withdraw it', 'FORBIDDEN');
    if (offer.status !== OfferStatus.PENDING) throw ApiError.badRequest('Offer is no longer active', 'OFFER_NOT_PENDING');

    await prisma.$transaction(async (tx) => {
      const { count } = await tx.offer.updateMany({ where: { id: offerId, status: OfferStatus.PENDING }, data: { status: OfferStatus.CANCELLED } });
      if (count === 0) throw ApiError.badRequest('Offer is no longer active', 'OFFER_NOT_PENDING');
      const actor = await tx.user.findUniqueOrThrow({ where: { id: actorId }, select: { displayName: true } });
      await postConversationEvent({
        listingId: offer.listingId, buyerId: offer.buyerId, sellerId: offer.sellerId, actorId,
        actorName: actor.displayName, event: ConversationEvent.OFFER_WITHDRAWN, amount: offer.amount, offerId,
      }, tx);
    });
    return prisma.offer.findUniqueOrThrow({ where: { id: offerId }, include: offerInclude });
  }

  // ───────────────────────── reads ─────────────────────────

  static async getListingOffers(listingId: string, sellerId: string) {
    const listing = await prisma.listing.findUnique({ where: { id: listingId } });
    if (!listing) throw ApiError.notFound('Listing not found', 'LISTING_NOT_FOUND');
    if (listing.sellerId !== sellerId) throw ApiError.forbidden('Only the seller can view all offers', 'FORBIDDEN');

    return prisma.offer.findMany({ where: { listingId }, include: offerInclude, orderBy: { createdAt: 'desc' } });
  }

  /** Offers in negotiations where I am the buyer. */
  static async getMyOffers(buyerId: string) {
    return prisma.offer.findMany({
      where: { buyerId },
      include: {
        ...offerInclude,
        listing: { select: { id: true, title: true, price: true, currency: true, status: true, media: { take: 1, orderBy: { sortOrder: 'asc' } } } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Offers in negotiations where I am the seller. */
  static async getReceivedOffers(sellerId: string) {
    return prisma.offer.findMany({
      where: { sellerId },
      include: {
        ...offerInclude,
        listing: { select: { id: true, title: true, price: true, currency: true, status: true, media: { take: 1, orderBy: { sortOrder: 'asc' } } } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Full negotiation history for one listing-buyer pair. */
  static async getOfferChain(listingId: string, buyerId: string, actorId: string) {
    const listing = await prisma.listing.findUnique({ where: { id: listingId } });
    if (!listing) throw ApiError.notFound('Listing not found', 'LISTING_NOT_FOUND');
    if (actorId !== buyerId && actorId !== listing.sellerId) throw ApiError.forbidden('Access denied', 'FORBIDDEN');

    return prisma.offer.findMany({ where: { listingId, buyerId }, include: offerInclude, orderBy: { createdAt: 'asc' } });
  }

  // ───────────────────────── background job ─────────────────────────

  static async expireOffers() {
    const { count } = await prisma.offer.updateMany({
      where: { status: OfferStatus.PENDING, expiresAt: { lte: new Date() } },
      data: { status: OfferStatus.EXPIRED },
    });
    return { expiredCount: count };
  }
}
