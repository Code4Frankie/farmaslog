import 'dotenv/config';

const nodeEnv = process.env.NODE_ENV || 'development';
const isProd = nodeEnv === 'production';
const bool = (v, d) => (v === undefined ? d : ['1', 'true', 'yes'].includes(String(v).toLowerCase()));

function required(name, devFallback) {
  const v = process.env[name];
  if (v) return v;
  if (isProd) throw new Error(`Missing required environment variable ${name}`);
  return devFallback;
}

export const env = {
  nodeEnv,
  isProd,
  isTest: nodeEnv === 'test',
  port: Number(process.env.PORT || 3000),
  mongoUri: required('MONGODB_URI', 'mongodb://127.0.0.1:27017/farmaslog'),
  jwtSecret: required('JWT_SECRET', 'dev-only-jwt-secret-change-me'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',
  lookupHmacSecret: required('LOOKUP_HMAC_SECRET', 'dev-only-lookup-secret'),
  // First-run helper for hosts with no shell (e.g. Render free plan). See src/bootstrap.js.
  bootstrapAdminEmail: (process.env.BOOTSTRAP_ADMIN_EMAIL || '').trim().toLowerCase(),
  bootstrapAdminPassword: process.env.BOOTSTRAP_ADMIN_PASSWORD || '',
  paystackSecret: process.env.PAYSTACK_SECRET_KEY || '',
  paystackServerVerify: bool(process.env.PAYSTACK_SERVER_VERIFY, nodeEnv !== 'test'),
  uploadDir: process.env.UPLOAD_DIR || './uploads',
  corsOrigins: (process.env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
  // Synthetic test records: on by default outside production. A STAGING deploy (NODE_ENV=production) can opt in
  // with ALLOW_SYNTHETIC=true so the smoke test can run. Never set this on the real production service.
  allowSynthetic: bool(process.env.ALLOW_SYNTHETIC, !isProd),
  verifyIncludeCoordinates: bool(process.env.VERIFY_INCLUDE_COORDINATES, false),
  // Consent text placeholders (see src/config/consent.js). Unset values show as [bracketed] gaps in the consent text.
  consent: {
    registeredAddress: process.env.CONSENT_REGISTERED_ADDRESS || '',
    // Defaults are FarmasLog's published contact details (frankiecode.org.ng/about). An administrator can edit them in the dashboard.
    email: process.env.CONSENT_CONTACT_EMAIL || 'info@frankiecode.org.ng',
    phone: process.env.CONSENT_CONTACT_PHONE || '0802 863 8349',
    whatsapp: process.env.CONSENT_CONTACT_WHATSAPP || '0706 758 4686',
    retention: process.env.CONSENT_RETENTION_PERIOD || '',
    hosting: process.env.CONSENT_HOSTING || '',
    // When true, records flagged needs_reconsent are hidden from partner verification. Withdrawn records are ALWAYS hidden.
    hideNeedsReconsent: bool(process.env.HIDE_NEEDS_RECONSENT, false),
  },
  ndviThreshold: Number(process.env.NDVI_THRESHOLD || 0.3),
  areaTolerance: Number(process.env.AREA_DISCREPANCY_TOLERANCE || 0.3),
};

if (isProd && env.jwtSecret.length < 32) throw new Error('JWT_SECRET must be at least 32 characters in production');
