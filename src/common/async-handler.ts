import { Request, Response, NextFunction } from 'express';

type Handler = (req: Request, res: Response) => Promise<unknown>;

/** Forwards rejected promises from async route handlers to the error middleware. */
export const asyncHandler = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => {
  fn(req, res).catch(next);
};
