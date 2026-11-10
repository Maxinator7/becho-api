import { Router, Request, Response, NextFunction } from 'express';
import { NotificationsService } from './notifications.service.js';
import { authenticateToken } from '../../common/middleware/auth-guard.js';

export const notificationsRouter = Router();

// All notification endpoints require authentication
notificationsRouter.use(authenticateToken);

// GET /api/v1/notifications — paginated list
notificationsRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = req.query.page ? Number(req.query.page) : 1;
    const limit = req.query.limit ? Number(req.query.limit) : 20;
    const result = await NotificationsService.getUserNotifications(req.user!.userId, page, limit);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/notifications/unread-count — unread badge count
notificationsRouter.get('/unread-count', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const count = await NotificationsService.getUnreadCount(req.user!.userId);
    res.json({ success: true, data: { unreadCount: count } });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/notifications/:id/read — mark single as read
notificationsRouter.post('/:id/read', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const notification = await NotificationsService.markAsRead(req.params.id, req.user!.userId);
    if (!notification) {
      return res.status(404).json({ success: false, error: { code: 'NOTIFICATION_NOT_FOUND', message: 'Notification not found' } });
    }
    res.json({ success: true, data: notification });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/notifications/read-all — mark all as read
notificationsRouter.post('/read-all', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await NotificationsService.markAllAsRead(req.user!.userId);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});
