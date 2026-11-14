import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const DEV_JWT_SECRET = 'becho_default_dev_jwt_secret_key_change_in_prod';
const DEV_JWT_REFRESH_SECRET = 'becho_default_dev_jwt_refresh_secret_key_change_in_prod';

const envSchema = z
  .object({
    PORT: z.string().default('4000').transform((val) => parseInt(val, 10)),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    CORS_ORIGINS: z
      .string()
      .default('http://localhost:3000')
      .transform((val) => val.split(',').map((o) => o.trim()).filter(Boolean)),
    JWT_SECRET: z.string().default(DEV_JWT_SECRET),
    JWT_REFRESH_SECRET: z.string().default(DEV_JWT_REFRESH_SECRET),
    JOBS_INTERVAL_MINUTES: z.string().default('15').transform((val) => parseInt(val, 10)),
    // Return OTP codes in API responses (shown on screen) instead of sending SMS.
    // Defaults to on outside production. Set to "true" on staging until an SMS provider exists.
    EXPOSE_DEV_OTP: z.enum(['true', 'false']).optional(),
    // Rate limit on /auth endpoints: max requests per IP per 15 minutes.
    AUTH_RATE_LIMIT: z.string().default('30').transform((val) => parseInt(val, 10)),
  })
  .superRefine((cfg, ctx) => {
    if (cfg.NODE_ENV !== 'production') return;
    for (const key of ['JWT_SECRET', 'JWT_REFRESH_SECRET'] as const) {
      const value = cfg[key];
      if (value === DEV_JWT_SECRET || value === DEV_JWT_REFRESH_SECRET || value.startsWith('change-me') || value.length < 32) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: `${key} must be set to a strong secret (32+ chars) in production` });
      }
    }
  });

const _env = envSchema.safeParse(process.env);

if (!_env.success) {
  console.error('❌ Invalid environment variables:', _env.error.format());
  throw new Error('Invalid environment variables');
}

export const env = _env.data;
export const isProduction = env.NODE_ENV === 'production';
export const exposeDevOtp = env.EXPOSE_DEV_OTP ? env.EXPOSE_DEV_OTP === 'true' : !isProduction;

if (isProduction && exposeDevOtp) {
  console.warn('⚠️  EXPOSE_DEV_OTP is on: OTP codes are returned in API responses. Use for staging only.');
}
