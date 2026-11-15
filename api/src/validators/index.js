import Joi from 'joi';
import { FARMASLOG_ID_RE } from '../utils/ids.js';
import { LOCATION_SOURCE, PLANS, ROLE_LIST, SCOPE_LIST, FARMER_STATUS, NIGERIA_BBOX as B } from '../config/constants.js';

const id24 = Joi.string().hex().length(24);

const location = Joi.object({
  lat: Joi.number().min(B.latMin).max(B.latMax).required(),
  lng: Joi.number().min(B.lngMin).max(B.lngMax).required(),
  source: Joi.string().valid(...LOCATION_SOURCE).required(),
  accuracyMeters: Joi.number().min(0).max(100000),
  collectedAt: Joi.date().iso().max('now'),
});

export const signupSchema = Joi.object({
  organization: Joi.string().trim().min(2).max(120).required(),
  type: Joi.string().valid('programme', 'bank', 'insurer', 'cooperative', 'extension', 'other').default('other'),
  name: Joi.string().trim().min(2).max(120).required(),
  email: Joi.string().email({ tlds: { allow: false } }).required(),
  password: Joi.string().min(12).max(200).required(),
});

export const loginSchema = Joi.object({ email: Joi.string().email({ tlds: { allow: false } }).required(), password: Joi.string().max(200).required() });

export const verifyQuerySchema = Joi.object({
  phone: Joi.string().trim().max(25),
  farmaslogId: Joi.string().trim().pattern(FARMASLOG_ID_RE).message('farmaslogId must look like FL-XXXXXXXX'),
  state: Joi.string().trim().max(60),
  lga: Joi.string().trim().max(60),
}).xor('phone', 'farmaslogId').messages({ 'object.xor': 'Provide exactly one of phone or farmaslogId.', 'object.missing': 'Provide exactly one of phone or farmaslogId.' });

export const registerFarmerSchema = Joi.object({
  name: Joi.string().trim().min(2).max(120).required(),
  phone: Joi.string().trim().max(25).required(),
  state: Joi.string().trim().max(60).required(),
  lga: Joi.string().trim().max(60).required(),
  ward: Joi.string().trim().max(80).allow('', null),
  community: Joi.string().trim().max(80).allow('', null),
  consent: Joi.object({
    given: Joi.boolean().valid(true).required(),
    wordingVersion: Joi.string().trim().max(40).required(),
    purpose: Joi.string().trim().max(200).default('Farmer and farm verification'),
  }).required(),
  source: Joi.string().valid('self_registration', 'field_agent', 'admin', 'import').default('field_agent'),
  isSynthetic: Joi.boolean().default(false),
  sourceRef: Joi.string().trim().max(100),
  sourceChannel: Joi.string().valid('web_form', 'field_app', 'manual', 'csv_import'),
  submittedAt: Joi.date().iso(),
  programmeRequested: Joi.string().trim().max(80).allow(''),
  farm: Joi.object({
    crop: Joi.string().trim().max(80).required(),
    reportedAreaHa: Joi.number().positive().max(100000),
    location,
  }).required(),
});

export const patchFarmerSchema = Joi.object({
  name: Joi.string().trim().min(2).max(120),
  phone: Joi.string().trim().max(25),
  state: Joi.string().trim().max(60),
  lga: Joi.string().trim().max(60),
  ward: Joi.string().trim().max(80).allow(''),
  community: Joi.string().trim().max(80).allow(''),
  farm: Joi.object({ crop: Joi.string().trim().max(80), reportedAreaHa: Joi.number().positive().max(100000), location }).min(1),
}).min(1);

export const reviewSchema = Joi.object({ decision: Joi.string().valid('approve', 'reject').required(), note: Joi.string().trim().max(500) });

export const fieldVerificationSchema = Joi.object({
  outcome: Joi.string().valid('verified', 'rejected').required(),
  method: Joi.string().valid('site_visit', 'gps_track', 'document_review').required(),
  notes: Joi.string().trim().max(1000),
  location: Joi.object({
    lat: location.extract('lat'), lng: location.extract('lng'), accuracyMeters: Joi.number().min(0).max(100000),
  }),
});

export const listFarmersSchema = Joi.object({
  state: Joi.string().trim().max(60), lga: Joi.string().trim().max(60), ward: Joi.string().trim().max(80),
  status: Joi.string().valid(...FARMER_STATUS),
  phone: Joi.string().trim().max(25),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(25),
});

export const createPartnerSchema = Joi.object({
  organization: Joi.string().trim().min(2).max(120).required(),
  type: Joi.string().valid('programme', 'bank', 'insurer', 'cooperative', 'extension', 'other'),
  plan: Joi.string().valid(...PLANS),
  billingEmail: Joi.string().email({ tlds: { allow: false } }),
});

export const createUserSchema = Joi.object({
  email: Joi.string().email({ tlds: { allow: false } }).required(),
  name: Joi.string().trim().min(2).max(120).required(),
  password: Joi.string().min(12).max(200).required(),
  role: Joi.string().valid(...ROLE_LIST).required(),
  partnerId: id24,
});

export const createKeySchema = Joi.object({
  name: Joi.string().trim().min(2).max(80).required(),
  mode: Joi.string().valid('test', 'live').default('test'),
  plan: Joi.string().valid(...PLANS),
  scopes: Joi.array().items(Joi.string().valid(...SCOPE_LIST)).min(1).unique(),
  rateLimitPerMinute: Joi.number().integer().min(1).max(10000),
  expiresAt: Joi.date().iso().greater('now'),
});

export const rotateKeySchema = Joi.object({ graceHours: Joi.number().min(0).max(720).default(24) });

export const usageSchema = Joi.object({
  from: Joi.date().iso(), to: Joi.date().iso(), partnerId: id24,
  groupBy: Joi.string().valid('month', 'day').default('month'),
});

export const logListSchema = Joi.object({
  partnerId: id24, from: Joi.date().iso(), to: Joi.date().iso(),
  result: Joi.string(), action: Joi.string(), entityType: Joi.string(),
  page: Joi.number().integer().min(1).default(1), limit: Joi.number().integer().min(1).max(200).default(50),
});
