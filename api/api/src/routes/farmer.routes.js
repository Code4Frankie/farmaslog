import { Router } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import multer from 'multer';
import { env } from '../config/env.js';
import { ROLES } from '../config/constants.js';
import { Farmer } from '../models/Farmer.js';
import { Farm } from '../models/Farm.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { normalizeNigerianPhone } from '../utils/phone.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { auditCtx, writeAudit } from '../services/audit.service.js';
import { registerFarmer, updateFarmer, reviewFarmer, recordFieldVerification } from '../services/farmer.service.js';
import { withdrawConsent, recordReconsent } from '../services/consent.service.js';
import { queueEnrichment } from '../services/enrichment/enrichment.service.js';
import { farmerView } from '../services/serializers.js';
import {
  consentWithdrawalSchema, reconsentSchema, registerFarmerSchema, patchFarmerSchema, reviewSchema, fieldVerificationSchema, listFarmersSchema,
} from '../validators/index.js';

const { SUPER_ADMIN, DATA_MANAGER, FIELD_AGENT, AUDITOR } = ROLES;
const router = Router();
router.use(authenticate, authorize(SUPER_ADMIN, DATA_MANAGER, FIELD_AGENT, AUDITOR));

// Field agents only see records they registered; everyone else sees all.
const scopeFor = (user) => (user.role === FIELD_AGENT ? { registeredBy: user.id } : {});

router.param('id', async (req, _res, next, id) => {
  try {
    if (!mongoose.isValidObjectId(id)) throw new AppError(404, 'FARMER_NOT_FOUND', 'Farmer not found.');
    const farmer = await Farmer.findOne({ _id: id, ...scopeFor(req.user) });
    if (!farmer) throw new AppError(404, 'FARMER_NOT_FOUND', 'Farmer not found.');
    req.farmer = farmer;
    next();
  } catch (err) { next(err); }
});

router.post('/', authorize(SUPER_ADMIN, DATA_MANAGER, FIELD_AGENT), validate(registerFarmerSchema), asyncHandler(async (req, res) => {
  const { farmer, farm, isDuplicate, alreadyImported, warnings } = await registerFarmer(req.body, auditCtx(req));
  res.status(alreadyImported ? 200 : 201).json({
    ...farmerView(farmer, farm),
    duplicateCandidate: isDuplicate,
    alreadyImported,
    warnings: warnings ?? [],
    message: isDuplicate
      ? 'A record with this phone number already exists. This submission is held for review and no FarmasLog ID has been issued.'
      : 'Registered. The record is pending review before it can be verified by partners.',
  });
}));

router.get('/', validate(listFarmersSchema, 'query'), asyncHandler(async (req, res) => {
  const { page, limit, phone, ...f } = req.query;
  const filter = { ...scopeFor(req.user) };
  for (const k of ['state', 'lga', 'ward', 'status', 'consentStatus']) if (f[k]) filter[k] = f[k];
  if (phone) {
    const p = normalizeNigerianPhone(phone);
    if (!p) throw new AppError(400, 'INVALID_PHONE', 'phone must be a valid Nigerian mobile number.');
    filter.phoneNormalized = p;
  }
  const [rows, total] = await Promise.all([
    Farmer.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    Farmer.countDocuments(filter),
  ]);
  const farms = await Farm.find({ farmerId: { $in: rows.map((r) => r._id) } });
  const byFarmer = new Map(farms.map((m) => [String(m.farmerId), m]));
  res.json({ data: rows.map((r) => farmerView(r, byFarmer.get(String(r._id)))), page, limit, total });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  res.json(farmerView(req.farmer, await Farm.findOne({ farmerId: req.farmer._id })));
}));

router.patch('/:id', authorize(SUPER_ADMIN, DATA_MANAGER), validate(patchFarmerSchema), asyncHandler(async (req, res) => {
  const { farmer, farm } = await updateFarmer(req.farmer, req.body, auditCtx(req));
  res.json(farmerView(farmer, farm));
}));

router.post('/:id/review', authorize(SUPER_ADMIN, DATA_MANAGER), validate(reviewSchema), asyncHandler(async (req, res) => {
  const farmer = await reviewFarmer(req.farmer, req.body, auditCtx(req));
  res.json(farmerView(farmer, await Farm.findOne({ farmerId: farmer._id })));
}));

router.post('/:id/field-verification', authorize(SUPER_ADMIN, DATA_MANAGER, FIELD_AGENT), validate(fieldVerificationSchema), asyncHandler(async (req, res) => {
  const farm = await Farm.findOne({ farmerId: req.farmer._id });
  await recordFieldVerification(req.farmer, farm, req.body, auditCtx(req));
  res.json(farmerView(req.farmer, farm));
}));

router.post('/:id/consent-withdrawal', authorize(SUPER_ADMIN, DATA_MANAGER, FIELD_AGENT), validate(consentWithdrawalSchema), asyncHandler(async (req, res) => {
  const farmer = await withdrawConsent(req.farmer, req.body, auditCtx(req));
  res.json(farmerView(farmer, await Farm.findOne({ farmerId: farmer._id })));
}));

router.post('/:id/reconsent', authorize(SUPER_ADMIN, DATA_MANAGER, FIELD_AGENT), validate(reconsentSchema), asyncHandler(async (req, res) => {
  const farmer = await recordReconsent(req.farmer, req.body.consent, auditCtx(req));
  res.json(farmerView(farmer, await Farm.findOne({ farmerId: farmer._id })));
}));

router.post('/:id/enrich', authorize(SUPER_ADMIN, DATA_MANAGER), asyncHandler(async (req, res) => {
  if (req.farmer.consentStatus === 'withdrawn') throw new AppError(409, 'CONSENT_WITHDRAWN', 'Consent was withdrawn for this record.');
  const farm = await Farm.findOne({ farmerId: req.farmer._id });
  await queueEnrichment(farm);
  await writeAudit(auditCtx(req), { action: 'farm.enrichment_requested', entityType: 'Farm', entityId: farm._id });
  res.status(202).json({ message: 'Enrichment queued. Check the farm record for the result.', enrichmentState: farm.enrichment.state });
}));

// ---- evidence files: private disk storage, magic-byte checked, authenticated download ----
const ALLOWED = { 'image/jpeg': '.jpg', 'image/png': '.png', 'application/pdf': '.pdf' };
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, _f, cb) => {
      const dir = path.resolve(env.uploadDir, String(req.farmer._id));
      fs.mkdir(dir, { recursive: true }).then(() => cb(null, dir), cb);
    },
    filename: (_req, file, cb) => cb(null, `${crypto.randomUUID()}${ALLOWED[file.mimetype] ?? ''}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => (ALLOWED[file.mimetype] ? cb(null, true) : cb(new AppError(400, 'UNSUPPORTED_FILE_TYPE', 'Only JPEG, PNG or PDF files are accepted.'))),
});

async function sniff(file) {
  const fh = await fs.open(file, 'r');
  const b = Buffer.alloc(8);
  await fh.read(b, 0, 8, 0);
  await fh.close();
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b.subarray(0, 4).toString() === '%PDF') return 'application/pdf';
  return null;
}

router.post('/:id/files', authorize(SUPER_ADMIN, DATA_MANAGER, FIELD_AGENT), upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) throw new AppError(400, 'FILE_REQUIRED', "Attach a file in the 'file' field.");
  if ((await sniff(req.file.path)) !== req.file.mimetype) {
    await fs.rm(req.file.path, { force: true });
    throw new AppError(400, 'FILE_CONTENT_MISMATCH', 'File content does not match its declared type.');
  }
  const farm = await Farm.findOne({ farmerId: req.farmer._id });
  farm.files.push({ originalName: path.basename(req.file.originalname).slice(0, 120), storedName: req.file.filename, mimeType: req.file.mimetype, size: req.file.size, uploadedBy: req.user.id });
  await farm.save();
  const added = farm.files[farm.files.length - 1];
  await writeAudit(auditCtx(req), { action: 'farm.file_uploaded', entityType: 'Farm', entityId: farm._id, changes: { fileId: String(added._id), mimeType: added.mimeType, size: added.size } });
  res.status(201).json({ id: String(added._id), originalName: added.originalName, mimeType: added.mimeType, size: added.size });
}));

router.get('/:id/files/:fileId', authorize(SUPER_ADMIN, DATA_MANAGER, FIELD_AGENT), asyncHandler(async (req, res) => {
  const farm = await Farm.findOne({ farmerId: req.farmer._id });
  const file = farm?.files.id(req.params.fileId);
  if (!file) throw new AppError(404, 'FILE_NOT_FOUND', 'File not found.');
  await writeAudit(auditCtx(req), { action: 'farm.file_accessed', entityType: 'Farm', entityId: farm._id, changes: { fileId: String(file._id) } });
  res.set('Cache-Control', 'private, no-store');
  res.download(path.resolve(env.uploadDir, String(req.farmer._id), file.storedName), file.originalName);
}));

export default router;
