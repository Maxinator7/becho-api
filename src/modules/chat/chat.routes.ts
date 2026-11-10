import { Router } from 'express';
import { z } from 'zod';
import { ChatService } from './chat.service.js';
import { authenticateToken, requireActiveStatus } from '../../common/middleware/auth-guard.js';
import { asyncHandler as wrap } from '../../common/async-handler.js';
import { id } from '../../common/validation.js';

export const chatRouter = Router();

const initiateSchema = z.object({ listingId: id });
const messageSchema = z.object({ content: z.string().trim().min(1, 'Message content cannot be empty').max(2000) });

chatRouter.use(authenticateToken);

// Start/get conversation for a listing
chatRouter.post('/initiate', requireActiveStatus, wrap(async (req, res) => {
  const { listingId } = initiateSchema.parse(req.body);
  res.json({ success: true, data: await ChatService.getOrCreateConversation(listingId, req.user!.userId) });
}));

chatRouter.get('/', wrap(async (req, res) => {
  res.json({ success: true, data: await ChatService.getUserConversations(req.user!.userId) });
}));

chatRouter.get('/:id/messages', wrap(async (req, res) => {
  res.json({ success: true, data: await ChatService.getConversationMessages(id.parse(req.params.id), req.user!.userId) });
}));

chatRouter.post('/:id/messages', requireActiveStatus, wrap(async (req, res) => {
  const { content } = messageSchema.parse(req.body);
  const message = await ChatService.sendMessage(id.parse(req.params.id), req.user!.userId, content);
  res.status(201).json({ success: true, data: message });
}));

chatRouter.patch('/:id/read', wrap(async (req, res) => {
  await ChatService.markAsRead(id.parse(req.params.id), req.user!.userId);
  res.json({ success: true });
}));
