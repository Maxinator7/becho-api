import { z } from 'zod';
import { USER_CODE_PATTERN } from '../../common/user-code.js';

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

export const phone = z
  .string()
  .transform((val, ctx) => {
    const normalized = normalizeIndianPhone(val);
    if (!normalized) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a valid 10-digit Indian mobile number' });
      return z.NEVER;
    }
    return normalized;
  });

const email = z.string().trim().toLowerCase().email('Enter a valid email address').max(254);

/** 8–128 characters with at least one letter and one number. */
export const password = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password must be at most 128 characters')
  .refine((p) => /[A-Za-z]/.test(p) && /\d/.test(p), 'Password must contain at least one letter and one number');

export const registerSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(2, 'Name must be at least 2 characters')
    .max(60, 'Name must be at most 60 characters')
    .regex(/^[\p{L}\p{M} .'-]+$/u, 'Name can only contain letters, spaces, dots, apostrophes and hyphens'),
  phone,
  email,
  password,
});

export type IdentifierKind = 'email' | 'phone' | 'userCode';

/** Email, Indian mobile number or user code (BCH-XXXXXX) — whichever the user typed. */
export const identifier = z
  .string()
  .trim()
  .min(1, 'Enter your email or mobile number')
  .max(254)
  .transform((raw, ctx): { kind: IdentifierKind; value: string } => {
    if (raw.includes('@')) {
      const parsed = email.safeParse(raw);
      if (!parsed.success) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a valid email address' });
        return z.NEVER;
      }
      return { kind: 'email', value: parsed.data };
    }
    const code = raw.toUpperCase();
    if (USER_CODE_PATTERN.test(code)) return { kind: 'userCode', value: code };
    const mobile = normalizeIndianPhone(raw);
    if (mobile) return { kind: 'phone', value: mobile };
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a valid email or 10-digit mobile number' });
    return z.NEVER;
  });

/** Accepts { identifier } (preferred) or the older { email } / { phone } shape. */
export const loginSchema = z
  .object({
    identifier: z.string().optional(),
    email: z.string().optional(),
    phone: z.string().optional(),
    password: z.string().min(1, 'Password is required').max(128),
  })
  .transform((data, ctx) => {
    const raw = data.identifier ?? data.email ?? data.phone;
    const parsed = identifier.safeParse(raw ?? '');
    if (!parsed.success) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['identifier'], message: parsed.error.issues[0]?.message ?? 'Enter your email or mobile number' });
      return z.NEVER;
    }
    return { identifier: parsed.data, password: data.password };
  });

export const verifyOtpSchema = z.object({
  channel: z.enum(['EMAIL', 'PHONE']).optional(),
  code: z.string().regex(/^\d{6}$/, 'Verification code must be 6 digits'),
});

export const forgotPasswordSchema = z.object({ identifier });

export const resetPasswordSchema = z.object({
  identifier,
  code: z.string().regex(/^\d{6}$/, 'The code is 6 digits'),
  newPassword: password,
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password'),
    newPassword: password,
  })
  .refine((d) => d.currentPassword !== d.newPassword, { path: ['newPassword'], message: 'New password must be different from the current one' });

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type VerifyOtpInput = z.infer<typeof verifyOtpSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type Identifier = z.infer<typeof identifier>;
