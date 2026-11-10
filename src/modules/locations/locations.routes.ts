import { Router } from 'express';
import { z } from 'zod';
import { ServiceAreasService } from './service-areas.service.js';
import { LocationsService } from './locations.service.js';
import { authenticateToken, requireRole } from '../../common/middleware/auth-guard.js';
import { asyncHandler as wrap } from '../../common/async-handler.js';
import { id } from '../../common/validation.js';
import { DEFAULT_COUNTRY_CODE, LocationSource, UserRole } from '../../common/types/enums.js';

export const locationsRouter = Router();

const code = (max: number) => z.string().trim().min(1).max(max).toUpperCase();

const availabilitySchema = z.object({
  countryCode: code(2).default(DEFAULT_COUNTRY_CODE),
  stateCode: code(10),
  cityName: z.string().trim().min(1).max(80),
});

const setLocationSchema = z.object({
  countryCode: code(2).default(DEFAULT_COUNTRY_CODE),
  stateCode: code(10),
  stateName: z.string().trim().min(1).max(80),
  cityName: z.string().trim().min(1).max(80),
  cityId: z.string().optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  locationSource: z.nativeEnum(LocationSource).optional(),
});

const createAreaSchema = z.object({
  countryCode: code(2).default(DEFAULT_COUNTRY_CODE),
  stateCode: code(10),
  stateName: z.string().trim().min(1).max(80),
  cityCode: code(20),
  cityName: z.string().trim().min(1).max(80),
  isActive: z.boolean().optional(),
  buyingEnabled: z.boolean().optional(),
  sellingEnabled: z.boolean().optional(),
});

const updateAreaSchema = z.object({
  isActive: z.boolean().optional(),
  buyingEnabled: z.boolean().optional(),
  sellingEnabled: z.boolean().optional(),
});

locationsRouter.get('/service-areas', wrap(async (_req, res) => {
  res.json({ success: true, data: await ServiceAreasService.getActiveServiceAreas() });
}));

locationsRouter.get('/availability', wrap(async (req, res) => {
  const { countryCode, stateCode, cityName } = availabilitySchema.parse(req.query);
  res.json({ success: true, data: await LocationsService.checkMarketplaceAvailability(countryCode, stateCode, cityName) });
}));

locationsRouter.get('/users/me/location', authenticateToken, wrap(async (req, res) => {
  res.json({ success: true, data: await LocationsService.getUserPrimaryLocation(req.user!.userId) });
}));

locationsRouter.post('/users/me/location', authenticateToken, wrap(async (req, res) => {
  res.json({ success: true, data: await LocationsService.setUserPrimaryLocation(req.user!.userId, setLocationSchema.parse(req.body)) });
}));

locationsRouter.get('/admin/service-areas', authenticateToken, requireRole(UserRole.ADMIN, UserRole.MODERATOR), wrap(async (_req, res) => {
  res.json({ success: true, data: await ServiceAreasService.getAllServiceAreasAdmin() });
}));

locationsRouter.post('/admin/service-areas', authenticateToken, requireRole(UserRole.ADMIN), wrap(async (req, res) => {
  res.status(201).json({ success: true, data: await ServiceAreasService.createServiceArea(createAreaSchema.parse(req.body)) });
}));

locationsRouter.patch('/admin/service-areas/:id', authenticateToken, requireRole(UserRole.ADMIN), wrap(async (req, res) => {
  res.json({ success: true, data: await ServiceAreasService.updateServiceArea(id.parse(req.params.id), updateAreaSchema.parse(req.body)) });
}));
