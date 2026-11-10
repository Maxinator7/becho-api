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

  static async notifyMessageReceived(
    recipientId: string,
    senderName: string,
    listingTitle: string,
    conversationId: string
  ) {
    return this.createNotification(
      recipientId,
      NotificationType.MESSAGE_RECEIVED,
      'New Message',
      `${senderName} sent you a message about "${listingTitle}"`,
      { conversationId }
    );
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
      { offerId, listingId }
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
      { offerId, listingId }
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
      { offerId, listingId }
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
      { offerId, listingId }
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
}
