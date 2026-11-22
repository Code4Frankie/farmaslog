import { Farmer } from '../models/Farmer.js';
import { AuditLog } from '../models/AuditLog.js';

/**
 * A phone number may now be shared by several farmers, so the old "one ACTIVE record per phone" unique index must go.
 * Idempotent: does nothing when the index is already gone (or the collection does not exist yet). Returns true if dropped.
 */
export async function migratePhoneIndex() {
  const indexes = await Farmer.collection.indexes().catch(() => []);
  const old = indexes.find((i) => i.unique && Object.keys(i.key).length === 1 && i.key.phoneNormalized === 1);
  if (!old) return false;
  await Farmer.collection.dropIndex(old.name);
  await AuditLog.create({ action: 'migration.phone_unique_index_dropped', entityType: 'Farmer', entityId: 'index', changes: { index: old.name }, requestId: 'migration' });
  return true;
}
