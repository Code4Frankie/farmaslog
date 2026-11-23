import { CONTACT_TYPES, INCLUSION } from '../config/constants.js';
import { KNOWN_VERSIONS, CURRENT_CONSENT_VERSION, LANGUAGES, CONSENT_METHODS, CONSENT_STATUSES, TEXTS } from '../config/consent.js';
import Joi from 'joi';
import { FARMASLOG_ID_RE } from '../utils/ids.js';
import { LOCATION_SOURCE, ONBOARDABLE_ROLES, PLANS, ROLE_LIST, SCOPE_LIST, FARMER_STATUS, NIGERIA_BBOX as B } from '../config/constants.js';

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
  type: Joi.string().valid('programme', 'bank', 'insurer', 'cooperative', 'extension', 'government', 'ngo', 'other').default('other'),
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

// Consent block. Unknown wording versions are rejected. The CURRENT version must also say how consent was captured and
// whether partner sharing was agreed; legacy versions (imports of older records) may omit those and are flagged
// needs_reconsent by the service.
export const consentSchema = Joi.object({
  given: Joi.boolean().valid(true).required(),
  wordingVersion: Joi.string().trim().valid(...KNOWN_VERSIONS).required()
    .messages({ 'any.only': `wordingVersion must be one of: ${KNOWN_VERSIONS.join(', ')}` }),
  purpose: Joi.string().trim().max(200).default('Farmer and farm verification'),
  language: Joi.string().valid(...LANGUAGES).default('en'),
  textLanguage: Joi.string().valid(...LANGUAGES),
  method: Joi.when('wordingVersion', { is: CURRENT_CONSENT_VERSION, then: Joi.string().valid(...CONSENT_METHODS).required(), otherwise: Joi.string().valid(...CONSENT_METHODS) }),
  partnerSharing: Joi.when('wordingVersion', { is: CURRENT_CONSENT_VERSION, then: Joi.boolean().required(), otherwise: Joi.boolean() }),
  mediaStorage: Joi.boolean().default(false),
});

export const consentWithdrawalSchema = Joi.object({ reason: Joi.string().trim().max(300).allow('') });
export const reconsentSchema = Joi.object({
  consent: consentSchema.custom((v, h) => (v.wordingVersion === CURRENT_CONSENT_VERSION ? v : h.message('Re-consent must use the current consent version.'))).required(),
});
export const consentReferenceSchema = Joi.object({
  lang: Joi.string().valid(...LANGUAGES).default('en'),
  version: Joi.string().valid(...Object.keys(TEXTS)),
});

// Someone who can reach the farmer (a relative, cooperative leader or the agent). A phone is required unless the agent
// is the contact.
export const contactViaSchema = Joi.object({
  type: Joi.string().valid(...CONTACT_TYPES).required(),
  name: Joi.string().trim().max(120).allow(''),
  phone: Joi.when('type', { is: 'agent', then: Joi.string().trim().max(25).allow(''), otherwise: Joi.string().trim().max(25).required() }),
  relationship: Joi.string().trim().max(60).allow(''),
});

export const inclusionSchema = Joi.object({
  gender: Joi.string().valid(...INCLUSION.gender),
  ageBand: Joi.string().valid(...INCLUSION.ageBand),
  disability: Joi.string().valid(...INCLUSION.disability),
}).min(1);

// Consent contact details an administrator can edit. An empty string removes the saved value.
export const consentDetailsSchema = Joi.object({
  registeredAddress: Joi.string().trim().max(300).allow(''),
  email: Joi.string().trim().email({ tlds: { allow: false } }).max(120).allow(''),
  phone: Joi.string().trim().pattern(/^[0-9+() -]{7,25}$/).allow('').messages({ 'string.pattern.base': 'Enter a valid phone number.' }),
  whatsapp: Joi.string().trim().pattern(/^[0-9+() -]{7,25}$/).allow('').messages({ 'string.pattern.base': 'Enter a valid WhatsApp number.' }),
  retention: Joi.string().trim().max(120).allow(''),
  hosting: Joi.string().trim().max(200).allow(''),
}).min(1);

export const otpRequestSchema = Joi.object({
  phone: Joi.string().trim().max(25).required(),
  purpose: Joi.string().valid('register', 'access').required(),
  captchaToken: Joi.string().max(4096).allow(''),
});
export const otpVerifySchema = Joi.object({
  phone: Joi.string().trim().max(25).required(),
  purpose: Joi.string().valid('register', 'access').required(),
  code: Joi.string().trim().pattern(/^\d{6}$/).required().messages({ 'string.pattern.base': 'The code is 6 digits.' }),
});

// Public self-registration. Only what a farmer can reasonably give. BVN, NIN, date of birth and photos are refused outright.
const notCollected = (name) => Joi.any().forbidden().messages({ 'any.unknown': `${name} is not collected` });
export const publicRegistrationSchema = Joi.object({
  phoneProof: Joi.string().max(2000).required(),
  name: Joi.string().trim().min(2).max(120).required(),
  phone: Joi.string().trim().max(25).required(),
  state: Joi.string().trim().max(60).required(),
  lga: Joi.string().trim().max(60).required(),
  ward: Joi.string().trim().max(80).allow(''),
  community: Joi.string().trim().max(80).allow(''),
  crop: Joi.string().trim().max(80).required(),
  reportedAreaHa: Joi.number().positive().max(100000),
  inclusion: inclusionSchema,
  // Where the farm is, if the farmer chooses to share it (their phone's location). Always recorded as a farmer pin.
  location: Joi.object({
    lat: location.extract('lat'), lng: location.extract('lng'), accuracyMeters: Joi.number().min(0).max(100000),
  }),
  consent: Joi.object({
    given: Joi.boolean().valid(true).required(),
    wordingVersion: Joi.string().valid(CURRENT_CONSENT_VERSION).required(),
    language: Joi.string().valid(...LANGUAGES).default('en'),
    partnerSharing: Joi.boolean().required(),
    mediaStorage: Joi.boolean().default(false),
  }).required(),
  bvn: notCollected('BVN'), nin: notCollected('NIN'), dob: notCollected('Date of birth'), dateOfBirth: notCollected('Date of birth'),
  photo: notCollected('Photos'), photos: notCollected('Photos'),
});

export const inclusionStatsSchema = Joi.object({
  state: Joi.string().trim().max(60), lga: Joi.string().trim().max(60),
  groupBy: Joi.string().valid('state', 'lga'),
});

export const registerFarmerSchema = Joi.object({
  name: Joi.string().trim().min(2).max(120).required(),
  phone: Joi.string().trim().max(25),
  contactVia: contactViaSchema,
  inclusion: inclusionSchema,
  state: Joi.string().trim().max(60).required(),
  lga: Joi.string().trim().max(60).required(),
  ward: Joi.string().trim().max(80).allow('', null),
  community: Joi.string().trim().max(80).allow('', null),
  consent: consentSchema.required(),
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
}).or('phone', 'contactVia').messages({ 'object.missing': 'Give the farmer\'s phone number, or a contact person who can reach them (contactVia).' });

export const patchFarmerSchema = Joi.object({
  name: Joi.string().trim().min(2).max(120),
  phone: Joi.string().trim().max(25).allow(null, ''), // null/'' removes it (only if a contact person remains)
  contactVia: contactViaSchema.allow(null),
  sharedPhone: Joi.boolean(),
  inclusion: inclusionSchema,
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
  consentStatus: Joi.string().valid(...CONSENT_STATUSES),
  phone: Joi.string().trim().max(25),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(25),
});

export const createPartnerSchema = Joi.object({
  organization: Joi.string().trim().min(2).max(120).required(),
  type: Joi.string().valid('programme', 'bank', 'insurer', 'cooperative', 'extension', 'government', 'ngo', 'other'),
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

export const createStaffSchema = Joi.object({
  name: Joi.string().trim().min(2).max(120).required(),
  email: Joi.string().email({ tlds: { allow: false } }).required(),
  role: Joi.string().valid(...ONBOARDABLE_ROLES).required(),
});

export const staffStatusSchema = Joi.object({ status: Joi.string().valid('active', 'disabled').required() });

export const changePasswordSchema = Joi.object({
  currentPassword: Joi.string().max(200).required(),
  newPassword: Joi.string().min(12).max(200).required(),
});

// Someone applying to become a FarmasLog field agent. Nothing works until an administrator approves it.
export const agentSignupSchema = Joi.object({
  name: Joi.string().trim().min(2).max(120).required(),
  email: Joi.string().email({ tlds: { allow: false } }).required(),
  phone: Joi.string().trim().min(7).max(25).required(),
  state: Joi.string().trim().max(60).required(),
  lga: Joi.string().trim().max(60).required(),
  password: Joi.string().min(12).max(200).required(),
});

export const staffListSchema = Joi.object({ status: Joi.string().valid('active', 'disabled', 'pending') });
