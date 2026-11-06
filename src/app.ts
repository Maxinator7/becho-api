import express from 'express';
import cors from 'cors';
import { requestLogger } from './common/middleware/request-logger.js';
import { errorHandler } from './common/middleware/error-handler.js';
import { healthRouter } from './routes/health.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { usersRouter } from './modules/users/users.routes.js';
import { locationsRouter } from './modules/locations/locations.routes.js';
import { categoriesRouter } from './modules/categories/categories.routes.js';
import { listingsRouter } from './modules/listings/listings.routes.js';
import { moderationRouter } from './modules/admin/moderation.routes.js';
import { chatRouter } from './modules/chat/chat.routes.js';
import { favoritesRouter } from './modules/favorites/favorites.routes.js';
import { offersRouter } from './modules/offers/offers.routes.js';
import { notificationsRouter } from './modules/notifications/notifications.routes.js';
import { ApiError } from './common/errors/api-error.js';

export function createApp() {
  const app = express();

  // Standard middleware
  app.use(cors());
  app.use(express.json());
  app.use(requestLogger);

  // API v1 Routes
  app.use('/api/v1', healthRouter);
  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1/users', usersRouter);
  app.use('/api/v1/locations', locationsRouter);
  app.use('/api/v1/categories', categoriesRouter);
  app.use('/api/v1/listings', listingsRouter);
  app.use('/api/v1/admin/moderation', moderationRouter);
  app.use('/api/v1/conversations', chatRouter);
  app.use('/api/v1/favorites', favoritesRouter);
  app.use('/api/v1/offers', offersRouter);
  app.use('/api/v1/notifications', notificationsRouter);

  // 404 fallback for unknown routes
  app.use((_req, _res, next) => {
    next(ApiError.notFound('Endpoint not found', 'ROUTE_NOT_FOUND'));
  });

  // Global Error Handler
  app.use(errorHandler);

  return app;
}
