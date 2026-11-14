import { Prisma } from '@prisma/client';
import { prisma } from '../../common/prisma.js';

export const MessageKind = { TEXT: 'TEXT', EVENT: 'EVENT' } as const;

export const ConversationEvent = {
  OFFER_MADE: 'OFFER_MADE',
  OFFER_COUNTERED: 'OFFER_COUNTERED',
  OFFER_ACCEPTED: 'OFFER_ACCEPTED',
  OFFER_REJECTED: 'OFFER_REJECTED',
  OFFER_WITHDRAWN: 'OFFER_WITHDRAWN',
  LISTING_SOLD: 'LISTING_SOLD',
  RESERVATION_RELEASED: 'RESERVATION_RELEASED',
} as const;
export type ConversationEvent = typeof ConversationEvent[keyof typeof ConversationEvent];

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

function describe(event: ConversationEvent, actorName: string, amount?: number) {
  const money = amount !== undefined ? inr.format(amount) : '';
  switch (event) {
    case ConversationEvent.OFFER_MADE:
      return `${actorName} made an offer of ${money}`;
    case ConversationEvent.OFFER_COUNTERED:
      return `${actorName} countered with ${money}`;
    case ConversationEvent.OFFER_ACCEPTED:
      return `${actorName} accepted the offer of ${money}. The item is now reserved — agree on a time and place to meet.`;
    case ConversationEvent.OFFER_REJECTED:
      return `${actorName} declined the offer of ${money}`;
    case ConversationEvent.OFFER_WITHDRAWN:
      return `${actorName} withdrew the offer of ${money}`;
    case ConversationEvent.LISTING_SOLD:
      return `${actorName} marked the item as sold`;
    case ConversationEvent.RESERVATION_RELEASED:
      return `${actorName} cancelled the reservation. The item is available again.`;
  }
}

export interface ConversationEventInput {
  listingId: string;
  buyerId: string;
  sellerId: string;
  actorId: string;
  actorName: string;
  event: ConversationEvent;
  amount?: number;
  offerId?: string;
}

/**
 * Posts a system message into the buyer–seller conversation (creating the conversation
 * if the negotiation started from the listing page). Both sides see it in the chat
 * timeline, and the conversation moves to the top of their inbox.
 */
export async function postConversationEvent(input: ConversationEventInput, tx: Prisma.TransactionClient = prisma) {
  const conversation = await tx.conversation.upsert({
    where: { listingId_buyerId: { listingId: input.listingId, buyerId: input.buyerId } },
    update: { lastMessageAt: new Date() },
    create: { listingId: input.listingId, buyerId: input.buyerId, sellerId: input.sellerId, lastMessageAt: new Date() },
  });

  return tx.message.create({
    data: {
      conversationId: conversation.id,
      senderId: input.actorId,
      kind: MessageKind.EVENT,
      content: describe(input.event, input.actorName, input.amount),
      metadata: { event: input.event, offerId: input.offerId ?? null, amount: input.amount ?? null },
    },
  });
}
