import { createApp } from './app.js';
import { connectDb, disconnectDb } from './config/db.js';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';
import { ensureBootstrapAdmin } from './bootstrap.js';
import { migrateConsent } from './migrations/consent.js';
import { migratePhoneIndex } from './migrations/phone.js';

await connectDb(env.mongoUri);
await ensureBootstrapAdmin();
await migratePhoneIndex().then((d) => d && logger.info('phone_index_dropped')).catch((e) => logger.error('phone_migration_failed', { message: e.message }));
await migrateConsent().then((n) => n && logger.info('consent_migration', { flagged: n })).catch((e) => logger.error('consent_migration_failed', { message: e.message }));
const server = createApp().listen(env.port, () => logger.info('farmaslog_api_listening', { port: env.port, env: env.nodeEnv }));

async function shutdown(signal) {
  logger.info('shutting_down', { signal });
  server.close(async () => { await disconnectDb(); process.exit(0); });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
