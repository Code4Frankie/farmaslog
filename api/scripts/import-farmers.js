// Usage: node scripts/import-farmers.js data/ihugh.csv [--dry-run] [--approve]
// CSV header: name,phone,state,lga,ward,community,crop,reportedAreaHa,lat,lng,locationSource,accuracyMeters,consentGiven,consentWording
// Rows without consentGiven=true are rejected. Duplicates go to review (never merged). Rejects are written next to the input.
import fs from 'node:fs';
import { parseCsv, toCsv } from '../src/utils/csv.js';
import { connectDb, disconnectDb } from '../src/config/db.js';
import { env } from '../src/config/env.js';
import { registerFarmerSchema } from '../src/validators/index.js';
import { registerFarmer, reviewFarmer } from '../src/services/farmer.service.js';

const [file] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const dry = process.argv.includes('--dry-run');
const approve = process.argv.includes('--approve');
if (!file) { console.error('Usage: node scripts/import-farmers.js <file.csv> [--dry-run] [--approve]'); process.exit(1); }

const [header, ...lines] = parseCsv(fs.readFileSync(file, 'utf8')).map((r) => r.map((x) => x.trim()));
const num = (v) => (v === '' || v === undefined ? undefined : Number(v));

const stats = { total: lines.length, imported: 0, duplicates: 0, approved: 0, rejected: 0 };
const rejects = [];
if (!dry) await connectDb(env.mongoUri);
const ctx = { actor: null, requestId: 'import' };

for (const [i, cells] of lines.entries()) {
  const r = Object.fromEntries(header.map((h, k) => [h, cells[k] ?? '']));
  const candidate = {
    name: r.name, phone: r.phone, state: r.state, lga: r.lga, ward: r.ward, community: r.community, source: 'import',
    consent: { given: String(r.consentGiven).toLowerCase() === 'true', wordingVersion: r.consentWording },
    farm: {
      crop: r.crop, reportedAreaHa: num(r.reportedAreaHa),
      ...(r.lat && r.lng ? { location: { lat: num(r.lat), lng: num(r.lng), source: r.locationSource || 'farmer_reported', accuracyMeters: num(r.accuracyMeters) } } : {}),
    },
  };
  const { error, value } = registerFarmerSchema.validate(candidate, { abortEarly: false, stripUnknown: true });
  if (error) { stats.rejected++; rejects.push([i + 2, ...cells, error.details.map((d) => d.message).join('; ')]); continue; }
  if (dry) { stats.imported++; continue; }
  try {
    const { farmer, isDuplicate } = await registerFarmer(value, ctx);
    stats.imported++;
    if (isDuplicate) stats.duplicates++;
    else if (approve) { await reviewFarmer(farmer, { decision: 'approve', note: 'bulk import approval' }, ctx); stats.approved++; }
  } catch (e) { stats.rejected++; rejects.push([i + 2, ...cells, e.message]); }
}
if (rejects.length) {
  const out = file.replace(/\.csv$/i, '') + '.rejects.csv';
  fs.writeFileSync(out, toCsv([['row', ...header, 'reason'], ...rejects]));
  console.log(`Rejected rows written to ${out}`);
}
console.log(dry ? 'DRY RUN (nothing written)' : 'Import complete', stats);
if (!dry) await disconnectDb();
