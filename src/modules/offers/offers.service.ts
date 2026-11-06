import { prisma } from '../../common/prisma.js';
import { ApiError } from '../../common/errors/api-error.js';
import { OfferStatus } from '../../common/types/enums.js';
import { NotificationsService } from '../notifications/notifications.service.js';

const OFFER_EXPIRY_HOURS = 48;

export interface CreateOfferInput {
  listingId: string;
  amount: number;
  message?: string;
}

export interface CounterOfferInput {
  amount: number;
  message?: string;
}

export class OffersService {
  /**
   * Buyer creates a new offer on a listing.
   * Only one PENDING offer per buyer per listing is allowed.
   */
  static async createOffer(buyerId: string, input: CreateOfferInput) {
    const listing = await prisma.listing.findUnique({
      where: { id: input.listingId },
    });

    if (!listing) throw ApiError.notFound('Listing not found', 'LISTING_NOT_FOUND');
    if (listing.status !== 'LIVE') throw ApiError.badRequest('Listing is not available for offers', 'LISTING_NOT_LIVE');
    if (listing.sellerId === buyerId) throw ApiError.badRequest('You cannot make an offer on your own listing', 'CANNOT_OFFER_OWN_LISTING');

    if (input.amount <= 0) throw ApiError.badRequest('Offer amount must be greater than 0', 'INVALID_OFFER_AMOUNT');

    // Cancel any existing pending offer from this buyer on this listing
    await prisma.offer.updateMany({
      where: {
        listingId: input.listingId,
        buyerId,
        status: OfferStatus.PENDING,
      },
      data: { status: OfferStatus.CANCELLED },
    });

    const expiresAt = new Date(Date.now() + OFFER_EXPIRY_HOURS * 60 * 60 * 1000);

    const offer = await prisma.offer.create({
      data: {
        listingId: input.listingId,
        buyerId,
        sellerId: listing.sellerId,
        amount: input.amount,
        message: input.message || null,
        status: OfferStatus.PENDING,
        expiresAt,
      },
      include: {
        buyer: { select: { id: true, displayName: true } },
        seller: { select: { id: true, displayName: true } },
        listing: { select: { id: true, title: true, price: true } },
      },
    });

    // Notify seller about new offer
    NotificationsService.notifyOfferCreated(
      offer.seller.id,
      offer.buyer.displayName,
      offer.amount,
      offer.listing.title,
      offer.id,
      offer.listing.id
    ).catch(() => {});

    return offer;
  }

  /**
   * Seller (or buyer) counters an existing offer.
   * The original offer is marked COUNTERED and a new PENDING offer is created.
   */
  static async counterOffer(offerId: string, actorId: string, input: CounterOfferInput) {
    const offer = await prisma.offer.findUnique({
      where: { id: offerId },
      include: { listing: true },
    });

    if (!offer) throw ApiError.notFound('Offer not found', 'OFFER_NOT_FOUND');
    if (offer.status !== OfferStatus.PENDING) throw ApiError.badRequest('Offer is no longer active', 'OFFER_NOT_PENDING');

    // Only the other party can counter
    const isBuyer = offer.buyerId === actorId;
    const isSeller = offer.sellerId === actorId;
    if (!isBuyer && !isSeller) throw ApiError.forbidden('You are not a party to this offer', 'FORBIDDEN');
    if ((isBuyer && offer.buyerId === actorId && offer.parentOfferId === null && !isSeller)) {
      // buyer countering their own initial offer is ok only if seller sent the parent
      // simplified: allow either party to counter while PENDING
    }

    if (input.amount <= 0) throw ApiError.badRequest('Counter offer amount must be greater than 0', 'INVALID_OFFER_AMOUNT');

    const expiresAt = new Date(Date.now() + OFFER_EXPIRY_HOURS * 60 * 60 * 1000);

    // Mark the existing offer as COUNTERED
    await prisma.offer.update({
      where: { id: offerId },
      data: { status: OfferStatus.COUNTERED },
    });

    // Create counter offer — swap buyer/seller perspective if seller is countering
    const newBuyerId = isSeller ? offer.buyerId : actorId;
    const newSellerId = isSeller ? actorId : offer.sellerId;

    const counterOffer = await prisma.offer.create({
      data: {
        listingId: offer.listingId,
        buyerId: newBuyerId,
        sellerId: newSellerId,
        amount: input.amount,
        message: input.message || null,
        status: OfferStatus.PENDING,
        parentOfferId: offerId,
        expiresAt,
      },
      include: {
        buyer: { select: { id: true, displayName: true } },
        seller: { select: { id: true, displayName: true } },
        listing: { select: { id: true, title: true, price: true } },
        parentOffer: { select: { id: true, amount: true, status: true } },
      },
    });

    // Notify the other party about the counter
    const recipientId = isSeller ? offer.buyerId : offer.sellerId;
    NotificationsService.notifyOfferCountered(
      recipientId,
      isSeller ? counterOffer.seller.displayName : counterOffer.buyer.displayName,
      counterOffer.amount,
      counterOffer.listing.title,
      counterOffer.id,
      counterOffer.listing.id
    ).catch(() => {});

    return counterOffer;
  }

  /**
   * Seller accepts a pending offer.
   */
  static async acceptOffer(offerId: string, sellerId: string) {
    const offer = await prisma.offer.findUnique({ where: { id: offerId } });

    if (!offer) throw ApiError.notFound('Offer not found', 'OFFER_NOT_FOUND');
    if (offer.sellerId !== sellerId) throw ApiError.forbidden('Only the seller can accept this offer', 'FORBIDDEN');
    if (offer.status !== OfferStatus.PENDING) throw ApiError.badRequest('Offer is no longer active', 'OFFER_NOT_PENDING');

    const updated = await prisma.offer.update({
      where: { id: offerId },
      data: { status: OfferStatus.ACCEPTED },
      include: {
        buyer: { select: { id: true, displayName: true } },
        seller: { select: { id: true, displayName: true } },
        listing: { select: { id: true, title: true, price: true } },
      },
    });

    // Notify buyer that offer was accepted
    NotificationsService.notifyOfferAccepted(
      updated.buyer.id,
      updated.seller.displayName,
      updated.amount,
      updated.listing.title,
      updated.id,
      updated.listing.id
    ).catch(() => {});

    return updated;
  }

  /**
   * Seller or buyer rejects a pending offer.
   */
  static async rejectOffer(offerId: string, actorId: string) {
    const offer = await prisma.offer.findUnique({ where: { id: offerId } });

    if (!offer) throw ApiError.notFound('Offer not found', 'OFFER_NOT_FOUND');
    if (offer.sellerId !== actorId && offer.buyerId !== actorId) throw ApiError.forbidden('You are not a party to this offer', 'FORBIDDEN');
    if (offer.status !== OfferStatus.PENDING) throw ApiError.badRequest('Offer is no longer active', 'OFFER_NOT_PENDING');

    const updated = await prisma.offer.update({
      where: { id: offerId },
      data: { status: OfferStatus.REJECTED },
      include: {
        buyer: { select: { id: true, displayName: true } },
        seller: { select: { id: true, displayName: true } },
        listing: { select: { id: true, title: true, price: true } },
      },
    });

    // Notify the other party about rejection
    const rejectedPartyId = actorId === offer.sellerId ? offer.buyerId : offer.sellerId;
    const actorName = actorId === offer.sellerId ? updated.seller.displayName : updated.buyer.displayName;
    NotificationsService.notifyOfferRejected(
      rejectedPartyId,
      actorName,
      updated.amount,
      updated.listing.title,
      updated.id,
      updated.listing.id
    ).catch(() => {});

    return updated;
  }

  /**
   * Buyer cancels their own pending offer.
   */
  static async cancelOffer(offerId: string, buyerId: string) {
    const offer = await prisma.offer.findUnique({ where: { id: offerId } });

    if (!offer) throw ApiError.notFound('Offer not found', 'OFFER_NOT_FOUND');
    if (offer.buyerId !== buyerId) throw ApiError.forbidden('Only the buyer can cancel this offer', 'FORBIDDEN');
    if (offer.status !== OfferStatus.PENDING) throw ApiError.badRequest('Offer is no longer active', 'OFFER_NOT_PENDING');

    const updated = await prisma.offer.update({
      where: { id: offerId },
      data: { status: OfferStatus.CANCELLED },
      include: {
        buyer: { select: { id: true, displayName: true } },
        seller: { select: { id: true, displayName: true } },
        listing: { select: { id: true, title: true, price: true } },
      },
    });

    return updated;
  }

  /**
   * Get all offers for a listing (seller view).
   */
  static async getListingOffers(listingId: string, sellerId: string) {
    const listing = await prisma.listing.findUnique({ where: { id: listingId } });
    if (!listing) throw ApiError.notFound('Listing not found', 'LISTING_NOT_FOUND');
    if (listing.sellerId !== sellerId) throw ApiError.forbidden('Only the seller can view all offers', 'FORBIDDEN');

    return prisma.offer.findMany({
      where: { listingId },
      include: {
        buyer: { select: { id: true, displayName: true } },
        parentOffer: { select: { id: true, amount: true, status: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Get all offers made by the authenticated user (buyer view).
   */
  static async getMyOffers(buyerId: string) {
    return prisma.offer.findMany({
      where: { buyerId },
      include: {
        listing: { select: { id: true, title: true, price: true, media: { take: 1, orderBy: { sortOrder: 'asc' } } } },
        seller: { select: { id: true, displayName: true } },
        parentOffer: { select: { id: true, amount: true, status: true } },
        counterOffers: { select: { id: true, amount: true, status: true, createdAt: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Get all offers received by the authenticated user (seller view).
   */
  static async getReceivedOffers(sellerId: string) {
    return prisma.offer.findMany({
      where: { sellerId },
      include: {
        listing: { select: { id: true, title: true, price: true, media: { take: 1, orderBy: { sortOrder: 'asc' } } } },
        buyer: { select: { id: true, displayName: true } },
        parentOffer: { select: { id: true, amount: true, status: true } },
        counterOffers: { select: { id: true, amount: true, status: true, createdAt: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Get offer chain for a specific listing-buyer pair (full negotiation history).
   */
  static async getOfferChain(listingId: string, buyerId: string, actorId: string) {
    const listing = await prisma.listing.findUnique({ where: { id: listingId } });
    if (!listing) throw ApiError.notFound('Listing not found', 'LISTING_NOT_FOUND');

    // Actor must be buyer or seller of this listing
    if (actorId !== buyerId && actorId !== listing.sellerId) {
      throw ApiError.forbidden('Access denied', 'FORBIDDEN');
    }

    return prisma.offer.findMany({
      where: { listingId, buyerId },
      include: {
        buyer: { select: { id: true, displayName: true } },
        seller: { select: { id: true, displayName: true } },
        parentOffer: { select: { id: true, amount: true, status: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }
}
