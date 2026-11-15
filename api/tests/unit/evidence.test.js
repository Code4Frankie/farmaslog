import { assessEvidence, evidenceMessage, isLocationStrong, areaDiscrepancy, locationConfirmation, limitationsFor } from '../../src/services/evidence.service.js';

const gps = { lat: 7.1, lng: 9.0, source: 'gps_field_agent', accuracyMeters: 10 };
const base = (over = {}) => ({ reportedArea: { value: 2 }, location: gps, enrichment: { state: 'not_assessed' }, ...over });
const sat = (ndvi) => ({ state: 'completed', satellite: { ndvi } });

test('plain registration is self_reported', () => expect(assessEvidence(base()).status).toBe('self_reported'));
test('missing location is noted', () => expect(assessEvidence(base({ location: undefined })).reasons).toContain('no_location'));
test('pending enrichment -> pending', () => expect(assessEvidence(base({ enrichment: { state: 'pending' } })).status).toBe('pending'));
test('insufficient imagery stays self_reported with a reason', () => {
  const r = assessEvidence(base({ enrichment: { state: 'insufficient_imagery' } }));
  expect(r.status).toBe('self_reported');
  expect(r.reasons).toContain('enrichment_insufficient_imagery');
});

describe('satellite', () => {
  test('NDVI above threshold on a strong location -> satellite_signal', () => {
    const r = assessEvidence(base({ enrichment: sat(0.5) }));
    expect(r.status).toBe('satellite_signal');
    expect(evidenceMessage(r.status)).toMatch(/not proof of ownership/);
  });
  test('NDVI never yields field_verified', () => expect(assessEvidence(base({ enrichment: sat(0.95) })).status).not.toBe('field_verified'));
  test('low NDVI -> needs_review', () => expect(assessEvidence(base({ enrichment: sat(0.1) })).status).toBe('needs_review'));
  test('town-centre coordinate cannot support a signal', () => {
    const r = assessEvidence(base({ location: { ...gps, source: 'town_centre' }, enrichment: sat(0.8) }));
    expect(r.status).toBe('self_reported'); // set aside, not pushed into review
    expect(r.reasons).toContain('satellite_result_not_applied_location_unconfirmed');
  });
  test('coordinates typed by the farmer stay weak until a field agent confirms them', () => {
    const r = assessEvidence(base({ location: { lat: 7.1, lng: 9.0, source: 'farmer_reported' }, enrichment: sat(0.8) }));
    expect(r.status).toBe('self_reported'); // set aside, not pushed into review
    expect(r.reasons).toContain('satellite_result_not_applied_location_unconfirmed');
    expect(isLocationStrong({ lat: 7.1, lng: 9.0, source: 'farmer_reported' })).toBe(false);
  });
  test('coarse GPS fix cannot support a signal', () => {
    expect(assessEvidence(base({ location: { ...gps, accuracyMeters: 500 }, enrichment: sat(0.8) })).status).toBe('self_reported');
  });
  test('large area discrepancy -> needs_review', () => {
    expect(assessEvidence(base({ estimatedArea: { value: 6 }, enrichment: sat(0.6) })).reasons).toContain('area_discrepancy');
  });
});

describe('field verification', () => {
  const t0 = new Date('2026-10-01T10:00:00Z');
  const t1 = new Date('2026-10-02T10:00:00Z');
  test('verified', () => {
    const farm = base({ fieldVerification: { outcome: 'verified', verifiedAt: t1 }, evidenceInputsUpdatedAt: t0 });
    const r = assessEvidence(farm);
    expect(r.status).toBe('field_verified');
    expect(evidenceMessage(r.status, farm)).toBe('Field review completed on 2026-10-02 by authorized agent.');
  });
  test('edits after verification make it stale', () => {
    expect(assessEvidence(base({ fieldVerification: { outcome: 'verified', verifiedAt: t0 }, evidenceInputsUpdatedAt: t1 })).status).toBe('needs_review');
  });
  test('not confirmed -> needs_review', () => expect(assessEvidence(base({ fieldVerification: { outcome: 'rejected', verifiedAt: t1 } })).status).toBe('needs_review'));
});

test('helpers', () => {
  expect(isLocationStrong(gps)).toBe(true);
  expect(isLocationStrong({ ...gps, source: 'geocoded' })).toBe(false);
  expect(isLocationStrong(undefined)).toBe(false);
  expect(areaDiscrepancy({ reportedArea: { value: 2 } })).toBeNull();
  expect(areaDiscrepancy({ reportedArea: { value: 2 }, estimatedArea: { value: 2.2 } })).toBe(false);
});

describe('records stay usable without agent-confirmed GPS', () => {
  test('location confirmation levels', () => {
    expect(locationConfirmation(undefined)).toBe('not_provided');
    expect(locationConfirmation({})).toBe('not_provided');
    expect(locationConfirmation({ lat: 7.1, lng: 9, source: 'farmer_reported' })).toBe('unconfirmed');
    expect(locationConfirmation({ lat: 7.1, lng: 9, source: 'geocoded' })).toBe('unconfirmed');
    expect(locationConfirmation({ lat: 7.1, lng: 9, source: 'gps_field_agent', accuracyMeters: 400 })).toBe('unconfirmed');
    expect(locationConfirmation(gps)).toBe('confirmed_by_field_agent');
  });
  test('limitations tell the partner what is not independently established', () => {
    expect(limitationsFor({})).toEqual(['location_not_confirmed_by_field_agent', 'area_self_reported']);
    expect(limitationsFor({ location: gps })).toEqual(['area_self_reported']);
    expect(limitationsFor({ location: gps, estimatedArea: { value: 2 } })).toEqual([]);
  });
  test('no GPS and unconfirmed GPS both yield a plain self_reported record, never needs_review', () => {
    expect(assessEvidence(base({ location: undefined })).status).toBe('self_reported');
    expect(assessEvidence(base({ location: { lat: 7.1, lng: 9, source: 'farmer_reported' } })).status).toBe('self_reported');
  });
});
