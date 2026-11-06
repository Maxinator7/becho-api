import { Router, Request, Response, NextFunction } from 'express';
import { ChatService } from './chat.service.js';
import { authenticateToken } from '../../common/middleware/auth-guard.js';

export const chatRouter = Router();

// Require authentication for all chat operations
chatRouter.use(authenticateToken);

// Start/get conversation for a listing
chatRouter.post('/initiate', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { listingId } = req.body;
    const conversation = await ChatService.getOrCreateConversation(listingId, req.user!.userId);
    res.json({ success: true, data: conversation });
  } catch (err) {
    next(err);
  }
});

// Get user's conversation list
chatRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const conversations = await ChatService.getUserConversations(req.user!.userId);
    res.json({ success: true, data: conversations });
  } catch (err) {
    next(err);
  }
});

// Get messages for a specific conversation
chatRouter.get('/:id/messages', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await ChatService.getConversationMessages(req.params.id, req.user!.userId);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

// Send a message in a conversation
chatRouter.post('/:id/messages', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { content } = req.body;
    const message = await ChatService.sendMessage(req.params.id, req.user!.userId, content);
    res.status(201).json({ success: true, data: message });
  } catch (err) {
    next(err);
  }
});

// Mark messages as read
chatRouter.patch('/:id/read', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await ChatService.markAsRead(req.params.id, req.user!.userId);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});
