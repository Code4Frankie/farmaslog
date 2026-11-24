import mongoose from 'mongoose';
import { Farmer } from '../models/Farmer.js';
import { Farm } from '../models/Farm.js';
import { canonicalArea } from '../data/ng-geo.js';
import { farmerView } from './serializers.js';

// What a field agent may work on:
//  - their own registrations, and
//  - approved farmers in their patch (the state and local government area on their account, or the whole state if no LGA),
//    including farmers who registered themselves on the website, so someone can visit them.
// An agent with no state on their account has no patch.
export function patchFilter(user) {
  if (!user.state) return null;
  const a = canonicalArea(user.state, user.lga);
  return { status: 'active', state: a.state, ...(a.lga ? { lga: a.lga } : {}) };
}
export const agentScope = (user) => {
  const patch = patchFilter(user);
  return patch ? { $or: [{ registeredBy: user.id }, patch] } : { registeredBy: user.id };
};

// Aggregation pipelines do not cast ids the way find() does.
const oid = (id) => new mongoose.Types.ObjectId(id);
const stillToVisit = { consentStatus: { $ne: 'withdrawn' } };

/** Approved farmers whose farm has not been confirmed by a visit yet. scope: mine | area | all */
export async function visitQueue(user, { scope = 'all', page = 1, limit = 25 } = {}) {
  const patch = patchFilter(user);
  const mine = { registeredBy: oid(user.id), status: 'active' };
  const area = patch ? { ...patch, registeredBy: { $ne: oid(user.id) } } : null;
  const parts = scope === 'mine' ? [mine] : scope === 'area' ? (area ? [area] : []) : [mine, ...(area ? [area] : [])];
  if (!parts.length) return { data: [], page, limit, total: 0 };
  const [r] = await Farmer.aggregate([
    { $match: { ...stillToVisit, $or: parts } },
    { $lookup: { from: Farm.collection.name, localField: '_id', foreignField: 'farmerId', as: 'farm' } },
    { $match: { 'farm.evidence.status': { $ne: 'field_verified' } } },
    { $sort: { createdAt: 1 } }, // longest waiting first
    { $facet: { rows: [{ $skip: (page - 1) * limit }, { $limit: limit }], total: [{ $count: 'n' }] } },
  ]);
  return {
    data: r.rows.map((f) => ({ ...farmerView(f, f.farm[0]), visitScope: String(f.registeredBy) === user.id ? 'mine' : 'area' })),
    page, limit, total: r.total[0]?.n ?? 0,
  };
}

export async function agentSummary(user) {
  const rows = await Farmer.aggregate([{ $match: { registeredBy: oid(user.id) } }, { $group: { _id: { status: '$status', consent: '$consentStatus' }, n: { $sum: 1 } } }]);
  const by = { pending_review: 0, duplicate_review: 0, active: 0, rejected: 0 };
  let needsReconsent = 0; let withdrawn = 0; let registered = 0;
  for (const r of rows) {
    registered += r.n; by[r._id.status] = (by[r._id.status] ?? 0) + r.n;
    if (r._id.consent === 'needs_reconsent') needsReconsent += r.n;
    if (r._id.consent === 'withdrawn') withdrawn += r.n;
  }
  const [mine, area, verified] = await Promise.all([
    visitQueue(user, { scope: 'mine', limit: 1 }), visitQueue(user, { scope: 'area', limit: 1 }),
    Farm.countDocuments({ 'fieldVerification.verifiedBy': user.id, 'fieldVerification.outcome': 'verified' }),
  ]);
  const patch = patchFilter(user);
  return {
    registered, byStatus: by, needsReconsent, withdrawn,
    visitsWaiting: { mine: mine.total, area: area.total },
    verifiedByMe: verified,
    patch: patch ? { state: patch.state, lga: patch.lga ?? null } : null,
  };
}
