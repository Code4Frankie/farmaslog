// Imports the CSV exported from the farmaslog-qservers registration form.
//
//   node scripts/import-webform.js <export.csv> --dry-run             (map and validate only; no database needed)
//   node scripts/import-webform.js <export.csv>                       (import; records land as pending_review)
//   options: --consent-version=qservers-form-v1   --rejects=<path>
//
// Safe to re-run on a cumulative export: rows already imported (same farmerId) are skipped.
// Nothing is approved here. A data manager reviews records via the API before partners can verify them.
import fs from 'node:fs';
import { env } from '../src/config/env.js';
import { readObjects, toCsv } from '../src/utils/csv.js';
import { mapWebformRow, missingColumns, DEFAULT_CONSENT_VERSION } from '../src/services/webform.adapter.js';
import { registerFarmerSchema } from '../src/validators/index.js';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const flag = (n) => args.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const dry = args.includes('--dry-run');
const consentVersion = flag('consent-version') || DEFAULT_CONSENT_VERSION;
if (!file) { console.error('Usage: node scripts/import-webform.js <export.csv> [--dry-run] [--consent-version=...] [--rejects=path]'); process.exit(1); }

const { header, rows } = readObjects(fs.readFileSync(file, 'utf8'));
const missing = missingColumns(header);
if (missing.length) { console.error(`This does not look like a farmaslog web form export. Missing columns: ${missing.join(', ')}`); process.exit(1); }

let registerFarmer, disconnectDb;
if (!dry) {
  const db = await import('../src/config/db.js');
  ({ registerFarmer } = await import('../src/services/farmer.service.js'));
  disconnectDb = db.disconnectDb;
  await db.connectDb(env.mongoUri);
}

const stats = { total: rows.length, imported: 0, alreadyImported: 0, flaggedDuplicate: 0, rejected: 0, rowsWithWarnings: 0 };
const warningCounts = {};
const rejectCounts = {};
const rejects = [];
const ctx = { actor: null, requestId: 'import-webform' };

for (const [i, row] of rows.entries()) {
  const mapped = mapWebformRow(row, { consentVersion });
  mapped.warnings.forEach((w) => { const k = w.split(':')[0]; warningCounts[k] = (warningCounts[k] || 0) + 1; });
  if (mapped.warnings.length) stats.rowsWithWarnings++;
  const reject = (reasons) => {
    stats.rejected++;
    reasons.forEach((r) => { rejectCounts[r] = (rejectCounts[r] || 0) + 1; });
    rejects.push([i + 2, ...header.map((h) => row[h]), reasons.join('; ')]);
  };
  if (!mapped.ok) { reject(mapped.errors); continue; }
  const { error, value } = registerFarmerSchema.validate(mapped.value, { abortEarly: false, stripUnknown: true });
  if (error) { reject(error.details.map((d) => `SCHEMA:${d.message.replace(/"/g, "'")}`)); continue; }
  if (dry) { stats.imported++; continue; }
  try {
    const r = await registerFarmer(value, ctx);
    if (r.alreadyImported) stats.alreadyImported++;
    else { stats.imported++; if (r.isDuplicate) stats.flaggedDuplicate++; }
  } catch (e) { reject([`ERROR:${e.errorCode || e.message}`]); }
}

if (rejects.length) {
  const out = flag('rejects') || file.replace(/\.csv$/i, '') + '.rejects.csv';
  fs.writeFileSync(out, toCsv([[ 'sourceRow', ...header, 'reasons' ], ...rejects]));
  console.log(`Rejected rows written to ${out} (fix and re-import; already-imported rows are skipped)`);
}
console.log(dry ? '\nDRY RUN: nothing written' : '\nImport complete');
console.table(stats);
if (Object.keys(rejectCounts).length) { console.log('Reject reasons:'); console.table(rejectCounts); }
if (Object.keys(warningCounts).length) { console.log('Warnings:'); console.table(warningCounts); }
if (!dry) await disconnectDb();
