import { z } from 'zod';

/**
 * Normalises Indian mobile numbers to E.164 (+91XXXXXXXXXX).
 * Accepts "9876543210", "09876543210", "+91 98765 43210", "91-98765-43210".
 */
export function normalizeIndianPhone(raw: string): string | null {
  const digits = raw.replace(/[\s\-()]/g, '').replace(/^\+/, '');
  let local = digits;
  if (local.length === 12 && local.startsWith('91')) local = local.slice(2);
  else if (local.length === 11 && local.startsWith('0')) local = local.slice(1);
  if (!/^[6-9]\d{9}$/.test(local)) return null;
  return `+91${local}`;
}

const phone = z
  .string()
  .transform((val, ctx) => {
    const normalized = normalizeIndianPhone(val);
    if (!normalized) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a valid 10-digit Indian mobile number' });
      return z.NEVER;
    }
    return normalized;
  });

const email = z.string().trim().toLowerCase().email('Invalid email address');

export const registerSchema = z
  .object({
    displayName: z.string().trim().min(2, 'Display name must be at least 2 characters').max(60),
    email: email.optional(),
    phone: phone.optional(),
    password: z.string().min(8, 'Password must be at least 8 characters').max(128),
  })
  .refine((data) => data.email || data.phone, { message: 'Either email or phone is required', path: ['email'] });

export const loginSchema = z
  .object({
    email: email.optional(),
    phone: phone.optional(),
    password: z.string().min(1, 'Password is required'),
  })
  .refine((data) => data.email || data.phone, { message: 'Either email or phone is required', path: ['email'] });

export const verifyOtpSchema = z.object({
  channel: z.enum(['EMAIL', 'PHONE']).optional(),
  code: z.string().regex(/^\d{6}$/, 'Verification code must be 6 digits'),
});

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type VerifyOtpInput = z.infer<typeof verifyOtpSchema>;
