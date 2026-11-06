import { prisma } from '../../common/prisma.js';
import { ApiError } from '../../common/errors/api-error.js';
import { NotificationsService } from '../notifications/notifications.service.js';

export class ChatService {
  static async getOrCreateConversation(listingId: string, buyerId: string) {
    const listing = await prisma.listing.findUnique({
      where: { id: listingId },
    });

    if (!listing) {
      throw ApiError.notFound('Listing not found', 'LISTING_NOT_FOUND');
    }

    if (listing.sellerId === buyerId) {
      throw ApiError.badRequest('You cannot start a conversation on your own listing', 'CANNOT_MESSAGE_SELF');
    }

    let conversation = await prisma.conversation.findUnique({
      where: {
        listingId_buyerId: { listingId, buyerId },
      },
      include: {
        listing: {
          select: { id: true, title: true, price: true, status: true, media: { take: 1, orderBy: { sortOrder: 'asc' } } },
        },
        buyer: { select: { id: true, displayName: true } },
        seller: { select: { id: true, displayName: true } },
      },
    });

    if (!conversation) {
      conversation = await prisma.conversation.create({
        data: {
          listingId,
          buyerId,
          sellerId: listing.sellerId,
        },
        include: {
          listing: {
            select: { id: true, title: true, price: true, status: true, media: { take: 1, orderBy: { sortOrder: 'asc' } } },
          },
          buyer: { select: { id: true, displayName: true } },
          seller: { select: { id: true, displayName: true } },
        },
      });
    }

    return conversation;
  }

  static async getUserConversations(userId: string) {
    const conversations = await prisma.conversation.findMany({
      where: {
        OR: [{ buyerId: userId }, { sellerId: userId }],
      },
      include: {
        listing: {
          select: { id: true, title: true, price: true, status: true, media: { take: 1, orderBy: { sortOrder: 'asc' } } },
        },
        buyer: { select: { id: true, displayName: true } },
        seller: { select: { id: true, displayName: true } },
        messages: {
          take: 1,
          orderBy: { createdAt: 'desc' },
        },
      },
      orderBy: { lastMessageAt: 'desc' },
    });

    return conversations;
  }

  static async getConversationMessages(conversationId: string, userId: string) {
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        listing: {
          select: { id: true, title: true, price: true, status: true, media: { take: 1, orderBy: { sortOrder: 'asc' } } },
        },
        buyer: { select: { id: true, displayName: true } },
        seller: { select: { id: true, displayName: true } },
      },
    });

    if (!conversation) {
      throw ApiError.notFound('Conversation not found', 'CONVERSATION_NOT_FOUND');
    }

    if (conversation.buyerId !== userId && conversation.sellerId !== userId) {
      throw ApiError.forbidden('Access denied to conversation', 'FORBIDDEN');
    }

    const messages = await prisma.message.findMany({
      where: { conversationId },
      include: {
        sender: { select: { id: true, displayName: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    return { conversation, messages };
  }

  static async sendMessage(conversationId: string, senderId: string, content: string) {
    if (!content || !content.trim()) {
      throw ApiError.badRequest('Message content cannot be empty', 'EMPTY_MESSAGE');
    }

    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
    });

    if (!conversation) {
      throw ApiError.notFound('Conversation not found', 'CONVERSATION_NOT_FOUND');
    }

    if (conversation.buyerId !== senderId && conversation.sellerId !== senderId) {
      throw ApiError.forbidden('Access denied to conversation', 'FORBIDDEN');
    }

    const message = await prisma.message.create({
      data: {
        conversationId,
        senderId,
        content: content.trim(),
      },
      include: {
        sender: { select: { id: true, displayName: true } },
      },
    });

    await prisma.conversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: new Date() },
    });

    // Notify the other participant
    const recipientId = conversation.buyerId === senderId ? conversation.sellerId : conversation.buyerId;
    const listing = await prisma.listing.findUnique({
      where: { id: conversation.listingId },
      select: { title: true },
    });
    NotificationsService.notifyMessageReceived(
      recipientId,
      message.sender.displayName,
      listing?.title || 'a listing',
      conversationId
    ).catch(() => {}); // fire-and-forget

    return message;
  }

  static async markAsRead(conversationId: string, userId: string) {
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
    });

    if (!conversation) {
      throw ApiError.notFound('Conversation not found', 'CONVERSATION_NOT_FOUND');
    }

    if (conversation.buyerId !== userId && conversation.sellerId !== userId) {
      throw ApiError.forbidden('Access denied to conversation', 'FORBIDDEN');
    }

    await prisma.message.updateMany({
      where: {
        conversationId,
        senderId: { not: userId },
        isRead: false,
      },
      data: { isRead: true },
    });

    return { success: true };
  }
}
