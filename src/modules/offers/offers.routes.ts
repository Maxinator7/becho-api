import { Router } from 'express';
import { asyncHandler as wrap } from '../../common/async-handler.js';
import { z } from 'zod';
import { OffersService } from './offers.service.js';
import { authenticateToken, requireActiveStatus } from '../../common/middleware/auth-guard.js';
import { id } from '../../common/validation.js';

export const offersRouter = Router();

const amountSchema = z.object({
  amount: z.coerce.number().positive('Offer amount must be greater than 0').max(1_000_000_000),
  message: z.string().trim().max(500).optional(),
});
const createOfferSchema = amountSchema.extend({ listingId: id });
const chainQuerySchema = z.object({ listingId: id, buyerId: id });


offersRouter.use(authenticateToken);

// Buyer creates a new offer
offersRouter.post('/', requireActiveStatus, wrap(async (req, res) => {
  const offer = await OffersService.createOffer(req.user!.userId, createOfferSchema.parse(req.body));
  res.status(201).json({ success: true, data: offer });
}));

offersRouter.get('/mine', wrap(async (req, res) => {
  res.json({ success: true, data: await OffersService.getMyOffers(req.user!.userId) });
}));

offersRouter.get('/received', wrap(async (req, res) => {
  res.json({ success: true, data: await OffersService.getReceivedOffers(req.user!.userId) });
}));

// Full negotiation history for a listing-buyer pair
offersRouter.get('/chain', wrap(async (req, res) => {
  const { listingId, buyerId } = chainQuerySchema.parse(req.query);
  res.json({ success: true, data: await OffersService.getOfferChain(listingId, buyerId, req.user!.userId) });
}));

offersRouter.get('/listing/:listingId', wrap(async (req, res) => {
  res.json({ success: true, data: await OffersService.getListingOffers(id.parse(req.params.listingId), req.user!.userId) });
}));

offersRouter.post('/:id/counter', requireActiveStatus, wrap(async (req, res) => {
  const offer = await OffersService.counterOffer(id.parse(req.params.id), req.user!.userId, amountSchema.parse(req.body));
  res.status(201).json({ success: true, data: offer });
}));

offersRouter.post('/:id/accept', requireActiveStatus, wrap(async (req, res) => {
  res.json({ success: true, data: await OffersService.acceptOffer(id.parse(req.params.id), req.user!.userId) });
}));

offersRouter.post('/:id/reject', wrap(async (req, res) => {
  res.json({ success: true, data: await OffersService.rejectOffer(id.parse(req.params.id), req.user!.userId) });
}));

offersRouter.post('/:id/cancel', wrap(async (req, res) => {
  res.json({ success: true, data: await OffersService.cancelOffer(id.parse(req.params.id), req.user!.userId) });
}));
