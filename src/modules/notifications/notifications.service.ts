import { prisma } from '../../common/prisma.js';
import { Prisma } from '@prisma/client';
import { NotificationType } from '../../common/types/enums.js';

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const money = (amount: number) => inr.format(amount);

export class NotificationsService {
  /**
   * Create a notification for a user.
   * This is the central method — called by chat, offers, moderation, etc.
   */
  static async createNotification(
    userId: string,
    type: NotificationType,
    title: string,
    body: string,
    data?: Record<string, unknown>
  ) {
    return prisma.notification.create({
      data: {
        userId,
        type,
        title,
        body,
        data: (data as Prisma.InputJsonValue) ?? undefined,
      },
    });
  }

  /**
   * Get paginated notifications for a user.
   */
  static async getUserNotifications(userId: string, page = 1, limit = 20) {
    const skip = (Math.max(1, page) - 1) * Math.min(50, Math.max(1, limit));
    const take = Math.min(50, Math.max(1, limit));

    const [total, notifications] = await Promise.all([
      prisma.notification.count({ where: { userId } }),
      prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
    ]);

    return {
      notifications,
      pagination: {
        total,
        page: Math.max(1, page),
        limit: take,
        totalPages: Math.ceil(total / take),
      },
    };
  }

  /**
   * Get unread notification count for badge display.
   */
  static async getUnreadCount(userId: string) {
    return prisma.notification.count({
      where: { userId, isRead: false },
    });
  }

  /**
   * Mark a single notification as read.
   */
  static async markAsRead(notificationId: string, userId: string) {
    const notification = await prisma.notification.findUnique({
      where: { id: notificationId },
    });

    if (!notification || notification.userId !== userId) {
      return null;
    }

    return prisma.notification.update({
      where: { id: notificationId },
      data: { isRead: true },
    });
  }

  /**
   * Mark all notifications as read for a user.
   */
  static async markAllAsRead(userId: string) {
    const result = await prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });

    return { markedCount: result.count };
  }

  // ──────────────────────────────────────────────────
  // Convenience methods for specific notification types
  // ──────────────────────────────────────────────────

  /** Adds the chat to open for an offer notification, so clicking it lands in the negotiation. */
  private static async offerData(offerId: string, listingId: string) {
    const offer = await prisma.offer.findUnique({ where: { id: offerId }, select: { buyerId: true } });
    const conversation = offer
      ? await prisma.conversation.findUnique({
          where: { listingId_buyerId: { listingId, buyerId: offer.buyerId } },
          select: { id: true },
        })
      : null;
    return { offerId, listingId, conversationId: conversation?.id ?? null };
  }

  /**
   * One unread notification per conversation: further messages update it ("3 new messages")
   * instead of flooding the list.
   */
  static async notifyMessageReceived(
    recipientId: string,
    senderName: string,
    listingTitle: string,
    conversationId: string
  ) {
    const existing = await prisma.notification.findFirst({
      where: {
        userId: recipientId,
        type: NotificationType.MESSAGE_RECEIVED,
        isRead: false,
        data: { path: ['conversationId'], equals: conversationId },
      },
    });
    if (existing) {
      const previous = (existing.data as { count?: number } | null)?.count ?? 1;
      const count = previous + 1;
      return prisma.notification.update({
        where: { id: existing.id },
        data: {
          body: `${senderName} sent you ${count} new messages about "${listingTitle}"`,
          data: { conversationId, count },
          createdAt: new Date(),
        },
      });
    }
    return this.createNotification(
      recipientId,
      NotificationType.MESSAGE_RECEIVED,
      'New Message',
      `${senderName} sent you a message about "${listingTitle}"`,
      { conversationId, count: 1 }
    );
  }

  /** Buyer whose reservation ended: either the seller sold the item or put it back on sale. */
  static async notifyReservationEnded(
    buyerId: string,
    sellerName: string,
    listingTitle: string,
    listingId: string,
    outcome: 'SOLD' | 'RELEASED'
  ) {
    const conversation = await prisma.conversation.findUnique({
      where: { listingId_buyerId: { listingId, buyerId } },
      select: { id: true },
    });
    return outcome === 'SOLD'
      ? this.createNotification(buyerId, NotificationType.LISTING_SOLD, 'Item marked as sold',
          `${sellerName} marked "${listingTitle}" as sold.`, { listingId, conversationId: conversation?.id ?? null })
      : this.createNotification(buyerId, NotificationType.RESERVATION_RELEASED, 'Reservation cancelled',
          `${sellerName} cancelled your reservation for "${listingTitle}". It is available again.`,
          { listingId, conversationId: conversation?.id ?? null });
  }

  static async notifyOfferCreated(
    sellerId: string,
    buyerName: string,
    amount: number,
    listingTitle: string,
    offerId: string,
    listingId: string
  ) {
    return this.createNotification(
      sellerId,
      NotificationType.OFFER_CREATED,
      'New Offer Received',
      `${buyerName} offered ${money(amount)} for "${listingTitle}"`,
      await this.offerData(offerId, listingId)
    );
  }

  static async notifyOfferAccepted(
    recipientId: string,
    actorName: string,
    amount: number,
    listingTitle: string,
    offerId: string,
    listingId: string
  ) {
    return this.createNotification(
      recipientId,
      NotificationType.OFFER_ACCEPTED,
      'Offer Accepted!',
      `${actorName} accepted your offer of ${money(amount)} for "${listingTitle}"`,
      await this.offerData(offerId, listingId)
    );
  }

  static async notifyOfferRejected(
    recipientId: string,
    actorName: string,
    amount: number,
    listingTitle: string,
    offerId: string,
    listingId: string
  ) {
    return this.createNotification(
      recipientId,
      NotificationType.OFFER_REJECTED,
      'Offer Declined',
      `${actorName} declined your offer of ${money(amount)} for "${listingTitle}"`,
      await this.offerData(offerId, listingId)
    );
  }

  static async notifyOfferCountered(
    recipientId: string,
    counterpartyName: string,
    amount: number,
    listingTitle: string,
    offerId: string,
    listingId: string
  ) {
    return this.createNotification(
      recipientId,
      NotificationType.OFFER_COUNTERED,
      'Counter Offer',
      `${counterpartyName} countered with ${money(amount)} for "${listingTitle}"`,
      await this.offerData(offerId, listingId)
    );
  }

  static async notifyListingApproved(sellerId: string, listingTitle: string, listingId: string) {
    return this.createNotification(
      sellerId,
      NotificationType.LISTING_APPROVED,
      'Listing Approved',
      `Your listing "${listingTitle}" has been approved and is now live!`,
      { listingId }
    );
  }

  static async notifyListingRejected(sellerId: string, listingTitle: string, listingId: string, reason?: string) {
    return this.createNotification(
      sellerId,
      NotificationType.LISTING_REJECTED,
      'Listing Rejected',
      `Your listing "${listingTitle}" was not approved. ${reason || 'Please review and resubmit.'}`,
      { listingId, reason }
    );
  }

  static async notifyListingSuspended(sellerId: string, listingTitle: string, listingId: string, reason?: string) {
    return this.createNotification(
      sellerId,
      NotificationType.LISTING_SUSPENDED,
      'Listing Suspended',
      `Your listing "${listingTitle}" has been suspended. ${reason || 'Contact support for details.'}`,
      { listingId, reason }
    );
  }

  static async notifyListingExpired(sellerId: string, listingTitle: string, listingId: string) {
    return this.createNotification(
      sellerId,
      NotificationType.LISTING_EXPIRED,
      'Listing Expired',
      `Your listing "${listingTitle}" has expired. You can renew it to make it live again.`,
      { listingId }
    );
  }

  /** Staff feedback on a listing: verified badge, requested changes, or a remark. */
  static async notifyListingReview(
    sellerId: string,
    listingTitle: string,
    listingId: string,
    kind: 'VERIFIED' | 'CHANGES_REQUESTED' | 'REMARK',
    remark?: string | null
  ) {
    const copy = {
      VERIFIED: [NotificationType.LISTING_VERIFIED, 'Listing verified ✓', `"${listingTitle}" now shows a Verified badge to buyers.`],
      CHANGES_REQUESTED: [NotificationType.LISTING_CHANGES_REQUESTED, 'Changes requested', `Please update "${listingTitle}": ${remark ?? 'see the remarks in My Listings.'}`],
      REMARK: [NotificationType.LISTING_REMARK, 'Note from the Becho team', `About "${listingTitle}": ${remark ?? ''}`],
    } as const;
    const [type, title, body] = copy[kind];
    return this.createNotification(sellerId, type, title, body, { listingId, remark: remark ?? null });
  }
}
