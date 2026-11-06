import { Router, Request, Response, NextFunction } from 'express';
import { UsersService } from './users.service.js';
import { authenticateToken } from '../../common/middleware/auth-guard.js';

export const usersRouter = Router();

usersRouter.get('/me', authenticateToken, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await UsersService.getProfile(req.user!.userId);
    res.json({ success: true, data: user });
  } catch (err) {
    next(err);
  }
});

usersRouter.patch('/me', authenticateToken, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { displayName } = req.body;
    const user = await UsersService.updateProfile(req.user!.userId, { displayName });
    res.json({ success: true, data: user });
  } catch (err) {
    next(err);
  }
});
