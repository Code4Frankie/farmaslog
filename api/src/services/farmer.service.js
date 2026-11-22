import { buildConsentRecord } from './consent.service.js';
import { Farmer } from '../models/Farmer.js';
import { Farm } from '../models/Farm.js';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';
import { normalizeNigerianPhone } from '../utils/phone.js';
import { generateFarmaslogId } from '../utils/ids.js';
import { assessEvidence } from './evidence.service.js';
import { writeAudit } from './audit.service.js';
import { canonicalArea } from '../data/ng-geo.js';

async function allocateFarmaslogId() {
  for (let i = 0; i < 5; i++) {
    const id = generateFarmaslogId();
    if (!(await Farmer.exists({ farmaslogId: id }))) return id; // unique index is the real guard
  }
  throw new AppError(500, 'ID_ALLOCATION_FAILED', 'Could not allocate a unique FarmasLog ID.');
}

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();
const OPEN = ['active', 'pending_review'];

/**
 * Is this the SAME person as an existing record? Judged on name + LGA + phone together, never the phone alone (a phone
 * may be shared). Without a phone: name + LGA + community. Returns the matching record or null. Never merges anything.
 */
async function findSameFarmer({ name, lga, phone, community, excludeId, statuses = OPEN }) {
  const base = { status: { $in: statuses }, ...(excludeId ? { _id: { $ne: excludeId } } : {}) };
  const n = norm(name);
  const l = norm(lga);
  if (phone) {
    const rows = await Farmer.find({ ...base, phoneNormalized: phone }).select('name lga').limit(50).lean();
    return rows.find((r) => norm(r.name) === n && norm(r.lga) === l) ?? null;
  }
  const rows = await Farmer.find({ ...base, lga, name }).collation({ locale: 'en', strength: 2 }).select('name lga community phoneNormalized').limit(50).lean();
  return rows.find((r) => norm(r.name) === n && norm(r.community) === norm(community)) ?? null;
}

/** A second (different) farmer on the same phone: flag both as sharing it. Returns true when the phone is shared. */
async function flagSharedPhone(farmer, ctx) {
  if (!farmer.phoneNormalized) return false;
  const others = await Farmer.find({ _id: { $ne: farmer._id }, phoneNormalized: farmer.phoneNormalized, status: { $ne: 'rejected' } });
  if (!others.length) return false;
  for (const o of others) {
    if (o.sharedPhone) continue;
    o.sharedPhone = true;
    await o.save();
    await writeAudit(ctx, { action: 'farmer.shared_phone_flagged', entityType: 'Farmer', entityId: o._id, changes: { sharedPhone: { from: false, to: true } } });
  }
  return true;
}

function buildContact(c) {
  if (!c) return undefined;
  let phone;
  if (c.phone) {
    phone = normalizeNigerianPhone(c.phone);
    if (!phone) throw new AppError(400, 'INVALID_PHONE', 'Enter a valid Nigerian mobile number for the contact person.');
  }
  return { type: c.type, name: c.name || undefined, phoneNormalized: phone, relationship: c.relationship || undefined };
}

const buildLocation = (l) => ({
  lat: l.lat, lng: l.lng, source: l.source, accuracyMeters: l.accuracyMeters,
  collectedAt: l.collectedAt || new Date(), provider: l.provider,
});

// ctx = { actor: {id, role} | null, requestId }
export async function registerFarmer(input, ctx) {
  if (input.isSynthetic && !env.allowSynthetic) throw new AppError(400, 'SYNTHETIC_NOT_ALLOWED', 'Synthetic test records are not allowed on this deployment.');

  // Idempotent imports: the same source record is never created twice, so a cumulative CSV export can be re-imported safely.
  if (input.sourceRef) {
    const existing = await Farmer.findOne({ sourceRef: input.sourceRef });
    if (existing) {
      return { farmer: existing, farm: await Farm.findOne({ farmerId: existing._id }), isDuplicate: existing.status === 'duplicate_review', alreadyImported: true };
    }
  }
  let phone;
  if (input.phone) {
    phone = normalizeNigerianPhone(input.phone);
    if (!phone) throw new AppError(400, 'INVALID_PHONE', 'Enter a valid Nigerian mobile number.');
  }
  const contactVia = buildContact(input.contactVia);
  if (!phone && !contactVia) throw new AppError(400, 'CONTACT_REQUIRED', 'Give the farmer\'s phone number, or a contact person who can reach them.');
  const area = canonicalArea(input.state, input.lga); // any state/LGA is accepted; names matching the national list are tidied

  // Duplicate candidates (same name + LGA + phone) are flagged for human review. Nothing is merged or overwritten silently.
  const candidate = await findSameFarmer({ name: input.name, lga: area.lga, phone, community: input.community });
  const isDuplicate = !!candidate;

  const farmer = await Farmer.create({
    farmaslogId: isDuplicate ? undefined : await allocateFarmaslogId(),
    name: input.name, phoneNormalized: phone, contactVia,
    state: area.state, lga: area.lga, ward: input.ward || undefined, community: input.community || undefined,
    ...buildConsentRecord({ ...input.consent, capturedAt: input.submittedAt }, ctx),
    source: input.source || 'field_agent',
    status: isDuplicate ? 'duplicate_review' : 'pending_review',
    isSynthetic: !!input.isSynthetic,
    sourceRef: input.sourceRef,
    sourceChannel: input.sourceChannel,
    submittedAt: input.submittedAt,
    programmeRequested: input.programmeRequested || undefined,
    registeredBy: ctx.actor?.id,
  });

  const farm = new Farm({
    farmerId: farmer._id,
    crop: input.farm.crop,
    reportedArea: input.farm.reportedAreaHa ? { value: input.farm.reportedAreaHa, unit: 'hectares' } : undefined,
    location: input.farm.location ? buildLocation(input.farm.location) : undefined,
    enrichment: { state: 'not_assessed' },
    evidenceInputsUpdatedAt: new Date(),
  });
  farm.evidence = assessEvidence(farm.toObject());
  try {
    await farm.save();
  } catch (err) {
    await Farmer.deleteOne({ _id: farmer._id }); // compensate; standalone MongoDB has no transactions
    throw err;
  }

  // A different person on a number that is already in use: mark the phone as shared on both records.
  let sharedPhone = false;
  if (!isDuplicate) {
    sharedPhone = await flagSharedPhone(farmer, ctx);
    if (sharedPhone) { farmer.sharedPhone = true; await farmer.save(); }
  }
  await writeAudit(ctx, { action: 'farmer.registered', entityType: 'Farmer', entityId: farmer._id, changes: { status: farmer.status, source: farmer.source, duplicateCandidate: isDuplicate, sharedPhone, hasPhone: !!phone, contactType: contactVia?.type ?? null } });
  return { farmer, farm, isDuplicate, alreadyImported: false, warnings: area.warnings };
}

const PII = new Set(['name', 'phone', 'location', 'contactVia']);
const redact = (changes) => Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, PII.has(k) ? { changed: true } : v]));

export async function updateFarmer(farmer, input, ctx) {
  const farm = await Farm.findOne({ farmerId: farmer._id });
  const changes = {};
  if (input.state !== undefined || input.lga !== undefined) {
    const a = canonicalArea(input.state ?? farmer.state, input.lga ?? farmer.lga);
    if (input.state !== undefined) input.state = a.state;
    if (input.lga !== undefined) input.lga = a.lga;
  }
  for (const k of ['name', 'state', 'lga', 'ward', 'community']) {
    if (input[k] !== undefined && String(farmer[k] ?? '') !== String(input[k] ?? '')) {
      changes[k] = { from: farmer[k], to: input[k] };
      farmer[k] = input[k];
    }
  }
  if (input.contactVia !== undefined) {
    farmer.contactVia = input.contactVia ? buildContact(input.contactVia) : undefined;
    changes.contactVia = { changed: true };
  }
  if (input.phone !== undefined) {
    const p = input.phone ? normalizeNigerianPhone(input.phone) : undefined;
    if (input.phone && !p) throw new AppError(400, 'INVALID_PHONE', 'Enter a valid Nigerian mobile number.');
    if (p !== (farmer.phoneNormalized ?? undefined)) {
      farmer.phoneNormalized = p;
      changes.phone = { changed: true };
      farmer.sharedPhone = false; // recomputed below
    }
  }
  if (!farmer.phoneNormalized && !farmer.contactVia?.type) {
    throw new AppError(400, 'CONTACT_REQUIRED', 'A farmer needs a phone number or a contact person. Add a contact person before removing the phone.');
  }
  if (input.sharedPhone !== undefined && input.sharedPhone !== !!farmer.sharedPhone) {
    changes.sharedPhone = { from: !!farmer.sharedPhone, to: input.sharedPhone };
    farmer.sharedPhone = input.sharedPhone;
  } else if (changes.phone && farmer.phoneNormalized) {
    // A phone just set or changed: do other (different) records already use it?
    if (await flagSharedPhone(farmer, ctx)) { farmer.sharedPhone = true; changes.sharedPhone = { from: false, to: true }; }
  }
  if (input.farm && farm) {
    const f = input.farm;
    let inputsChanged = false;
    if (f.crop !== undefined && f.crop !== farm.crop) { changes.crop = { from: farm.crop, to: f.crop }; farm.crop = f.crop; }
    if (f.reportedAreaHa !== undefined && f.reportedAreaHa !== farm.reportedArea?.value) {
      changes.reportedAreaHa = { from: farm.reportedArea?.value, to: f.reportedAreaHa };
      farm.reportedArea = { value: f.reportedAreaHa, unit: 'hectares' };
      inputsChanged = true;
    }
    if (f.location) { farm.location = buildLocation(f.location); changes.location = { changed: true }; inputsChanged = true; }
    if (inputsChanged) farm.evidenceInputsUpdatedAt = new Date();
    farm.evidence = assessEvidence(farm.toObject());
  }
  if (!Object.keys(changes).length) return { farmer, farm, changed: false };

  await farmer.save();
  if (farm) await farm.save();
  await writeAudit(ctx, { action: 'farmer.updated', entityType: 'Farmer', entityId: farmer._id, changes: redact(changes) });
  return { farmer, farm, changed: true };
}

export async function reviewFarmer(farmer, { decision, note }, ctx) {
  if (!['pending_review', 'duplicate_review'].includes(farmer.status)) {
    throw new AppError(409, 'INVALID_STATE', `A record in status '${farmer.status}' cannot be reviewed.`);
  }
  const from = farmer.status;
  if (decision === 'reject') {
    farmer.status = 'rejected';
  } else {
    if (farmer.consentStatus === 'withdrawn') throw new AppError(409, 'CONSENT_WITHDRAWN', 'Consent was withdrawn for this record. Record fresh consent before approving it.');
    const clash = await findSameFarmer({ name: farmer.name, lga: farmer.lga, phone: farmer.phoneNormalized, community: farmer.community, excludeId: farmer._id, statuses: ['active'] });
    if (clash) {
      throw new AppError(409, 'DUPLICATE_PHONE', 'An active record already has the same name, LGA and phone. Reject this record or correct the existing one; records are never merged automatically.');
    }
    if (!farmer.farmaslogId) farmer.farmaslogId = await allocateFarmaslogId();
    farmer.status = 'active';
    if (await flagSharedPhone(farmer, ctx)) farmer.sharedPhone = true;
  }
  farmer.reviewedBy = ctx.actor?.id;
  farmer.reviewedAt = new Date();
  farmer.reviewNote = note;
  await farmer.save();
  await writeAudit(ctx, { action: `farmer.review.${decision}`, entityType: 'Farmer', entityId: farmer._id, changes: { status: { from, to: farmer.status } } });
  return farmer;
}

export async function recordFieldVerification(farmer, farm, input, ctx) {
  if (farmer.status === 'rejected') throw new AppError(409, 'INVALID_STATE', 'This record was rejected.');
  if (farmer.consentStatus === 'withdrawn') throw new AppError(409, 'CONSENT_WITHDRAWN', 'Consent was withdrawn for this record.');
  const now = new Date();
  if (input.location) {
    farm.location = buildLocation({ ...input.location, source: 'gps_field_agent', collectedAt: now });
    farm.evidenceInputsUpdatedAt = now; // same instant as verifiedAt, so it is not treated as stale
  }
  farm.fieldVerification = { outcome: input.outcome, method: input.method, notes: input.notes, verifiedBy: ctx.actor?.id, verifiedAt: now };
  farm.evidence = assessEvidence(farm.toObject(), now);
  await farm.save();
  await writeAudit(ctx, { action: 'farm.field_verification', entityType: 'Farm', entityId: farm._id, changes: { outcome: input.outcome, method: input.method, evidenceStatus: farm.evidence.status } });
  return farm;
}
