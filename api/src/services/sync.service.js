import { registerFarmer } from './farmer.service.js';
import { writeAudit } from './audit.service.js';
import { syncRecordSchema } from '../validators/index.js';
import { AppError } from '../utils/AppError.js';
import { logger } from '../utils/logger.js';

const MAX_AGE_MS = 120 * 24 * 3600_000; // a phone that has been offline for four months is a data-quality problem
const CLOCK_SKEW_MS = 10 * 60_000;

/**
 * Upload registrations an agent saved while offline. Each record is judged on its own: one bad record never blocks the rest.
 * Safe to send again: the same clientId from the same agent is recognised and not created twice.
 * Returns one result per record: created | already_synced | duplicate_review | error.
 */
export async function syncOfflineRegistrations(records, user, ctx) {
  const results = [];
  const tally = { created: 0, already_synced: 0, duplicate_review: 0, error: 0 };
  for (const raw of records) {
    const clientId = typeof raw?.clientId === 'string' ? raw.clientId.slice(0, 64) : null;
    const push = (r) => { tally[r.status] += 1; results.push({ clientId, ...r }); };
    const { error, value } = syncRecordSchema.validate(raw, { abortEarly: false, stripUnknown: true, convert: true });
    if (error) { push({ status: 'error', errorCode: 'VALIDATION_ERROR', message: 'Some details are missing or not valid.', details: error.details.map((d) => d.message.replace(/"/g, "'")) }); continue; }
    const age = Date.now() - value.capturedAt.getTime();
    if (age < -CLOCK_SKEW_MS) { push({ status: 'error', errorCode: 'BAD_CAPTURE_TIME', message: 'The phone\'s clock was ahead of the real time when this was saved. Check the date on the phone and save it again.' }); continue; }
    if (age > MAX_AGE_MS) { push({ status: 'error', errorCode: 'TOO_OLD', message: 'This was saved more than 4 months ago. Please register the farmer again.' }); continue; }
    const { clientId: cid, capturedAt, ...input } = value;
    try {
      const r = await registerFarmer({
        ...input,
        consent: { ...input.consent }, // consent capturedAt is the moment the farmer agreed, not the moment of upload
        source: 'field_agent', sourceChannel: 'field_app', sourceRef: `app:${user.id}:${cid}`, submittedAt: capturedAt,
      }, ctx);
      push({ status: r.alreadyImported ? 'already_synced' : r.isDuplicate ? 'duplicate_review' : 'created', id: String(r.farmer._id), farmaslogId: r.farmer.farmaslogId ?? null });
    } catch (err) {
      if (err instanceof AppError) { push({ status: 'error', errorCode: err.errorCode, message: err.message }); continue; }
      logger.error('offline_sync_record_failed', { requestId: ctx.requestId, message: err.message }); // no personal details in the log
      push({ status: 'error', errorCode: 'SERVER_ERROR', message: 'We could not save this one. Try again in a moment.' });
    }
  }
  await writeAudit(ctx, { action: 'farmer.offline_sync', entityType: 'Farmer', changes: tally });
  return { results, ...tally };
}
