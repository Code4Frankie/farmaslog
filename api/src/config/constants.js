export const ROLES = Object.freeze({
  SUPER_ADMIN: 'super_admin',
  DATA_MANAGER: 'data_manager',
  FIELD_AGENT: 'field_agent',
  PARTNER_VERIFIER: 'partner_verifier',
  FINANCE: 'finance',
  AUDITOR: 'auditor',
});
export const ROLE_LIST = Object.values(ROLES);
// FarmasLog's own team. A super admin can onboard these from the dashboard; partner users sign up themselves.
export const STAFF_ROLES = Object.freeze([ROLES.SUPER_ADMIN, ROLES.DATA_MANAGER, ROLES.FIELD_AGENT, ROLES.FINANCE, ROLES.AUDITOR]);
export const ONBOARDABLE_ROLES = Object.freeze([ROLES.DATA_MANAGER, ROLES.FIELD_AGENT, ROLES.FINANCE, ROLES.AUDITOR]);

export const PLANS = ['free', 'payg', 'growth', 'enterprise'];
// Requests/minute per API key (PRD section 9: Starter 60, Business 300). Overridable per key.
export const PLAN_RATE_LIMITS = { free: 60, payg: 60, growth: 300, enterprise: 300 };
export const FREE_MONTHLY_QUOTA = 50;

export const SCOPES = Object.freeze({ VERIFY: 'verify:read', COORDINATES: 'coordinates:read' });
export const SCOPE_LIST = Object.values(SCOPES);

export const EVIDENCE_STATUS = ['pending', 'self_reported', 'satellite_signal', 'field_verified', 'needs_review'];
export const ENRICHMENT_STATE = ['not_assessed', 'pending', 'completed', 'insufficient_imagery', 'failed'];
export const CONTACT_TYPES = ['farmer', 'relative', 'cooperative_leader', 'agent'];
// Optional inclusion fields, self-declared or asked kindly by the agent. Always optional; 'prefer_not_to_say' is a valid answer.
// Never returned by /v1/verify and never used for matching, billing or eligibility.
export const INCLUSION = Object.freeze({
  gender: ['female', 'male', 'other', 'prefer_not_to_say'],
  ageBand: ['18_24', '25_34', '35_44', '45_54', '55_64', '65_plus', 'prefer_not_to_say'],
  disability: ['none', 'yes', 'prefer_not_to_say'],
});
// Groups smaller than this are hidden in inclusion statistics so no individual can be singled out.
export const STATS_MIN_GROUP = 5;
export const FARMER_STATUS = ['pending_review', 'active', 'duplicate_review', 'rejected'];
export const FARMER_SOURCE = ['self_registration', 'field_agent', 'admin', 'import'];
export const LOCATION_SOURCE = ['gps_field_agent', 'farmer_pin', 'farmer_reported', 'geocoded', 'town_centre'];

// Loose Nigeria bounding box: catches swapped/mistyped coordinates (a data-quality rule, not geofencing).
export const NIGERIA_BBOX = Object.freeze({ latMin: 4, latMax: 14.5, lngMin: 2.5, lngMax: 15 });
