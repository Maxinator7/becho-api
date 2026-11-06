import { Router, Request, Response, NextFunction } from 'express';
import { OffersService } from './offers.service.js';
import { authenticateToken } from '../../common/middleware/auth-guard.js';

export const offersRouter = Router();

// All offer endpoints require authentication
offersRouter.use(authenticateToken);

// POST /api/v1/offers — Buyer creates a new offer
offersRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { listingId, amount, message } = req.body;
    if (!listingId || amount === undefined) {
      res.status(400).json({ success: false, error: { code: 'MISSING_FIELDS', message: 'listingId and amount are required' } });
      return;
    }
    const offer = await OffersService.createOffer(req.user!.userId, { listingId, amount: Number(amount), message });
    res.status(201).json({ success: true, data: offer });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/offers/mine — Buyer: get offers I've made
offersRouter.get('/mine', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const offers = await OffersService.getMyOffers(req.user!.userId);
    res.json({ success: true, data: offers });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/offers/received — Seller: get offers I've received
offersRouter.get('/received', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const offers = await OffersService.getReceivedOffers(req.user!.userId);
    res.json({ success: true, data: offers });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/offers/chain?listingId=&buyerId= — Get full offer chain for a listing-buyer pair
offersRouter.get('/chain', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { listingId, buyerId } = req.query;
    if (!listingId || !buyerId) {
      res.status(400).json({ success: false, error: { code: 'MISSING_FIELDS', message: 'listingId and buyerId are required' } });
      return;
    }
    const chain = await OffersService.getOfferChain(String(listingId), String(buyerId), req.user!.userId);
    res.json({ success: true, data: chain });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/offers/listing/:listingId — Seller: get all offers for a listing
offersRouter.get('/listing/:listingId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const offers = await OffersService.getListingOffers(req.params.listingId, req.user!.userId);
    res.json({ success: true, data: offers });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/offers/:id/counter — Counter an offer
offersRouter.post('/:id/counter', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { amount, message } = req.body;
    if (amount === undefined) {
      res.status(400).json({ success: false, error: { code: 'MISSING_FIELDS', message: 'amount is required' } });
      return;
    }
    const offer = await OffersService.counterOffer(req.params.id, req.user!.userId, { amount: Number(amount), message });
    res.status(201).json({ success: true, data: offer });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/offers/:id/accept — Seller accepts an offer
offersRouter.post('/:id/accept', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const offer = await OffersService.acceptOffer(req.params.id, req.user!.userId);
    res.json({ success: true, data: offer });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/offers/:id/reject — Seller or buyer rejects an offer
offersRouter.post('/:id/reject', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const offer = await OffersService.rejectOffer(req.params.id, req.user!.userId);
    res.json({ success: true, data: offer });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/offers/:id/cancel — Buyer cancels their offer
offersRouter.post('/:id/cancel', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const offer = await OffersService.cancelOffer(req.params.id, req.user!.userId);
    res.json({ success: true, data: offer });
  } catch (err) {
    next(err);
  }
});
