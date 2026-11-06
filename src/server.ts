import { createApp } from './app.js';
import { env } from './config/env.js';

const app = createApp();

app.listen(env.PORT, () => {
  console.log(`🚀 Becho API server running on port ${env.PORT} [${env.NODE_ENV}]`);
  console.log(`👉 Health check: http://localhost:${env.PORT}/api/v1/health`);
});
