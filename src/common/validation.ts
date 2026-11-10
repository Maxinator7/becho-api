import { z } from 'zod';

/** Common reusable Zod pieces. */
export const id = z.string().uuid('Invalid id');

/** Parses `data` with `schema`; a ZodError is turned into a 400 by the error handler. */
export function parse<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  return schema.parse(data);
}
