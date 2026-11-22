// Usage: node scripts/migrate-consent.js   (reads MONGODB_URI like the server). Safe to run repeatedly.
import { connectDb, disconnectDb } from '../src/config/db.js';
import { env } from '../src/config/env.js';
import { migrateConsent } from '../src/migrations/consent.js';

await connectDb(env.mongoUri);
const n = await migrateConsent();
console.log(`flagged ${n} farmer record(s) as needs_reconsent`);
await disconnectDb();
