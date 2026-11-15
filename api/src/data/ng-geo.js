import { editDistance } from '../utils/text.js';

// Reference lists used to clean free-text state/LGA entries from the web form.
// Benue has 23 LGAs. Other states are not validated at LGA level during the pilot.
export const STATES = [
  'Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue', 'Borno', 'Cross River', 'Delta', 'Ebonyi', 'Edo',
  'Ekiti', 'Enugu', 'FCT', 'Gombe', 'Imo', 'Jigawa', 'Kaduna', 'Kano', 'Katsina', 'Kebbi', 'Kogi', 'Kwara', 'Lagos',
  'Nasarawa', 'Niger', 'Ogun', 'Ondo', 'Osun', 'Oyo', 'Plateau', 'Rivers', 'Sokoto', 'Taraba', 'Yobe', 'Zamfara',
];
export const BENUE_LGAS = [
  'Ado', 'Agatu', 'Apa', 'Buruku', 'Gboko', 'Guma', 'Gwer East', 'Gwer West', 'Katsina-Ala', 'Konshisha', 'Kwande', 'Logo',
  'Makurdi', 'Obi', 'Ogbadibo', 'Ohimini', 'Oju', 'Okpokwu', 'Otukpo', 'Tarka', 'Ukum', 'Ushongo', 'Vandeikya',
];

const norm = (s) => String(s ?? '').toLowerCase().replace(/\bstate\b/g, '').replace(/[^a-z]/g, '');
const ALIASES = { federalcapitalterritory: 'FCT', abuja: 'FCT' };

// Exact (after normalising) or one typo away. Ties between different names are treated as no match.
function match(input, list) {
  const n = norm(input);
  if (!n) return null;
  if (ALIASES[n] && list.includes(ALIASES[n])) return { name: ALIASES[n], corrected: false };
  const scored = list.map((name) => ({ name, d: editDistance(n, norm(name)) })).sort((a, b) => a.d - b.d);
  const best = scored[0];
  if (best.d === 0) return { name: best.name, corrected: false };
  if (best.d === 1 && scored[1].d > 1) return { name: best.name, corrected: true };
  return null;
}
export const matchState = (input) => match(input, STATES);
export const matchBenueLga = (input) => match(input, BENUE_LGAS);
