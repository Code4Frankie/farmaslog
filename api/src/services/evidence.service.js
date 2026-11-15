import { env } from '../config/env.js';

// Evidence rules from PRD section 8. Pure functions, no DB access, so they are easy to test.
// 'farmer_reported' = coordinates typed into the web form: no accuracy, no proof the farmer was at the farm.
// They stay weak until a field agent confirms the location with GPS (source 'gps_field_agent').
const WEAK_LOCATION_SOURCES = new Set(['geocoded', 'town_centre', 'farmer_reported']);
const MAX_ACCURACY_M = 100;

export const EVIDENCE_MESSAGES = {
  pending: 'Verification in progress.',
  self_reported: 'Details submitted; independent evidence not yet available.',
  satellite_signal: 'Satellite signal detected; not proof of ownership or eligibility.',
  needs_review: 'Additional review required.',
};
export function evidenceMessage(status, farm) {
  if (status === 'field_verified') {
    const d = farm?.fieldVerification?.verifiedAt ? new Date(farm.fieldVerification.verifiedAt).toISOString().slice(0, 10) : 'an unrecorded date';
    return `Field review completed on ${d} by authorized agent.`;
  }
  return EVIDENCE_MESSAGES[status] ?? EVIDENCE_MESSAGES.pending;
}

// A town-centre / geocoded coordinate or a coarse GPS fix can never support a parcel-level claim.
export function isLocationStrong(loc) {
  return (
    !!loc && Number.isFinite(loc.lat) && Number.isFinite(loc.lng) &&
    !WEAK_LOCATION_SOURCES.has(loc.source) &&
    (loc.accuracyMeters == null || loc.accuracyMeters <= MAX_ACCURACY_M)
  );
}

// Partners can use a record whether or not a field agent has confirmed the GPS. This tells them which it is.
//   confirmed_by_field_agent : GPS collected by a field agent, with usable accuracy
//   unconfirmed              : coordinates exist (typed by the farmer, geocoded, town centre, coarse fix) but no agent has confirmed them
//   not_provided             : no coordinates at all
export function locationConfirmation(loc) {
  if (!loc || !Number.isFinite(loc.lat) || !Number.isFinite(loc.lng)) return 'not_provided';
  return loc.source === 'gps_field_agent' && isLocationStrong(loc) ? 'confirmed_by_field_agent' : 'unconfirmed';
}
// Plain-language caveats a bank or programme can apply its own policy to.
export function limitationsFor(farm) {
  const l = [];
  if (locationConfirmation(farm?.location) !== 'confirmed_by_field_agent') l.push('location_not_confirmed_by_field_agent');
  if (!(farm?.estimatedArea?.value > 0)) l.push('area_self_reported');
  return l;
}

// true / false when both areas exist, null when it cannot be compared.
export function areaDiscrepancy(farm) {
  const rep = farm?.reportedArea?.value;
  const est = farm?.estimatedArea?.value;
  if (!(rep > 0) || !(est > 0)) return null;
  return Math.abs(est - rep) / rep > env.areaTolerance;
}

export function assessEvidence(farm, now = new Date()) {
  const fv = farm?.fieldVerification;
  const enr = farm?.enrichment ?? { state: 'not_assessed' };
  const sat = enr.satellite;
  const loc = farm?.location;
  const discrepancy = areaDiscrepancy(farm);
  const out = (status, confidence, reasons = []) => ({ status, confidence, reasons, assessedAt: now });

  if (fv?.outcome === 'verified') {
    const stale = farm.evidenceInputsUpdatedAt && fv.verifiedAt && new Date(fv.verifiedAt) < new Date(farm.evidenceInputsUpdatedAt);
    if (stale) return out('needs_review', 0.3, ['record_changed_after_field_verification']);
    return out('field_verified', 0.9, discrepancy ? ['area_discrepancy_flagged'] : []);
  }
  if (fv?.outcome === 'rejected') return out('needs_review', 0.2, ['field_review_not_confirmed']);
  if (enr.state === 'pending') return out('pending', 0.1, []);

  if (enr.state === 'completed' && sat && Number.isFinite(sat.ndvi)) {
    // An unconfirmed location is ABSENT evidence, not conflicting evidence: set the satellite result aside and keep the
    // record usable as self_reported, rather than pushing it into review.
    if (!isLocationStrong(loc)) return out('self_reported', 0.2, ['satellite_result_not_applied_location_unconfirmed']);
    if (sat.ndvi < env.ndviThreshold) return out('needs_review', 0.3, ['low_vegetation_signal']);
    if (discrepancy) return out('needs_review', 0.35, ['area_discrepancy']);
    // NDVI is a vegetation signal only, never proof of a farm or of ownership.
    return out('satellite_signal', loc.accuracyMeters != null && loc.accuracyMeters <= 30 ? 0.6 : 0.5, []);
  }

  const reasons = [];
  if (!loc) reasons.push('no_location');
  if (enr.state && enr.state !== 'not_assessed') reasons.push(`enrichment_${enr.state}`);
  if (enr.reason) reasons.push(enr.reason);
  return out('self_reported', 0.2, reasons);
}
