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
        description: 'Provide exactly one of `phone` or `farmaslogId`. `state` and `lga` optionally narrow the match. Billable only on 200.',
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
        description: 'Consent is required. A matching active/pending phone number sends the record to duplicate review and withholds the FarmasLog ID.',
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
      patch: { tags: ['Farmers'], summary: 'Update (audited)', security: bearerJwt, responses: { 200: { description: 'Updated' }, 409: err('Phone already in use') } },
    },
    '/v1/farmers/{id}/review': {
      post: {
        tags: ['Farmers'], summary: 'Approve or reject a pending/duplicate record', security: bearerJwt,
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['decision'], properties: { decision: { type: 'string', enum: ['approve', 'reject'] }, note: { type: 'string' } } } } } },
        responses: { 200: { description: 'Reviewed' }, 409: err('Invalid state or duplicate phone') },
      },
    },
    '/v1/farmers/{id}/field-verification': {
      post: {
        tags: ['Farmers'], summary: 'Record a field verification outcome', security: bearerJwt,
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Evidence status recalculated' } },
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
      RegisterFarmer: {
        type: 'object',
        required: ['name', 'phone', 'state', 'lga', 'consent', 'farm'],
        properties: {
          name: { type: 'string' }, phone: { type: 'string' }, state: { type: 'string' }, lga: { type: 'string' },
          ward: { type: 'string' }, community: { type: 'string' },
          consent: { type: 'object', required: ['given', 'wordingVersion'], properties: { given: { type: 'boolean' }, wordingVersion: { type: 'string' } } },
          farm: { type: 'object', required: ['crop'], properties: { crop: { type: 'string' }, reportedAreaHa: { type: 'number' }, location: { type: 'object', properties: { lat: { type: 'number' }, lng: { type: 'number' }, source: { type: 'string' }, accuracyMeters: { type: 'number' } } } } },
        },
      },
    },
  },
};
