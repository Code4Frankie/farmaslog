import { AuditLog } from '../models/AuditLog.js';
import { logger } from '../utils/logger.js';

export const auditCtx = (req) => ({ actor: req.user ? { id: req.user.id, role: req.user.role } : null, requestId: req.id });

export async function writeAudit(ctx, { action, entityType, entityId, changes }) {
  try {
    await AuditLog.create({
      actorId: ctx?.actor?.id,
      actorRole: ctx?.actor?.role,
      action,
      entityType,
      entityId: entityId ? String(entityId) : undefined,
      changes,
      requestId: ctx?.requestId,
    });
  } catch (err) {
    logger.error('audit_write_failed', { action, entityType, message: err.message });
  }
}
