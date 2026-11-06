import { Router, Request, Response, NextFunction } from 'express';
import { ServiceAreasService } from './service-areas.service.js';
import { LocationsService } from './locations.service.js';
import { authenticateToken, requireRole } from '../../common/middleware/auth-guard.js';
import { UserRole } from '../../common/types/enums.js';

export const locationsRouter = Router();

// Public: Get active service areas
locationsRouter.get('/service-areas', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const areas = await ServiceAreasService.getActiveServiceAreas();
    res.json({ success: true, data: areas });
  } catch (err) {
    next(err);
  }
});

// Public: Check marketplace availability by location
locationsRouter.get('/availability', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { countryCode, stateCode, cityName } = req.query;
    if (!countryCode || !stateCode || !cityName) {
      return res.status(400).json({ success: false, error: { message: 'countryCode, stateCode, and cityName query params required' } });
    }
    const availability = await LocationsService.checkMarketplaceAvailability(
      String(countryCode),
      String(stateCode),
      String(cityName)
    );
    res.json({ success: true, data: availability });
  } catch (err) {
    next(err);
  }
});

// User: Get primary location
locationsRouter.get('/users/me/location', authenticateToken, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const location = await LocationsService.getUserPrimaryLocation(req.user!.userId);
    res.json({ success: true, data: location });
  } catch (err) {
    next(err);
  }
});

// User: Set primary location
locationsRouter.post('/users/me/location', authenticateToken, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await LocationsService.setUserPrimaryLocation(req.user!.userId, req.body);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

// Admin: Get all service areas
locationsRouter.get('/admin/service-areas', authenticateToken, requireRole(UserRole.ADMIN, UserRole.MODERATOR), async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const areas = await ServiceAreasService.getAllServiceAreasAdmin();
    res.json({ success: true, data: areas });
  } catch (err) {
    next(err);
  }
});

// Admin: Create service area
locationsRouter.post('/admin/service-areas', authenticateToken, requireRole(UserRole.ADMIN), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const area = await ServiceAreasService.createServiceArea(req.body);
    res.status(201).json({ success: true, data: area });
  } catch (err) {
    next(err);
  }
});

// Admin: Update service area status
locationsRouter.patch('/admin/service-areas/:id', authenticateToken, requireRole(UserRole.ADMIN), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const area = await ServiceAreasService.updateServiceArea(req.params.id, req.body);
    res.json({ success: true, data: area });
  } catch (err) {
    next(err);
  }
});
