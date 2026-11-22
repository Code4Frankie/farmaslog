const err = (desc) => ({ description: desc, content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } });
const bearerJwt = [{ jwt: [] }];

export const openapi = {
  openapi: '3.0.3',
  info: {
    title: 'FarmasLog-API',
    version: '1.0.0',
    description:
      'Farmer and farm verification. Partners call `GET /v1/verify` with an API key (`Authorization: Bearer sk_test_...`). ' +
      'Staff use JWT-protected endpoints. Evidence is always labelled by source: self-reported, satellite signal, or field verified. ' +
      'A satellite signal is never proof of a farm or of ownership.',
  },
  servers: [{ url: '/' }],
  tags: [{ name: 'Verification' }, { name: 'Auth' }, { name: 'Farmers' }, { name: 'Partners & keys' }, { name: 'Reporting' }, { name: 'Webhooks' }],
  paths: {
    '/v1/verify': {
      get: {
        tags: ['Verification'],
        summary: 'Verify a farmer record (partner API key)',
        description: 'Provide exactly one of `phone` or `farmaslogId`. `state` and `lga` optionally narrow the match. A phone number can be shared by several farmers: when more than one approved record matches you get 409 `MULTIPLE_RECORDS` (never a guess). Retry with `farmaslogId`, or add `state`/`lga`. Billable only on 200.',
        security: [{ apiKey: [] }],
        parameters: [
          { name: 'phone', in: 'query', schema: { type: 'string' }, example: '08000000001', description: 'Nigerian mobile number in any common format.' },
          { name: 'farmaslogId', in: 'query', schema: { type: 'string' }, example: 'FL-7K3M9Q2X' },
          { name: 'state', in: 'query', schema: { type: 'string' }, example: 'Benue' },
          { name: 'lga', in: 'query', schema: { type: 'string' }, example: 'Vandeikya' },
        ],
        responses: {
          200: { description: 'Record found and caller authorized', content: { 'application/json': { schema: { $ref: '#/components/schemas/VerifyResult' } } } },
          400: err('Missing/invalid query'),
          401: err('Missing or invalid API key'),
          403: err('Key lacks scope, or partner suspended'),
          404: err('No matching record available to caller'),
          409: err('MULTIPLE_RECORDS: several approved records share this phone. Use farmaslogId or add state/lga. Not billed.'),
          429: err('Rate limit or free-plan quota exceeded (see retryAfterSeconds)'),
        },
      },
    },
    '/v1/auth/login': {
      post: {
        tags: ['Auth'], summary: 'Sign in (staff and partner users)',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['email', 'password'], properties: { email: { type: 'string' }, password: { type: 'string' } } } } } },
        responses: { 200: { description: 'JWT issued' }, 401: err('Invalid credentials') },
      },
    },
    '/v1/reference/areas': {
      get: {
        tags: ['Reference'], summary: 'Nigerian states and LGAs (public) for dropdowns and suggestions',
        description: 'Without parameters returns every state with its LGAs. With `state` returns that state only. Any area may still be entered by hand.',
        parameters: [{ name: 'state', in: 'query', schema: { type: 'string' }, example: 'Nasarawa' }],
        responses: { 200: { description: 'States / LGAs' }, 404: err('Unknown state') },
      },
    },
    '/v1/reference/consent': {
      get: {
        tags: ['Reference'], summary: 'Farmer consent text (public)',
        description: 'Returns the versioned consent text and the agent read-aloud script. Languages without a reviewed translation are served in English (`textLanguage` says what was actually returned, `needsTranslation` is true). `incomplete` is true while the operator has not filled the contact/retention/hosting details.',
        parameters: [
          { name: 'lang', in: 'query', schema: { type: 'string', enum: ['en', 'ha', 'yo', 'ig', 'tiv', 'pcm'], default: 'en' } },
          { name: 'version', in: 'query', schema: { type: 'string', example: 'consent-v1-draft' } },
        ],
        responses: { 200: { description: 'Consent text', content: { 'application/json': { schema: { $ref: '#/components/schemas/ConsentText' } } } }, 400: err('Unknown language or version') },
      },
    },
    '/v1/me/api-keys': {
      get: { tags: ['Partners & keys'], summary: 'Your organisation\'s keys (partner users)', security: bearerJwt, responses: { 200: { description: 'Keys (prefix only)' } } },
      post: { tags: ['Partners & keys'], summary: 'Create a test-mode key for your organisation (max 5 active; shown once)', security: bearerJwt, responses: { 201: { description: 'Created' }, 409: err('Key limit reached') } },
    },
    '/v1/me/api-keys/{id}/revoke': { post: { tags: ['Partners & keys'], summary: 'Revoke one of your keys', security: bearerJwt, parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Revoked' } } } },
    '/v1/partners/{partnerId}/reject': { post: { tags: ['Partners & keys'], summary: 'Reject a pending partner (super admin)', security: bearerJwt, parameters: [{ name: 'partnerId', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Rejected' } } } },
    '/v1/auth/signup': {
      post: {
        tags: ['Auth'], summary: 'Request access for an organisation (bank, programme, insurer...)',
        description: 'Creates a pending partner and user. They cannot sign in until a super admin calls POST /v1/partners/{id}/approve.',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['organization', 'name', 'email', 'password'], properties: { organization: { type: 'string' }, type: { type: 'string' }, name: { type: 'string' }, email: { type: 'string' }, password: { type: 'string', minLength: 12 } } } } } },
        responses: { 201: { description: 'Request received' }, 400: err('Validation error'), 409: err('Email already in use') },
      },
    },
    '/v1/partners/{partnerId}/approve': {
      post: { tags: ['Partners & keys'], summary: 'Approve a pending partner and its users (super admin)', security: bearerJwt, parameters: [{ name: 'partnerId', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Approved' }, 409: err('Not pending') } },
    },
    '/v1/farmers': {
      post: {
        tags: ['Farmers'], summary: 'Register a farmer and farm (field agent / data manager / admin)', security: bearerJwt,
        description: 'Consent is required, and so is either `phone` or `contactVia` (a person who can reach the farmer). The FarmasLog ID, not the phone, identifies the farmer. A phone may be shared: a different person on the same number is registered normally and both records get `sharedPhone: true`. Only the same name + LGA + phone (or, with no phone, name + LGA + community) is a duplicate: it goes to duplicate review and the FarmasLog ID is withheld.',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/RegisterFarmer' } } } },
        responses: { 201: { description: 'Registered (pending review)' }, 400: err('Validation error'), 403: err('Role not allowed') },
      },
      get: {
        tags: ['Farmers'], summary: 'List farmers (paginated; field agents see only their own)', security: bearerJwt,
        parameters: ['state', 'lga', 'ward', 'status', 'phone', 'page', 'limit'].map((n) => ({ name: n, in: 'query', schema: { type: 'string' } })),
        responses: { 200: { description: 'Page of farmers' } },
      },
    },
    '/v1/farmers/{id}': {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      get: { tags: ['Farmers'], summary: 'Get one farmer', security: bearerJwt, responses: { 200: { description: 'Farmer and farm' }, 404: err('Not found') } },
      patch: { tags: ['Farmers'], summary: 'Update (audited; data manager / super admin)', security: bearerJwt, description: 'Send `phone: null` to remove the phone (a `contactVia` must remain). `sharedPhone` can be corrected by hand here.', requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string' }, phone: { type: 'string', nullable: true }, contactVia: { $ref: '#/components/schemas/ContactVia' }, sharedPhone: { type: 'boolean' }, state: { type: 'string' }, lga: { type: 'string' }, ward: { type: 'string' }, community: { type: 'string' } } } } } }, responses: { 200: { description: 'Updated' }, 400: err('Invalid phone, or a farmer would be left with no phone and no contact person') } },
    },
    '/v1/farmers/{id}/review': {
      post: {
        tags: ['Farmers'], summary: 'Approve or reject a pending/duplicate record', security: bearerJwt,
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['decision'], properties: { decision: { type: 'string', enum: ['approve', 'reject'] }, note: { type: 'string' } } } } } },
        responses: { 200: { description: 'Reviewed' }, 409: err('Invalid state, or an active record with the same name, LGA and phone already exists') },
      },
    },
    '/v1/farmers/{id}/field-verification': {
      post: {
        tags: ['Farmers'], summary: 'Record a field verification outcome', security: bearerJwt,
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Evidence status recalculated' }, 409: err('Rejected record or consent withdrawn') },
      },
    },
    '/v1/farmers/{id}/consent-withdrawal': {
      post: {
        tags: ['Farmers'], summary: 'Withdraw a farmer\'s consent (staff)', security: bearerJwt,
        description: 'Sets `consentStatus: withdrawn`. The record is immediately hidden from partner verification, cannot be approved, enriched or field-verified, and the change is audited (the free-text reason is stored on the record, never in the audit log). Erasure is a manual super-admin task, see docs/OPERATIONS.md.',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { reason: { type: 'string', maxLength: 300 } } } } } },
        responses: { 200: { description: 'Withdrawn' }, 403: err('Role not allowed'), 409: err('Already withdrawn') },
      },
    },
    '/v1/farmers/{id}/reconsent': {
      post: {
        tags: ['Farmers'], summary: 'Record fresh consent (clears needs_reconsent or withdrawn)', security: bearerJwt,
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['consent'], properties: { consent: { $ref: '#/components/schemas/ConsentInput' } } } } } },
        responses: { 200: { description: 'Consent recorded, consentStatus valid' }, 400: err('Must use the current consent version') },
      },
    },
    '/v1/farmers/{id}/enrich': {
      post: {
        tags: ['Farmers'], summary: 'Queue geocoding/satellite enrichment (async)', security: bearerJwt,
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 202: { description: 'Queued' } },
      },
    },
    '/v1/farmers/{id}/files': {
      post: {
        tags: ['Farmers'], summary: 'Upload evidence (JPEG, PNG or PDF, max 5 MB)', security: bearerJwt,
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { content: { 'multipart/form-data': { schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } } } },
        responses: { 201: { description: 'Stored privately' }, 400: err('Bad type, size or content') },
      },
    },
    '/v1/partners': {
      post: { tags: ['Partners & keys'], summary: 'Create partner (super admin)', security: bearerJwt, responses: { 201: { description: 'Created' } } },
      get: { tags: ['Partners & keys'], summary: 'List partners', security: bearerJwt, responses: { 200: { description: 'OK' } } },
    },
    '/v1/auth/agent-signup': { post: { tags: ['Auth'], summary: 'Apply to become a field agent (stays pending until a super admin approves)', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['name', 'email', 'phone', 'state', 'lga', 'password'], properties: { name: { type: 'string' }, email: { type: 'string' }, phone: { type: 'string' }, state: { type: 'string' }, lga: { type: 'string' }, password: { type: 'string', minLength: 12 } } } } } }, responses: { 201: { description: 'Application received' }, 409: err('Email already in use') } } },
    '/v1/staff/{id}/approve': { post: { tags: ['Team'], summary: 'Approve a pending field-agent application (super admin)', security: bearerJwt, parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Approved' }, 409: err('Not pending') } } },
    '/v1/staff/{id}/reject': { post: { tags: ['Team'], summary: 'Reject a pending field-agent application (super admin)', security: bearerJwt, parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Rejected' }, 409: err('Not pending') } } },
    '/v1/auth/change-password': { post: { tags: ['Auth'], summary: 'Change your own password (also how a new team member replaces a temporary one)', security: bearerJwt, requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['currentPassword', 'newPassword'], properties: { currentPassword: { type: 'string' }, newPassword: { type: 'string', minLength: 12 } } } } } }, responses: { 200: { description: 'Updated' }, 400: err('Wrong current password, or new password too short or unchanged') } } },
    '/v1/staff': {
      get: { tags: ['Team'], summary: 'List FarmasLog team members (super admin)', security: bearerJwt, responses: { 200: { description: 'OK' } } },
      post: { tags: ['Team'], summary: 'Onboard a team member with a one-time temporary password (super admin)', security: bearerJwt, requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['name', 'email', 'role'], properties: { name: { type: 'string' }, email: { type: 'string' }, role: { type: 'string', enum: ['data_manager', 'field_agent', 'finance', 'auditor'] } } } } } }, responses: { 201: { description: 'Created; response includes the temporary password once' }, 409: err('Email already in use') } },
    },
    '/v1/staff/{id}/reset-password': { post: { tags: ['Team'], summary: 'Issue a new temporary password (super admin)', security: bearerJwt, parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Reset; response includes the temporary password once' } } } },
    '/v1/staff/{id}/status': { post: { tags: ['Team'], summary: 'Disable or re-enable a team member (super admin)', security: bearerJwt, parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['status'], properties: { status: { type: 'string', enum: ['active', 'disabled'] } } } } } }, responses: { 200: { description: 'Updated' } } } },
    '/v1/users': { post: { tags: ['Partners & keys'], summary: 'Create a user (super admin)', security: bearerJwt, responses: { 201: { description: 'Created' } } } },
    '/v1/partners/{partnerId}/api-keys': {
      parameters: [{ name: 'partnerId', in: 'path', required: true, schema: { type: 'string' } }],
      post: { tags: ['Partners & keys'], summary: 'Create API key (secret shown once)', security: bearerJwt, responses: { 201: { description: 'Created; response includes the key once' } } },
      get: { tags: ['Partners & keys'], summary: 'List keys (prefix only)', security: bearerJwt, responses: { 200: { description: 'OK' } } },
    },
    '/v1/api-keys/{keyId}/revoke': { post: { tags: ['Partners & keys'], summary: 'Revoke key', security: bearerJwt, parameters: [{ name: 'keyId', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Revoked' } } } },
    '/v1/api-keys/{keyId}/rotate': { post: { tags: ['Partners & keys'], summary: 'Rotate key with optional grace period', security: bearerJwt, parameters: [{ name: 'keyId', in: 'path', required: true, schema: { type: 'string' } }], responses: { 201: { description: 'New key issued once' } } } },
    '/v1/usage': { get: { tags: ['Reporting'], summary: 'Usage by partner, plan and period', security: bearerJwt, responses: { 200: { description: 'OK' } } } },
    '/v1/verification-logs': { get: { tags: ['Reporting'], summary: 'Verification request log', security: bearerJwt, responses: { 200: { description: 'OK' } } } },
    '/v1/audit-logs': { get: { tags: ['Reporting'], summary: 'Audit trail (admin, auditor)', security: bearerJwt, responses: { 200: { description: 'OK' } } } },
    '/v1/webhooks/paystack': {
      post: {
        tags: ['Webhooks'], summary: 'Paystack events (signature verified, idempotent)',
        description: 'Verifies `x-paystack-signature` (HMAC-SHA512) against the raw body. Duplicate events are acknowledged without reprocessing.',
        responses: { 200: { description: 'Accepted' }, 401: err('Bad signature') },
      },
    },
  },
  components: {
    securitySchemes: {
      apiKey: { type: 'http', scheme: 'bearer', description: 'Partner API key, e.g. sk_test_ab12cd34_...' },
      jwt: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    },
    schemas: {
      Error: { type: 'object', properties: { errorCode: { type: 'string' }, message: { type: 'string' }, requestId: { type: 'string' }, retryAfterSeconds: { type: 'integer' }, details: { type: 'array', items: { type: 'string' } } } },
      VerifyResult: {
        type: 'object',
        properties: {
          verificationStatus: { type: 'string', enum: ['verified', 'record_found', 'review_required'], description: "'verified' only after a field review." },
          farmaslogId: { type: 'string' },
          location: { type: 'object', properties: { state: { type: 'string' }, lga: { type: 'string' }, ward: { type: 'string', nullable: true }, community: { type: 'string', nullable: true } } },
          crop: { type: 'string' },
          reportedArea: { type: 'object', nullable: true, properties: { value: { type: 'number' }, unit: { type: 'string' } } },
          estimatedArea: { type: 'object', nullable: true },
          areaDiscrepancy: { type: 'boolean', nullable: true },
          evidenceStatus: { type: 'string', enum: ['pending', 'self_reported', 'satellite_signal', 'field_verified', 'needs_review'] },
          evidenceMessage: { type: 'string' },
          locationConfirmation: { type: 'string', enum: ['confirmed_by_field_agent', 'unconfirmed', 'not_provided'], description: 'Records are verifiable whether or not a field agent has confirmed the GPS. Apply your own policy using this and `limitations`.' },
          limitations: { type: 'array', items: { type: 'string', enum: ['location_not_confirmed_by_field_agent', 'area_self_reported'] } },
          enrichmentState: { type: 'string', enum: ['not_assessed', 'pending', 'completed', 'insufficient_imagery', 'failed'] },
          confidence: { type: 'number', nullable: true },
          lastUpdated: { type: 'string', format: 'date-time' },
          requestId: { type: 'string' },
        },
      },
      ConsentInput: {
        type: 'object', required: ['given', 'wordingVersion'],
        description: 'Send the version and language of the text that was actually shown (GET /v1/reference/consent). Unknown versions are rejected. The current version also requires `method` and `partnerSharing`. Legacy versions (console-draft-v0, qservers-form-v1) are accepted only for imports and are flagged needs_reconsent.',
        properties: {
          given: { type: 'boolean', enum: [true] },
          wordingVersion: { type: 'string', enum: ['consent-v1-draft', 'console-draft-v0', 'qservers-form-v1'] },
          language: { type: 'string', enum: ['en', 'ha', 'yo', 'ig', 'tiv', 'pcm'], default: 'en' },
          method: { type: 'string', enum: ['agent_read_aloud', 'agent_checkbox', 'self_checkbox'] },
          partnerSharing: { type: 'boolean', description: 'Second agreement box. If false the record is never returned to partners.' },
          mediaStorage: { type: 'boolean', default: false, description: 'Optional third agreement box (photos/documents).' },
        },
      },
      ConsentText: {
        type: 'object',
        properties: {
          version: { type: 'string' }, language: { type: 'string' }, textLanguage: { type: 'string', description: 'Language of the text shown. English until a reviewed translation exists.' },
          needsTranslation: { type: 'boolean' }, title: { type: 'string' },
          sections: { type: 'array', items: { type: 'object', properties: { heading: { type: 'string' }, body: { type: 'string' } } } },
          text: { type: 'string' }, agreementsIntro: { type: 'string' },
          agreements: { type: 'object', properties: { core: { type: 'string' }, partnerSharing: { type: 'string' }, mediaStorage: { type: 'string' } } },
          readAloud: { type: 'string' }, agentNote: { type: 'string' },
          incomplete: { type: 'boolean', description: 'True while placeholders such as [registered address] are unfilled.' },
          missingPlaceholders: { type: 'array', items: { type: 'string' } },
        },
      },
      ContactVia: {
        type: 'object', required: ['type'], nullable: true,
        description: 'A person who can reach the farmer. Their number is never used to look the farmer up. `phone` is required unless `type` is `agent`.',
        properties: { type: { type: 'string', enum: ['farmer', 'relative', 'cooperative_leader', 'agent'] }, name: { type: 'string' }, phone: { type: 'string' }, relationship: { type: 'string' } },
      },
      RegisterFarmer: {
        type: 'object',
        required: ['name', 'state', 'lga', 'consent', 'farm'],
        description: 'Provide `phone` and/or `contactVia`: at least one is required.',
        properties: {
          name: { type: 'string' }, phone: { type: 'string' }, contactVia: { $ref: '#/components/schemas/ContactVia' }, state: { type: 'string' }, lga: { type: 'string' },
          ward: { type: 'string' }, community: { type: 'string' },
          consent: { $ref: '#/components/schemas/ConsentInput' },
          farm: { type: 'object', required: ['crop'], properties: { crop: { type: 'string' }, reportedAreaHa: { type: 'number' }, location: { type: 'object', properties: { lat: { type: 'number' }, lng: { type: 'number' }, source: { type: 'string' }, accuracyMeters: { type: 'number' } } } } },
        },
      },
    },
  },
};
