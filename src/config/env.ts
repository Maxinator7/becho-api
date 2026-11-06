import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  PORT: z.string().default('4000').transform((val) => parseInt(val, 10)),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  CLIENT_WEB_URL: z.string().default('http://localhost:3000'),
  JWT_SECRET: z.string().default('becho_default_dev_jwt_secret_key_change_in_prod'),
  JWT_REFRESH_SECRET: z.string().default('becho_default_dev_jwt_refresh_secret_key_change_in_prod'),
});

const _env = envSchema.safeParse(process.env);

if (!_env.success) {
  console.error('❌ Invalid environment variables:', _env.error.format());
  throw new Error('Invalid environment variables');
}

export const env = _env.data;
