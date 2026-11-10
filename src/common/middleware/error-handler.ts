import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { ApiError } from '../errors/api-error.js';

function send(res: Response, status: number, code: string, message: string, details?: unknown) {
  res.status(status).json({
    success: false,
    error: { code, message, ...(details ? { details } : {}) },
  });
}

export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ApiError) {
    return send(res, err.statusCode, err.code, err.message);
  }

  if (err instanceof ZodError) {
    const details = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    return send(res, 400, 'VALIDATION_ERROR', details[0]?.message || 'Invalid request', details);
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') return send(res, 409, 'CONFLICT', 'A record with these values already exists');
    if (err.code === 'P2025') return send(res, 404, 'NOT_FOUND', 'Resource not found');
    if (err.code === 'P2003') return send(res, 400, 'INVALID_REFERENCE', 'A referenced record does not exist');
  }

  // Malformed JSON body from express.json()
  if ((err as any).type === 'entity.parse.failed') {
    return send(res, 400, 'INVALID_JSON', 'Request body is not valid JSON');
  }

  console.error('Unhandled Error:', err);
  send(res, 500, 'INTERNAL_SERVER_ERROR', 'An unexpected error occurred');
}
