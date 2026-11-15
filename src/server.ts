import { createApp } from './app.js';
import { env } from './config/env.js';
import { startScheduler } from './jobs/scheduler.js';
import { shutdownAnalytics } from './common/analytics.js';

const app = createApp();

const server = app.listen(env.PORT, () => {
  console.log(`🚀 Becho API server running on port ${env.PORT} [${env.NODE_ENV}]`);
  console.log(`👉 Health check: http://localhost:${env.PORT}/api/v1/health`);
  startScheduler(env.JOBS_INTERVAL_MINUTES);
});

// Render sends SIGTERM on redeploy/spin-down: finish in-flight requests and flush analytics.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    server.close(() => {
      void shutdownAnalytics().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(0), 8000).unref();
  });
}
