import { Router } from 'express';
import { AppError } from '../utils/AppError.js';
import { validate } from '../middleware/validate.js';
import { consentReferenceSchema } from '../validators/index.js';
import { getConsent } from '../services/consent.service.js';
import { publicPage } from '../services/pages.service.js';
import { PAGE_SLUGS } from '../config/pages.js';
import { asyncHandler } from '../utils/asyncHandler.js';
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

// Public: the consent text shown to farmers. Falls back to English until a reviewed translation exists.
router.get('/consent', validate(consentReferenceSchema, 'query'), (req, res) => {
  res.set('Cache-Control', 'public, max-age=300');
  const c = getConsent({ version: req.query.version, language: req.query.lang });
  res.json(c);
});

// Public: the published privacy notice or terms. 404 until an administrator has published the page.
router.get('/pages/:slug', asyncHandler(async (req, res) => {
  if (!PAGE_SLUGS.includes(req.params.slug)) throw new AppError(404, 'NOT_FOUND', 'No such page.');
  res.set('Cache-Control', 'public, max-age=300');
  res.json(await publicPage(req.params.slug));
}));

export default router;
