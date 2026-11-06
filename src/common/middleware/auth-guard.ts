import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';
import { ApiError } from '../errors/api-error.js';
import { UserRole, UserStatus } from '../types/enums.js';

export interface AuthenticatedUser {
  userId: string;
  role: UserRole;
  status: UserStatus;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

export function authenticateToken(req: Request, _res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(ApiError.unauthorized('Access token is missing or malformed', 'MISSING_TOKEN'));
  }

  const token = authHeader.split(' ')[1];
  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as AuthenticatedUser;
    req.user = payload;
    next();
  } catch (err) {
    next(ApiError.unauthorized('Invalid or expired access token', 'EXPIRED_TOKEN'));
  }
}

export function requireRole(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(ApiError.unauthorized('Authentication required', 'AUTH_REQUIRED'));
    }
    if (!roles.includes(req.user.role)) {
      return next(ApiError.forbidden('Forbidden: insufficient permissions', 'INSUFFICIENT_PERMISSIONS'));
    }
    next();
  };
}

export function requireActiveStatus(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) {
    return next(ApiError.unauthorized('Authentication required', 'AUTH_REQUIRED'));
  }
  if (req.user.status !== UserStatus.ACTIVE) {
    return next(ApiError.forbidden('Account verification or active status required', 'INACTIVE_ACCOUNT'));
  }
  next();
}
