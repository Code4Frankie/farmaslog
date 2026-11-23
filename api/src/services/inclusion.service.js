import { Farmer } from '../models/Farmer.js';
import { INCLUSION, STATS_MIN_GROUP } from '../config/constants.js';

const DIMENSIONS = Object.keys(INCLUSION); // gender, ageBand, disability

// Counts of farmers by inclusion category, for reporting to funders. Only aggregate numbers leave this function.
// Groups smaller than STATS_MIN_GROUP are hidden (count: null, suppressed: true) so no individual can be singled out.
// Counted: records that are not rejected and whose consent is not withdrawn. Farmers who never answered are "not_recorded".
export async function inclusionStats({ state, lga, groupBy } = {}) {
  const match = { status: { $ne: 'rejected' }, consentStatus: { $ne: 'withdrawn' } };
  if (state) match.state = state;
  if (lga) match.lga = lga;

  const buckets = (dim) => ({ $ifNull: [`$inclusion.${dim}`, 'not_recorded'] });
  const facets = Object.fromEntries(DIMENSIONS.map((d) => [d, [{ $group: { _id: buckets(d), n: { $sum: 1 } } }]]));
  facets.total = [{ $count: 'n' }];
  if (groupBy) {
    facets.areas = [{ $group: { _id: { area: `$${groupBy}`, gender: buckets('gender') }, n: { $sum: 1 } } }];
  }
  const [r] = await Farmer.aggregate([{ $match: match }, { $facet: facets }]);

  const hide = (n) => (n > 0 && n < STATS_MIN_GROUP ? { count: null, suppressed: true } : { count: n, suppressed: false });
  const total = r.total[0]?.n ?? 0;
  const out = { total: hide(total), minGroupSize: STATS_MIN_GROUP, breakdown: {} };
  for (const d of DIMENSIONS) {
    const order = [...INCLUSION[d], 'not_recorded'];
    const got = new Map(r[d].map((x) => [x._id, x.n]));
    out.breakdown[d] = order.map((k) => ({ value: k, ...hide(got.get(k) ?? 0) }));
  }
  // One hidden group can be worked out from the total minus the others, so hide the smallest visible non-zero group too.
  for (const d of DIMENSIONS) {
    const cells = out.breakdown[d];
    if (cells.filter((c) => c.suppressed).length === 1) {
      const next = cells.filter((c) => !c.suppressed && c.count > 0).sort((x, y) => x.count - y.count)[0];
      if (next) { next.count = null; next.suppressed = true; }
    }
  }
  if (groupBy) {
    const byArea = new Map();
    for (const x of r.areas) {
      const row = byArea.get(x._id.area) ?? { area: x._id.area, total: 0, gender: {} };
      row.total += x.n; row.gender[x._id.gender] = x.n; byArea.set(x._id.area, row);
    }
    out.groupBy = groupBy;
    out.areas = [...byArea.values()].sort((a, b) => String(a.area).localeCompare(String(b.area))).map((row) => {
      if (row.total > 0 && row.total < STATS_MIN_GROUP) return { area: row.area, total: null, suppressed: true };
      const gender = {};
      for (const k of [...INCLUSION.gender, 'not_recorded']) { const n = row.gender[k] ?? 0; gender[k] = n > 0 && n < STATS_MIN_GROUP ? null : n; }
      return { area: row.area, total: row.total, suppressed: false, gender };
    });
  }
  return out;
}
