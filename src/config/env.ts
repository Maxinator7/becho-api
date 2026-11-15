import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const DEV_JWT_SECRET = 'becho_default_dev_jwt_secret_key_change_in_prod';
const DEV_JWT_REFRESH_SECRET = 'becho_default_dev_jwt_refresh_secret_key_change_in_prod';

const num = (fallback: string) => z.string().default(fallback).transform((val) => parseInt(val, 10)).pipe(z.number().int().nonnegative());

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

    // Public base URL of this API (used for locally stored media URLs). Render sets RENDER_EXTERNAL_URL.
    PUBLIC_API_URL: z.string().url().optional(),
    RENDER_EXTERNAL_URL: z.string().url().optional(),

    // Media storage: "local" writes to disk (dev/tests; NOT persistent on Render), "r2" uses Cloudflare R2.
    STORAGE_DRIVER: z.enum(['local', 'r2']).default('local'),
    LOCAL_UPLOAD_DIR: z.string().default('./uploads'),
    R2_ACCOUNT_ID: z.string().optional(),
    R2_ACCESS_KEY_ID: z.string().optional(),
    R2_SECRET_ACCESS_KEY: z.string().optional(),
    R2_BUCKET: z.string().optional(),
    R2_PUBLIC_URL: z.string().url().optional(), // e.g. https://pub-xxxx.r2.dev or https://media.example.com

    // Media and posting limits
    MEDIA_MAX_IMAGE_MB: num('5'),
    MEDIA_MAX_VIDEO_MB: num('50'),
    MEDIA_MAX_VIDEO_SECONDS: num('60'),
    MEDIA_MAX_IMAGES_PER_LISTING: num('10'),
    MEDIA_MAX_VIDEOS_PER_LISTING: num('1'),
    MEDIA_UPLOADS_PER_DAY: num('100'),
    LISTINGS_PER_DAY: num('5'),

    // Transactional email (OTP, password reset) via Brevo's HTTPS API. Unset = log emails to the console.
    BREVO_API_KEY: z.string().optional(),
    EMAIL_FROM: z.string().email().default('no-reply@becho.local'),
    EMAIL_FROM_NAME: z.string().default('Becho'),

    // Product analytics (server-side events). Unset = disabled.
    POSTHOG_KEY: z.string().optional(),
    POSTHOG_HOST: z.string().url().default('https://us.i.posthog.com'),
  })
  .superRefine((cfg, ctx) => {
    if (cfg.STORAGE_DRIVER === 'r2') {
      for (const key of ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET', 'R2_PUBLIC_URL'] as const) {
        if (!cfg[key]) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: `${key} is required when STORAGE_DRIVER=r2` });
      }
      // Catch copy-paste mistakes at startup instead of failing on the first upload.
      const shape: [keyof typeof cfg, RegExp, string][] = [
        ['R2_ACCOUNT_ID', /^[0-9a-f]{32}$/, '32 hex characters (from the dashboard URL)'],
        ['R2_ACCESS_KEY_ID', /^[0-9a-f]{32}$/, '32 hex characters'],
        ['R2_SECRET_ACCESS_KEY', /^[0-9a-f]{64}$/, '64 hex characters'],
      ];
      for (const [key, pattern, expected] of shape) {
        const value = cfg[key];
        if (typeof value === 'string' && value && !pattern.test(value)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: `${key} looks wrong: expected ${expected}, got ${value.length} characters` });
        }
      }
      if (cfg.R2_PUBLIC_URL?.includes('r2.cloudflarestorage.com')) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['R2_PUBLIC_URL'], message: 'R2_PUBLIC_URL is the private S3 endpoint; use the bucket\'s public r2.dev URL (or custom domain)' });
      }
    }
    if (cfg.BREVO_API_KEY && cfg.EMAIL_FROM.endsWith('.local')) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['EMAIL_FROM'], message: 'EMAIL_FROM must be the sender address you verified in Brevo' });
    }
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

export const publicApiUrl = (env.PUBLIC_API_URL ?? env.RENDER_EXTERNAL_URL ?? `http://localhost:${env.PORT}`).replace(/\/$/, '');

if (isProduction && env.STORAGE_DRIVER === 'local') {
  console.warn('⚠️  STORAGE_DRIVER=local in production: uploaded media is lost on every restart/redeploy. Configure R2.');
}
