// Normalizes Nigerian mobile numbers to E.164 (+234XXXXXXXXXX). Returns null if invalid.
// Accepts: 08012345678, 8012345678, +2348012345678, 234 801 234 5678, and a "+" that a query
// string decoded into a space.
export function normalizeNigerianPhone(input) {
  if (typeof input !== 'string' && typeof input !== 'number') return null;
  let d = String(input).replace(/[\s\-().]/g, '');
  if (d.startsWith('+')) d = d.slice(1);
  if (!/^\d+$/.test(d)) return null;
  if (d.startsWith('234')) d = d.slice(3);
  if (d.startsWith('0')) d = d.slice(1);
  if (!/^[789][01]\d{8}$/.test(d)) return null;
  return `+234${d}`;
}
