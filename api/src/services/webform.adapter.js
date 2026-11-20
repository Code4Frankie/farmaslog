import { normalizeNigerianPhone } from '../utils/phone.js';
import { titleCase } from '../utils/text.js';
import { matchState, matchLga, lgasFor } from '../data/ng-geo.js';
import { NIGERIA_BBOX as B } from '../config/constants.js';

// Maps one row of the farmaslog-qservers CSV export to the API's registration shape.
// Pure function (no DB): returns { ok, value, errors[], warnings[] }.

export const WEBFORM_COLUMNS = [
  'farmerId', 'farmId', 'registrationDate', 'firstName', 'lastName', 'phoneNumber', 'stateName', 'lgaName', 'wardOrCommunity',
  'primaryCrop', 'reportedAreaValue', 'reportedAreaUnit', 'latitude', 'longitude', 'programmeRequested', 'consentStatus', 'verificationStatus',
];
export const REQUIRED_COLUMNS = WEBFORM_COLUMNS.filter((c) => !['farmId', 'programmeRequested', 'verificationStatus'].includes(c));

// Version label stored with each consent. It MUST be bumped whenever the checkbox text on the form changes.
export const DEFAULT_CONSENT_VERSION = 'qservers-form-v1';
// What the original form's checkbox actually covers. It does NOT cover sharing with banks/insurers or satellite analysis.
export const WEBFORM_CONSENT_PURPOSE = 'Registration and eligibility assessment for government agricultural programmes (original web form wording)';

export const ACRES_TO_HA = 0.40468564224;
// A leading apostrophe may have been added by our own rejects-file writer to defuse formulas; it is not part of the data.
const FORMULA_START = /^'?[=+\-@\t\r]+/;

const clean = (v, max = 200) => String(v ?? '').replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
// Free text that may later be opened in a spreadsheet: strip leading formula characters.
const safeText = (v, max) => clean(v, max).replace(FORMULA_START, '').trim();
const inNigeria = (lat, lng) => lat >= B.latMin && lat <= B.latMax && lng >= B.lngMin && lng <= B.lngMax;

export function mapWebformRow(row, { consentVersion = DEFAULT_CONSENT_VERSION } = {}) {
  const errors = [];
  const warnings = [];

  const farmerId = clean(row.farmerId, 100);
  if (!farmerId) errors.push('MISSING_farmerId');

  const first = safeText(row.firstName, 80);
  const last = safeText(row.lastName, 80);
  if (!first) errors.push('MISSING_firstName');
  if (!last) errors.push('MISSING_lastName');
  if (clean(row.firstName) !== first || clean(row.lastName) !== last) warnings.push('name_had_formula_characters_removed');
  const name = `${first} ${last}`.trim();

  const phone = normalizeNigerianPhone(clean(row.phoneNumber, 30).replace(/^'/, ''));
  if (!phone) errors.push('INVALID_PHONE');

  const st = matchState(row.stateName);
  let state = st?.name;
  if (!st) errors.push('UNKNOWN_STATE');
  else if (st.corrected) warnings.push(`state_corrected:${clean(row.stateName)}->${st.name}`);

  let lga = safeText(row.lgaName, 80);
  if (!lga) errors.push('MISSING_lgaName');
  else if (state && lgasFor(state)) {
    const m = matchLga(state, lga);
    if (!m) errors.push('UNKNOWN_LGA');
    else { if (m.corrected) warnings.push(`lga_corrected:${lga}->${m.name}`); lga = m.name; }
  } else if (state) warnings.push('lga_not_validated');

  const community = safeText(row.wardOrCommunity, 120);
  if (!community) errors.push('MISSING_wardOrCommunity');

  const crop = titleCase(safeText(row.primaryCrop, 80));
  if (!crop) errors.push('MISSING_primaryCrop');

  // Area is always stored in hectares.
  const rawArea = Number(String(row.reportedAreaValue ?? '').replace(/,/g, '').trim());
  const unit = clean(row.reportedAreaUnit, 20).toLowerCase();
  let reportedAreaHa;
  if (!Number.isFinite(rawArea) || rawArea <= 0) errors.push('INVALID_AREA');
  else if (['acre', 'acres', 'ac'].includes(unit)) reportedAreaHa = rawArea * ACRES_TO_HA;
  else if (['hectare', 'hectares', 'ha'].includes(unit)) reportedAreaHa = rawArea;
  else errors.push('INVALID_AREA_UNIT');
  if (reportedAreaHa !== undefined) {
    reportedAreaHa = Math.round(reportedAreaHa * 100) / 100;
    if (reportedAreaHa < 0.01) errors.push('INVALID_AREA');
    else if (reportedAreaHa > 20) warnings.push('area_unusually_large_for_smallholder');
  }

  // Coordinates are optional. Bad ones are dropped (with a warning) rather than rejecting the whole record.
  let location;
  const latS = clean(row.latitude, 40), lngS = clean(row.longitude, 40);
  if (latS || lngS) {
    const lat = Number(latS), lng = Number(lngS);
    if (!latS || !lngS || !Number.isFinite(lat) || !Number.isFinite(lng)) warnings.push('coordinates_incomplete_dropped');
    else if (!inNigeria(lat, lng)) warnings.push('coordinates_outside_nigeria_dropped');
    else location = { lat, lng, source: 'farmer_reported' }; // typed in by the farmer: weak until a field agent confirms
  }

  if (clean(row.consentStatus).toLowerCase() !== 'given') errors.push('CONSENT_NOT_GIVEN');
  if (clean(row.verificationStatus) && clean(row.verificationStatus).toLowerCase() !== 'pending') warnings.push('verificationStatus_ignored');

  let submittedAt;
  const when = clean(row.registrationDate, 40);
  if (when) { const d = new Date(when); if (Number.isNaN(d.getTime())) warnings.push('registrationDate_invalid_ignored'); else submittedAt = d.toISOString(); }

  if (errors.length) return { ok: false, errors, warnings };
  return {
    ok: true, errors, warnings,
    value: {
      name, phone, state, lga, community,
      consent: { given: true, wordingVersion: consentVersion, purpose: WEBFORM_CONSENT_PURPOSE },
      source: 'self_registration', sourceChannel: 'web_form', sourceRef: `webform:${farmerId}`, submittedAt,
      programmeRequested: safeText(row.programmeRequested, 80) || undefined,
      farm: { crop, reportedAreaHa, ...(location ? { location } : {}) },
    },
  };
}

export function missingColumns(header) {
  return REQUIRED_COLUMNS.filter((c) => !header.includes(c));
}
