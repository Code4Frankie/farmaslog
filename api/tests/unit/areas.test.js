import fs from 'node:fs';
import { AREAS, STATES, matchState, matchLga, canonicalArea, lgasFor } from '../../src/data/ng-geo.js';

// Official number of LGAs per state (774 in total). If the data file is ever edited wrongly, this fails.
const OFFICIAL = {
  Abia: 17, Adamawa: 21, 'Akwa Ibom': 31, Anambra: 21, Bauchi: 20, Bayelsa: 8, Benue: 23, Borno: 27, 'Cross River': 18, Delta: 25,
  Ebonyi: 13, Edo: 18, Ekiti: 16, Enugu: 17, FCT: 6, Gombe: 11, Imo: 27, Jigawa: 27, Kaduna: 23, Kano: 44, Katsina: 34, Kebbi: 21,
  Kogi: 21, Kwara: 16, Lagos: 20, Nasarawa: 13, Niger: 25, Ogun: 20, Ondo: 18, Osun: 30, Oyo: 33, Plateau: 17, Rivers: 23,
  Sokoto: 23, Taraba: 16, Yobe: 17, Zamfara: 14,
};

test('reference data: 37 areas, official LGA counts, 774 in total', () => {
  expect(STATES.sort()).toEqual(Object.keys(OFFICIAL).sort());
  for (const [s, n] of Object.entries(OFFICIAL)) expect({ s, n: AREAS[s].length }).toEqual({ s, n });
  expect(Object.values(AREAS).flat()).toHaveLength(774);
  for (const list of Object.values(AREAS)) expect(new Set(list.map((x) => x.toLowerCase())).size).toBe(list.length);
});

test('the website copy of the data is identical', () => {
  const web = new URL('../../../web/areas.json', import.meta.url);
  if (!fs.existsSync(web)) return; // api used on its own, without the web folder
  expect(JSON.parse(fs.readFileSync(web, 'utf8')).states).toEqual(AREAS);
});

test('matching works for any state', () => {
  expect(matchState('KANO state')).toMatchObject({ name: 'Kano', corrected: false });
  expect(matchState('Federal Capital Territory').name).toBe('FCT');
  expect(matchState('Akwa-Ibom').name).toBe('Akwa Ibom');
  expect(matchState('Atlantis')).toBeNull();
  expect(lgasFor('Atlantis')).toBeNull();
  for (const [s, l] of [['Kano', 'gwale'], ['Lagos', 'IKEJA'], ['Nasarawa', 'awe'], ['Plateau', 'jos north'], ['Benue', 'Katsina Ala']]) {
    expect(matchLga(s, l, { maxDistance: 0 })).toBeTruthy();
  }
});

test('staff-entered areas are tidied when they match, kept as typed when they do not, never rejected', () => {
  expect(canonicalArea('nasarawa', 'AWE')).toEqual({ state: 'Nasarawa', lga: 'Awe', warnings: [] });
  expect(canonicalArea('Kano', 'Atlantis')).toEqual({ state: 'Kano', lga: 'Atlantis', warnings: ['lga_not_in_reference_list'] });
  expect(canonicalArea('Narnia', 'Cair Paravel')).toEqual({ state: 'Narnia', lga: 'Cair Paravel', warnings: ['state_not_in_reference_list'] });
  expect(canonicalArea('Awee', 'x').warnings).toContain('state_not_in_reference_list'); // no silent typo-fixing for staff input
});
