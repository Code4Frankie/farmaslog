import fs from 'node:fs';
import { mapWebformRow, missingColumns, ACRES_TO_HA, WEBFORM_COLUMNS, DEFAULT_CONSENT_VERSION } from '../../src/services/webform.adapter.js';
import { readObjects, toCsv, parseCsv } from '../../src/utils/csv.js';
import { registerFarmerSchema } from '../../src/validators/index.js';
import { matchLga, matchState, AREAS } from '../../src/data/ng-geo.js';

const { header, rows } = readObjects(fs.readFileSync(new URL('../fixtures/webform_sample.csv', import.meta.url), 'utf8'));
const byName = (last) => mapWebformRow(rows.find((r) => r.lastName === last));
const good = { farmerId: 'FB-BE-1', registrationDate: '2026-10-20T10:15:00+01:00', firstName: 'A', lastName: 'B', phoneNumber: '08000000031', stateName: 'Benue', lgaName: 'Vandeikya', wardOrCommunity: 'Ihugh', primaryCrop: 'cassava', reportedAreaValue: '1', reportedAreaUnit: 'hectares', latitude: '', longitude: '', consentStatus: 'given', verificationStatus: 'pending' };

test('fixture has the website column layout', () => {
  expect(header).toEqual(WEBFORM_COLUMNS);
  expect(missingColumns(header)).toEqual([]);
  expect(missingColumns(['name', 'phone'])).toContain('farmerId');
});

describe('whole fixture', () => {
  const results = rows.map((r) => mapWebformRow(r));
  test('10 importable, 5 rejected', () => {
    expect(results.filter((r) => r.ok)).toHaveLength(10);
    expect(results.filter((r) => !r.ok)).toHaveLength(5);
  });
  test('every importable row passes the API registration schema', () => {
    for (const r of results.filter((x) => x.ok)) {
      const { error } = registerFarmerSchema.validate(r.value, { abortEarly: false, stripUnknown: true });
      expect(error).toBeUndefined();
    }
  });
  test('rejection reasons', () => {
    const reasons = results.filter((r) => !r.ok).flatMap((r) => r.errors).sort();
    expect(reasons).toEqual(['CONSENT_NOT_GIVEN', 'INVALID_AREA', 'INVALID_PHONE', 'MISSING_firstName', 'UNKNOWN_LGA']);
  });
});

describe('field mapping', () => {
  test('name joined, phone normalised, acres converted to hectares, community kept', () => {
    const r = byName('Farmer One');
    expect(r.value).toMatchObject({ name: 'Test Farmer One', phone: '+2348000000011', state: 'Benue', lga: 'Vandeikya', community: 'Ihugh', programmeRequested: 'Seed' });
    expect(r.value.farm.reportedAreaHa).toBe(Math.round(2 * ACRES_TO_HA * 100) / 100); // 0.81
    expect(r.value.farm.crop).toBe('White Yam');
  });
  test('record keeps its web identity for idempotent re-import, and the limited consent scope', () => {
    const r = byName('Farmer One');
    expect(r.value.sourceRef).toMatch(/^webform:FB-BE-/);
    expect(r.value).toMatchObject({ source: 'self_registration', sourceChannel: 'web_form', consent: { given: true, wordingVersion: DEFAULT_CONSENT_VERSION } });
    expect(r.value.consent.purpose).toMatch(/government agricultural programmes/);
    expect(r.value.submittedAt).toBe('2026-10-20T09:15:00.000Z');
  });
  test('typed coordinates are kept but marked farmer_reported (weak evidence)', () => {
    expect(byName('Farmer One').value.farm.location).toEqual({ lat: 7.05, lng: 9, source: 'farmer_reported' });
  });
  test('+234 with spaces works; hectares are not converted', () => {
    const r = byName('Farmer Two');
    expect(r.value.phone).toBe('+2348000000012');
    expect(r.value.farm.reportedAreaHa).toBe(1.5);
  });
  test('LGA typo is corrected with a warning; spacing variants match', () => {
    expect(byName('Farmer Three').value.lga).toBe('Vandeikya');
    expect(byName('Farmer Three').warnings.join()).toMatch(/lga_corrected:Vandekya->Vandeikya/);
    expect(byName('Farmer Four').value.lga).toBe('Katsina-Ala');
  });
  test('bad or partial coordinates are dropped, not fatal', () => {
    for (const last of ['Farmer Nine', 'Farmer Fifteen']) {
      const r = byName(last);
      expect(r.ok).toBe(true);
      expect(r.value.farm.location).toBeUndefined();
      expect(r.warnings.join()).toMatch(/coordinates_/);
    }
  });
  test('formula characters are stripped from names', () => {
    const r = byName('Eleven');
    expect(r.value.name).not.toMatch(/^[=+\-@]/);
    expect(r.warnings).toContain('name_had_formula_characters_removed');
  });
  test('any state works: an LGA in another state is validated against the national list', () => {
    const r = byName('Farmer Twelve');
    expect(r.value).toMatchObject({ state: 'Plateau', lga: 'Jos North' });
    expect(r.warnings).not.toContain('lga_not_validated');
  });
  test('other states: typos are corrected, unknown LGAs are rejected', () => {
    expect(mapWebformRow({ ...good, stateName: 'lagos', lgaName: 'Ikejaa' }).value).toMatchObject({ state: 'Lagos', lga: 'Ikeja' });
    expect(mapWebformRow({ ...good, stateName: 'Kano', lgaName: 'Springfield' }).errors).toContain('UNKNOWN_LGA');
    expect(mapWebformRow({ ...good, stateName: 'Nasarawa', lgaName: 'Awee', wardOrCommunity: 'Agwatashi' }).value).toMatchObject({ state: 'Nasarawa', lga: 'Awe' });
  });
  test('unusually large area is a warning', () => expect(byName('Farmer Fourteen').warnings).toContain('area_unusually_large_for_smallholder'));
});

describe('edge cases', () => {
  test('consent must be exactly given', () => {
    expect(mapWebformRow({ ...good }).ok).toBe(true);
    expect(mapWebformRow({ ...good, consentStatus: 'pending' }).errors).toContain('CONSENT_NOT_GIVEN');
  });
  test('area handling', () => {
    expect(mapWebformRow({ ...good, reportedAreaValue: '1,200', reportedAreaUnit: 'ha' }).value.farm.reportedAreaHa).toBe(1200);
    expect(mapWebformRow({ ...good, reportedAreaValue: '-3' }).errors).toContain('INVALID_AREA');
    expect(mapWebformRow({ ...good, reportedAreaValue: 'abc' }).errors).toContain('INVALID_AREA');
    expect(mapWebformRow({ ...good, reportedAreaValue: '0.01', reportedAreaUnit: 'acres' }).errors).toContain('INVALID_AREA'); // rounds to 0 ha
    expect(mapWebformRow({ ...good, reportedAreaUnit: 'plots' }).errors).toContain('INVALID_AREA_UNIT');
  });
  test('missing identity / unknown state', () => {
    expect(mapWebformRow({ ...good, farmerId: '' }).errors).toContain('MISSING_farmerId');
    expect(mapWebformRow({ ...good, stateName: 'Narnia' }).errors).toContain('UNKNOWN_STATE');
    expect(mapWebformRow({ ...good, stateName: 'BENUE STATE' }).value.state).toBe('Benue');
  });
  test('an apostrophe added by our rejects-file writer is tolerated on re-import', () => {
    expect(mapWebformRow({ ...good, phoneNumber: "'+234 800 000 0031" }).value.phone).toBe('+2348000000031');
  });
});

describe('reference data and csv helpers', () => {
  test('Benue has 23 LGAs; ties are not auto-corrected', () => {
    expect(AREAS.Benue).toHaveLength(23);
    expect(matchLga('Benue', 'gwer')).toBeNull();
    expect(matchLga('Benue', 'Makurdi.')).toMatchObject({ name: 'Makurdi' });
    expect(matchState('Benu')).toMatchObject({ name: 'Benue', corrected: true });
    expect(matchState('Federal Capital Territory').name).toBe('FCT');
  });
  test('csv round trip, quotes, newlines and BOM', () => {
    const rows2 = [['a', 'b'], ['x,y', 'say "hi"'], ['line1\nline2', '']];
    expect(parseCsv('\uFEFF' + toCsv(rows2))).toEqual([['a', 'b'], ['x,y', 'say "hi"'], ['line1\nline2', '']].map((r) => r));
  });
  test('writer defuses formulas by default, but can write verbatim', () => {
    expect(toCsv([['=1+1']])).toBe("'=1+1\n");
    expect(toCsv([['=1+1']], { neutralise: false })).toBe('=1+1\n');
  });
});
