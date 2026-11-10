import { Router } from 'express';
import { z } from 'zod';
import { UsersService } from './users.service.js';
import { authenticateToken } from '../../common/middleware/auth-guard.js';
import { asyncHandler as wrap } from '../../common/async-handler.js';

export const usersRouter = Router();

const updateProfileSchema = z.object({ displayName: z.string().trim().min(2).max(60).optional() });

usersRouter.get('/me', authenticateToken, wrap(async (req, res) => {
  res.json({ success: true, data: await UsersService.getProfile(req.user!.userId) });
}));

usersRouter.patch('/me', authenticateToken, wrap(async (req, res) => {
  res.json({ success: true, data: await UsersService.updateProfile(req.user!.userId, updateProfileSchema.parse(req.body)) });
}));
