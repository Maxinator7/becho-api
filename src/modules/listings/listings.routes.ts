import { Router } from 'express';
import { asyncHandler as wrap } from '../../common/async-handler.js';
import { ListingsService } from './listings.service.js';
import { authenticateToken, optionalAuth, requireActiveStatus } from '../../common/middleware/auth-guard.js';
import { createListingSchema, listingQuerySchema, updateListingSchema } from './listings.schema.js';
import { id } from '../../common/validation.js';

export const listingsRouter = Router();


// Public: live listings with filtering, search, and pagination
listingsRouter.get('/', wrap(async (req, res) => {
  const result = await ListingsService.getPublicListings(listingQuerySchema.parse(req.query));
  res.json({ success: true, data: result });
}));

// Seller: own listings
listingsRouter.get('/mine', authenticateToken, wrap(async (req, res) => {
  res.json({ success: true, data: await ListingsService.getUserListings(req.user!.userId) });
}));

// Public for LIVE/RESERVED/SOLD; owner and moderators can also see other states.
listingsRouter.get('/:id', optionalAuth, wrap(async (req, res) => {
  res.json({ success: true, data: await ListingsService.getListingForViewer(id.parse(req.params.id), req.user) });
}));

// Seller: create draft (verified accounts only)
listingsRouter.post('/', authenticateToken, requireActiveStatus, wrap(async (req, res) => {
  const listing = await ListingsService.createListingDraft(req.user!.userId, createListingSchema.parse(req.body));
  res.status(201).json({ success: true, data: listing });
}));

// Seller: submit draft for automated checks / review
listingsRouter.post('/:id/submit', authenticateToken, requireActiveStatus, wrap(async (req, res) => {
  res.json({ success: true, data: await ListingsService.submitListing(id.parse(req.params.id), req.user!.userId) });
}));

// Seller: edit draft or rejected listing
listingsRouter.patch('/:id', authenticateToken, requireActiveStatus, wrap(async (req, res) => {
  const listing = await ListingsService.updateListingDraft(id.parse(req.params.id), req.user!.userId, updateListingSchema.parse(req.body));
  res.json({ success: true, data: listing });
}));

listingsRouter.post('/:id/mark-sold', authenticateToken, wrap(async (req, res) => {
  res.json({ success: true, data: await ListingsService.markListingSold(id.parse(req.params.id), req.user!.userId) });
}));

// Seller: release a reservation (accepted offer fell through) and put the listing back on sale
listingsRouter.post('/:id/mark-available', authenticateToken, wrap(async (req, res) => {
  res.json({ success: true, data: await ListingsService.markListingAvailable(id.parse(req.params.id), req.user!.userId) });
}));

listingsRouter.post('/:id/renew', authenticateToken, requireActiveStatus, wrap(async (req, res) => {
  res.json({ success: true, data: await ListingsService.renewListing(id.parse(req.params.id), req.user!.userId) });
}));

// Seller: soft delete
listingsRouter.delete('/:id', authenticateToken, wrap(async (req, res) => {
  res.json({ success: true, data: await ListingsService.deleteListing(id.parse(req.params.id), req.user!.userId) });
}));
