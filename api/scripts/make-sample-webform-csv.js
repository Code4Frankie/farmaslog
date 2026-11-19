// Writes tests/fixtures/webform_sample.csv: SYNTHETIC rows in the exact format submit.php produces,
// with deliberate data-quality problems. No real people. Run: npm run sample
import fs from 'node:fs';
import { toCsv } from '../src/utils/csv.js';
import { WEBFORM_COLUMNS } from '../src/services/webform.adapter.js';

const base = { registrationDate: '2026-10-20T10:15:00+01:00', stateName: 'Benue', lgaName: 'Vandeikya', wardOrCommunity: 'Ihugh', primaryCrop: 'white yam', reportedAreaUnit: 'acres', consentStatus: 'given', verificationStatus: 'pending', programmeRequested: '', latitude: '', longitude: '' };
let n = 0;
const r = (over) => { n++; return { farmerId: `FB-BE-20261020-1015${String(n).padStart(2, '0')}-T${String(n).padStart(5, '0')}`, farmId: `FARM-20261020-1015${String(n).padStart(2, '0')}-T${String(n).padStart(5, '0')}`, ...base, ...over }; };

const rows = [
  r({ firstName: 'Test', lastName: 'Farmer One', phoneNumber: '08000000011', reportedAreaValue: '2.00', latitude: '7.0500', longitude: '9.0000', programmeRequested: 'Seed' }), // clean, acres->ha, typed coordinates
  r({ firstName: 'Test', lastName: 'Farmer Two', phoneNumber: '+234 800 000 0012', reportedAreaValue: '1.5', reportedAreaUnit: 'hectares' }), // phone format, hectares
  r({ firstName: 'Test', lastName: 'Farmer Three', phoneNumber: '08000000013', lgaName: 'Vandekya', reportedAreaValue: '3' }), // LGA typo (auto-corrected)
  r({ firstName: 'Test', lastName: 'Farmer Four', phoneNumber: '08000000014', lgaName: 'Katsina Ala', wardOrCommunity: 'Tse-Agberagba', primaryCrop: 'SOYBEAN', reportedAreaValue: '4' }), // LGA spacing
  r({ firstName: 'Test', lastName: 'Farmer Five', phoneNumber: '08000000015', lgaName: 'Springfield', reportedAreaValue: '1' }), // REJECT unknown LGA
  r({ firstName: 'Test', lastName: 'Farmer Six', phoneNumber: '12345', reportedAreaValue: '1' }), // REJECT bad phone
  r({ firstName: 'Test', lastName: 'Farmer Seven', phoneNumber: '08000000017', reportedAreaValue: '0' }), // REJECT zero area
  r({ firstName: 'Test', lastName: 'Farmer Eight', phoneNumber: '08000000018', reportedAreaValue: '1', consentStatus: '' }), // REJECT no consent
  r({ firstName: 'Test', lastName: 'Farmer Nine', phoneNumber: '08000000019', reportedAreaValue: '2', latitude: '9.2', longitude: '33.1' }), // coordinates dropped (outside Nigeria)
  r({ firstName: 'Test', lastName: 'Farmer Ten', phoneNumber: '08000000011', reportedAreaValue: '1' }), // same phone as row 1 -> duplicate_review in the API
  r({ firstName: '=HYPERLINK("http://evil.example")', lastName: 'Eleven', phoneNumber: '08000000021', reportedAreaValue: '1' }), // formula characters stripped
  r({ firstName: 'Test', lastName: 'Farmer Twelve', phoneNumber: '08000000022', stateName: 'Plateau', lgaName: 'Jos North', wardOrCommunity: 'Jos', reportedAreaValue: '1' }), // other state: LGA not validated
  r({ firstName: '', lastName: 'Thirteen', phoneNumber: '08000000023', reportedAreaValue: '1' }), // REJECT missing first name
  r({ firstName: 'Test', lastName: 'Farmer Fourteen', phoneNumber: '08000000024', reportedAreaValue: '60', reportedAreaUnit: 'Hectares' }), // unusually large -> warning
  r({ firstName: 'Test', lastName: 'Farmer Fifteen', phoneNumber: '08000000025', reportedAreaValue: '2', latitude: '7.1' }), // only one coordinate -> dropped
];
fs.mkdirSync('tests/fixtures', { recursive: true });
fs.writeFileSync('tests/fixtures/webform_sample.csv', toCsv([WEBFORM_COLUMNS, ...rows.map((x) => WEBFORM_COLUMNS.map((c) => x[c] ?? ''))], { neutralise: false }));
console.log(`Wrote tests/fixtures/webform_sample.csv (${rows.length} rows)`);
