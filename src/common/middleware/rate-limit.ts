import rateLimit from 'express-rate-limit';
import { env } from '../../config/env.js';

const tooManyRequests = {
  success: false,
  error: { code: 'RATE_LIMITED', message: 'Too many requests. Please try again in a few minutes.' },
};

/** Per-IP limit for login/register/OTP endpoints to slow down password guessing and signup spam. */
export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.AUTH_RATE_LIMIT,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: tooManyRequests,
  skip: () => env.NODE_ENV === 'test',
});

/** Coarse per-IP limit for the whole API. */
export const apiRateLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: tooManyRequests,
  skip: () => env.NODE_ENV === 'test',
});
