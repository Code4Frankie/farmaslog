// Usage: npm run seed                 -> creates a super admin (password printed once)
//        npm run seed -- --demo       -> also creates the synthetic Micheal/Nancy test journey (never in production)
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { connectDb, disconnectDb } from '../src/config/db.js';
import { env } from '../src/config/env.js';
import { User } from '../src/models/User.js';
import { Partner } from '../src/models/Partner.js';
import { registerFarmer, reviewFarmer } from '../src/services/farmer.service.js';
import { createApiKey } from '../src/services/apiKey.service.js';

const demo = process.argv.includes('--demo');
if (demo && !env.allowSynthetic) { console.error('Refusing to seed demo data on a deployment that does not allow synthetic records.'); process.exit(1); }
const pw = () => crypto.randomBytes(12).toString('base64url');

await connectDb(env.mongoUri);
const out = [];

async function ensureUser({ email, name, role, partnerId, fixedPassword }) {
  if (await User.exists({ email })) { out.push(`${email}: already exists (password unchanged)`); return User.findOne({ email }); }
  const password = fixedPassword && fixedPassword.length >= 12 ? fixedPassword : pw();
  const u = await User.create({ email, name, role, partnerId, passwordHash: await bcrypt.hash(password, 12) });
  out.push(`${role.padEnd(16)} ${email}  password: ${password}`);
  return u;
}

const admin = await ensureUser({ email: process.env.SEED_ADMIN_EMAIL || 'admin@farmaslog.local', name: 'FarmasLog Admin', role: 'super_admin', fixedPassword: process.env.SEED_ADMIN_PASSWORD });

if (demo) {
  await ensureUser({ email: 'data.manager@farmaslog.test', name: 'Test Data Manager', role: 'data_manager' });
  await ensureUser({ email: 'field.agent@farmaslog.test', name: 'Test Field Agent', role: 'field_agent' });
  let partner = await Partner.findOne({ organization: 'FarmasLog Test Partner' });
  if (!partner) partner = await Partner.create({ organization: 'FarmasLog Test Partner', type: 'programme', plan: 'free' });
  await ensureUser({ email: 'nancy.ahile@farmaslog.test', name: 'Nancy Ahile (TEST)', role: 'partner_verifier', partnerId: partner._id });
  const { fullKey } = await createApiKey({ partnerId: partner._id, name: 'Nancy test key', mode: 'test', plan: 'free', createdBy: admin._id });
  out.push(`API key (test, shown once): ${fullKey}`);

  // Synthetic phone, clearly flagged. Micheal Ahile here is a test persona, not a real farmer record.
  const ctx = { actor: { id: String(admin._id), role: 'super_admin' }, requestId: 'seed' };
  try {
    const { farmer } = await registerFarmer({
      name: 'Micheal Ahile (TEST)', phone: '08000000001', state: 'Benue', lga: 'Vandeikya', ward: 'Ihugh', community: 'Ihugh',
      consent: { given: true, wordingVersion: 'test-v0' }, source: 'admin', isSynthetic: true,
      farm: { crop: 'White yam', reportedAreaHa: 1.5 },
    }, ctx);
    await reviewFarmer(farmer, { decision: 'approve', note: 'seed' }, ctx);
    out.push(`Synthetic farmer: ${farmer.farmaslogId}  phone 08000000001`);
  } catch (e) { out.push(`Synthetic farmer skipped: ${e.message}`); }
}
console.log(out.join('\n'));
await disconnectDb();
