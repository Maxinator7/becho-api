import { Router, Request, Response, NextFunction } from 'express';
import { FavoritesService } from './favorites.service.js';
import { authenticateToken } from '../../common/middleware/auth-guard.js';

export const favoritesRouter = Router();

favoritesRouter.use(authenticateToken);

// Toggle favorite on listing
favoritesRouter.post('/:listingId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await FavoritesService.toggleFavorite(req.user!.userId, req.params.listingId);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

// Get user favorited listings
favoritesRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const listings = await FavoritesService.getUserFavorites(req.user!.userId);
    res.json({ success: true, data: listings });
  } catch (err) {
    next(err);
  }
});
