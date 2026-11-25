import { Router } from 'express';
import { ROLES } from '../config/constants.js';
import { PAGE_SLUGS } from '../config/pages.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { AppError } from '../utils/AppError.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { auditCtx } from '../services/audit.service.js';
import { consentTextSchema, consentVersionParam, consentDraftSchema, consentPublishSchema, consentPreviewSchema, pageSchema } from '../validators/index.js';
import * as texts from '../services/consentText.service.js';
import * as pages from '../services/pages.service.js';

// Administrator content: the consent wording (versioned, per language) and the website's privacy notice and terms.
// Reading is open to super admin, data manager and auditor; everything that changes content is super admin only and audited.
const { SUPER_ADMIN, DATA_MANAGER, AUDITOR } = ROLES;
const router = Router();
router.use(['/admin/consent-texts', '/admin/pages'], authenticate);
const read = authorize(SUPER_ADMIN, DATA_MANAGER, AUDITOR);
const write = authorize(SUPER_ADMIN);
const params = (req, _res, next) => { const { error } = consentVersionParam.validate({ version: req.params.version, language: req.params.language }); next(error ? new AppError(400, 'VALIDATION_ERROR', 'Unknown version or language.') : undefined); };
const slug = (req, _res, next) => next(PAGE_SLUGS.includes(req.params.slug) ? undefined : new AppError(404, 'NOT_FOUND', 'No such page.'));

router.get('/admin/consent-texts', read, asyncHandler(async (_req, res) => res.json(await texts.listVersions())));
router.post('/admin/consent-texts', write, validate(consentDraftSchema), asyncHandler(async (req, res) => res.status(201).json({ data: await texts.createDraft(req.body, auditCtx(req)) })));
router.get('/admin/consent-texts/:version', read, params, validate(consentPreviewSchema, 'query'), asyncHandler(async (req, res) => res.json({ data: await texts.getVersion(req.params.version, req.query.lang) })));
router.put('/admin/consent-texts/:version/:language', write, params, validate(consentTextSchema), asyncHandler(async (req, res) => res.json({ data: await texts.saveLanguage(req.params.version, req.params.language, req.body, auditCtx(req)) })));
router.delete('/admin/consent-texts/:version/:language', write, params, asyncHandler(async (req, res) => res.json({ data: await texts.removeLanguage(req.params.version, req.params.language, auditCtx(req)) })));
router.delete('/admin/consent-texts/:version', write, params, asyncHandler(async (req, res) => { await texts.discardDraft(req.params.version, auditCtx(req)); res.status(204).end(); }));
router.post('/admin/consent-texts/:version/publish', write, params, validate(consentPublishSchema), asyncHandler(async (req, res) => res.json({ data: await texts.publishVersion(req.params.version, req.body, auditCtx(req)) })));

router.get('/admin/pages', read, asyncHandler(async (_req, res) => res.json({ data: await pages.listPages() })));
router.get('/admin/pages/:slug', read, slug, asyncHandler(async (req, res) => res.json({ data: await pages.getPage(req.params.slug) })));
router.put('/admin/pages/:slug', write, slug, validate(pageSchema), asyncHandler(async (req, res) => res.json({ data: await pages.savePageDraft(req.params.slug, req.body, auditCtx(req)) })));
router.post('/admin/pages/:slug/publish', write, slug, asyncHandler(async (req, res) => res.json({ data: await pages.publishPage(req.params.slug, auditCtx(req)) })));

export default router;
