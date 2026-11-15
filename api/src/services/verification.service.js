import { Farmer } from '../models/Farmer.js';
import { Farm } from '../models/Farm.js';
import { env } from '../config/env.js';
import { SCOPES } from '../config/constants.js';
import { AppError } from '../utils/AppError.js';
import { normalizeNigerianPhone } from '../utils/phone.js';
import { lookupHash } from '../utils/lookupHash.js';
import { areaDiscrepancy, evidenceMessage, locationConfirmation, limitationsFor } from './evidence.service.js';

const same = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();

// verificationStatus: 'verified' only when a field review exists; a satellite signal alone is never "verified".
function statusFor(evidenceStatus) {
  if (evidenceStatus === 'field_verified') return 'verified';
  if (evidenceStatus === 'needs_review') return 'review_required';
  return 'record_found';
}

export async function verifyFarmer(query, apiKey, vlog) {
  let filter;
  if (query.farmaslogId) {
    const id = query.farmaslogId.toUpperCase();
    vlog.lookupType = 'farmaslogId';
    vlog.lookupHash = lookupHash('farmaslogId', id);
    filter = { farmaslogId: id };
  } else {
    const phone = normalizeNigerianPhone(query.phone);
    if (!phone) throw new AppError(400, 'INVALID_PHONE', 'phone must be a valid Nigerian mobile number.');
    vlog.lookupType = 'phone';
    vlog.lookupHash = lookupHash('phone', phone);
    filter = { phoneNormalized: phone };
  }
  // Only approved records are verifiable; pending/duplicate/rejected records are invisible to partners.
  const farmer = await Farmer.findOne({ ...filter, status: 'active' }).lean();
  if (!farmer || (query.state && !same(farmer.state, query.state)) || (query.lga && !same(farmer.lga, query.lga))) {
    vlog.result = 'not_found';
    throw new AppError(404, 'RECORD_NOT_FOUND', 'No matching record is available to this account.');
  }
  const farm = await Farm.findOne({ farmerId: farmer._id }).lean();
  const evidenceStatus = farm?.evidence?.status ?? 'pending';
  vlog.result = 'found';

  const canSeeCoords = env.verifyIncludeCoordinates && apiKey.scopes.includes(SCOPES.COORDINATES);
  const loc = farm?.location;
  return {
    verificationStatus: statusFor(evidenceStatus),
    farmaslogId: farmer.farmaslogId,
    location: {
      state: farmer.state, lga: farmer.lga, ward: farmer.ward ?? null, community: farmer.community ?? null,
      ...(canSeeCoords && loc ? { coordinates: { lat: loc.lat, lng: loc.lng, source: loc.source, accuracyMeters: loc.accuracyMeters ?? null, collectedAt: loc.collectedAt } } : {}),
    },
    crop: farm?.crop ?? null,
    reportedArea: farm?.reportedArea?.value ? { value: farm.reportedArea.value, unit: farm.reportedArea.unit } : null,
    estimatedArea: farm?.estimatedArea?.value
      ? { value: farm.estimatedArea.value, unit: farm.estimatedArea.unit, method: farm.estimatedArea.method ?? null, assessedAt: farm.estimatedArea.assessedAt ?? null }
      : null,
    areaDiscrepancy: farm ? areaDiscrepancy(farm) : null,
    evidenceStatus,
    evidenceMessage: evidenceMessage(evidenceStatus, farm),
    locationConfirmation: locationConfirmation(loc),
    limitations: limitationsFor(farm),
    enrichmentState: farm?.enrichment?.state ?? 'not_assessed',
    confidence: farm?.evidence?.confidence ?? null,
    lastUpdated: new Date(Math.max(farmer.updatedAt, farm?.updatedAt ?? 0)).toISOString(),
    ...(farmer.isSynthetic ? { synthetic: true } : {}),
  };
}
