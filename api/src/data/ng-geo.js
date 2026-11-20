import fs from 'node:fs';
import { editDistance } from '../utils/text.js';

// Any Nigerian state and LGA (36 states + FCT, 774 LGAs) from ng-areas.json. Nothing is tied to one pilot area:
// the pilot area is simply whatever the data says. To correct or extend the list, edit the JSON (and web/areas.json).
const data = JSON.parse(fs.readFileSync(new URL('./ng-areas.json', import.meta.url), 'utf8'));
export const AREAS = data.states; // { "Nasarawa": ["Akwanga", "Awe", ...], ... }
export const STATES = Object.keys(AREAS);
export const lgasFor = (state) => AREAS[state] ?? null;

const norm = (s) => String(s ?? '').toLowerCase().replace(/\bstate\b/g, '').replace(/[^a-z]/g, '');
const ALIASES = { federalcapitalterritory: 'FCT', abuja: 'FCT' };

// Exact (after normalising case, spaces and punctuation), or with maxDistance 1 one typo away.
// A typo is only corrected when exactly one name is that close; ties are treated as no match.
function match(input, list, maxDistance) {
  const n = norm(input);
  if (!n) return null;
  if (ALIASES[n] && list.includes(ALIASES[n])) return { name: ALIASES[n], corrected: false };
  const scored = list.map((name) => ({ name, d: editDistance(n, norm(name)) })).sort((a, b) => a.d - b.d);
  const best = scored[0];
  if (best.d === 0) return { name: best.name, corrected: false };
  if (maxDistance >= 1 && best.d === 1 && (scored[1]?.d ?? 99) > 1) return { name: best.name, corrected: true };
  return null;
}
export const matchState = (input, { maxDistance = 1 } = {}) => match(input, STATES, maxDistance);
export const matchLga = (state, input, { maxDistance = 1 } = {}) => (AREAS[state] ? match(input, AREAS[state], maxDistance) : null);

// For staff-entered data: tidy case/spelling of names that exactly match the list, keep anything else as typed,
// and say so. (No silent typo-fixing here: that is only done for bulk imports, which report every correction.)
export function canonicalArea(stateInput, lgaInput) {
  const s = matchState(stateInput, { maxDistance: 0 });
  const l = s ? matchLga(s.name, lgaInput, { maxDistance: 0 }) : null;
  const warnings = [];
  if (!s) warnings.push('state_not_in_reference_list');
  else if (!l) warnings.push('lga_not_in_reference_list');
  return { state: s?.name ?? String(stateInput ?? '').trim(), lga: l?.name ?? String(lgaInput ?? '').trim(), warnings };
}
