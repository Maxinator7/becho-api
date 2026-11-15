import { PostHog } from 'posthog-node';
import { env } from '../config/env.js';

/**
 * Server-side product events (sign-ups, listings, offers, deals) sent to PostHog.
 * Server events can't be blocked by ad-blockers, so funnels stay accurate.
 * No-op when POSTHOG_KEY is unset or in tests. Never send personal data (email/phone) here.
 */
const client = env.POSTHOG_KEY && env.NODE_ENV !== 'test'
  ? new PostHog(env.POSTHOG_KEY, { host: env.POSTHOG_HOST, flushAt: 20, flushInterval: 10_000 })
  : null;

export function track(userId: string, event: string, properties: Record<string, unknown> = {}) {
  if (!client) return;
  try {
    client.capture({ distinctId: userId, event, properties: { ...properties, source: 'api' } });
  } catch {
    // Analytics must never break a request.
  }
}

/** Flush queued events (called on shutdown). */
export async function shutdownAnalytics() {
  await client?.shutdown().catch(() => {});
}
