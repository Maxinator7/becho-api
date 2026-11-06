import { Router, Request, Response, NextFunction } from 'express';
import { ListingsService } from './listings.service.js';
import { authenticateToken } from '../../common/middleware/auth-guard.js';

export const listingsRouter = Router();

// Public: Get live listings with filtering, search, and pagination
listingsRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { categoryId, subcategoryId, cityCode, stateCode, countryCode, minPrice, maxPrice, condition, search, sort, page, limit } = req.query;
    const result = await ListingsService.getPublicListings({
      categoryId: categoryId ? String(categoryId) : undefined,
      subcategoryId: subcategoryId ? String(subcategoryId) : undefined,
      cityCode: cityCode ? String(cityCode) : undefined,
      stateCode: stateCode ? String(stateCode) : undefined,
      countryCode: countryCode ? String(countryCode) : undefined,
      minPrice: minPrice ? Number(minPrice) : undefined,
      maxPrice: maxPrice ? Number(maxPrice) : undefined,
      condition: condition ? String(condition) : undefined,
      search: search ? String(search) : undefined,
      sort: sort ? String(sort) : undefined,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
});

// Authenticated Seller: Get own listings
listingsRouter.get('/mine', authenticateToken, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const listings = await ListingsService.getUserListings(req.user!.userId);
    res.json({ success: true, data: listings });
  } catch (err) {
    next(err);
  }
});

// Public: Get single listing details
listingsRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const listing = await ListingsService.getListingById(req.params.id);
    res.json({ success: true, data: listing });
  } catch (err) {
    next(err);
  }
});

// Authenticated Seller: Create listing draft & submit
listingsRouter.post('/', authenticateToken, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const listing = await ListingsService.createListingDraft(req.user!.userId, req.body);
    res.status(201).json({ success: true, data: listing });
  } catch (err) {
    next(err);
  }
});

// Authenticated Seller: Submit listing draft
listingsRouter.post('/:id/submit', authenticateToken, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const listing = await ListingsService.submitListing(req.params.id, req.user!.userId);
    res.json({ success: true, data: listing });
  } catch (err) {
    next(err);
  }
});

// Authenticated Seller: Edit listing draft
listingsRouter.patch('/:id', authenticateToken, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const listing = await ListingsService.updateListingDraft(req.params.id, req.user!.userId, req.body);
    res.json({ success: true, data: listing });
  } catch (err) {
    next(err);
  }
});

// Authenticated Seller: Mark listing as sold
listingsRouter.post('/:id/mark-sold', authenticateToken, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const listing = await ListingsService.markListingSold(req.params.id, req.user!.userId);
    res.json({ success: true, data: listing });
  } catch (err) {
    next(err);
  }
});

// Authenticated Seller: Renew expired listing
listingsRouter.post('/:id/renew', authenticateToken, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const listing = await ListingsService.renewListing(req.params.id, req.user!.userId);
    res.json({ success: true, data: listing });
  } catch (err) {
    next(err);
  }
});

// Authenticated Seller: Delete listing (soft delete)
listingsRouter.delete('/:id', authenticateToken, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await ListingsService.deleteListing(req.params.id, req.user!.userId);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});
