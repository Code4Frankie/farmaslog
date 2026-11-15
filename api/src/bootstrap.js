import bcrypt from 'bcryptjs';
import { User } from './models/User.js';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';

// Creates the FIRST super admin from BOOTSTRAP_ADMIN_EMAIL / BOOTSTRAP_ADMIN_PASSWORD, and only when no super admin
// exists yet. It never creates a second one and never changes an existing password. Remove the variables after first use.
export async function ensureBootstrapAdmin() {
  const { bootstrapAdminEmail: email, bootstrapAdminPassword: password } = env;
  if (!email || !password) return { created: false, reason: 'not_configured' };
  if (password.length < 12) {
    logger.warn('bootstrap_admin_skipped', { reason: 'BOOTSTRAP_ADMIN_PASSWORD must be at least 12 characters' });
    return { created: false, reason: 'password_too_short' };
  }
  if (await User.exists({ role: 'super_admin' })) return { created: false, reason: 'admin_exists' };
  await User.create({ email, name: 'FarmasLog Admin', role: 'super_admin', passwordHash: await bcrypt.hash(password, 12) });
  logger.info('bootstrap_admin_created', { email });
  return { created: true };
}
