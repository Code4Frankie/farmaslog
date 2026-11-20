import { Router } from 'express';
import { AppError } from '../utils/AppError.js';
import { AREAS, STATES, matchState } from '../data/ng-geo.js';

const router = Router();

// Public reference data (geography only, no personal data).
router.get('/areas', (req, res) => {
  res.set('Cache-Control', 'public, max-age=86400');
  const q = String(req.query.state ?? '').trim();
  if (!q) return res.json({ states: STATES, lgaCount: Object.values(AREAS).reduce((n, l) => n + l.length, 0), lgas: AREAS });
  const m = matchState(q, { maxDistance: 0 });
  if (!m) throw new AppError(404, 'STATE_NOT_FOUND', `No state matches '${q.slice(0, 60)}'.`);
  return res.json({ state: m.name, lgas: AREAS[m.name] });
});

export default router;
