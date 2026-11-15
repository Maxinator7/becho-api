import { Router } from 'express';
import { z } from 'zod';
import { UsersService } from './users.service.js';
import { authenticateToken } from '../../common/middleware/auth-guard.js';
import { asyncHandler as wrap } from '../../common/async-handler.js';
import { phone } from '../auth/auth.schema.js';

export const usersRouter = Router();

const updateProfileSchema = z.object({
  displayName: z.string().trim().min(2, 'Name must be at least 2 characters').max(60).optional(),
  phone: phone.optional(),
});

usersRouter.get('/me', authenticateToken, wrap(async (req, res) => {
  res.json({ success: true, data: await UsersService.getProfile(req.user!.userId) });
}));

usersRouter.patch('/me', authenticateToken, wrap(async (req, res) => {
  res.json({ success: true, data: await UsersService.updateProfile(req.user!.userId, updateProfileSchema.parse(req.body)) });
}));
