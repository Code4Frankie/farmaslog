// Generates postman/FarmasLog-API.postman_collection.json. Run: npm run postman
import fs from 'node:fs';

const json = { 'Content-Type': 'application/json' };
const req = (name, method, path, { auth = 'jwt', body, query } = {}) => ({
  name,
  request: {
    method,
    header: body ? [{ key: 'Content-Type', value: 'application/json' }] : [],
    auth: auth === 'none' ? { type: 'noauth' } : { type: 'bearer', bearer: [{ key: 'token', value: auth === 'apiKey' ? '{{apiKey}}' : '{{token}}', type: 'string' }] },
    ...(body ? { body: { mode: 'raw', raw: JSON.stringify(body, null, 2) } } : {}),
    url: { raw: `{{baseUrl}}${path}${query ? '?' + query : ''}`, host: ['{{baseUrl}}'], path: path.split('/').filter(Boolean), ...(query ? { query: query.split('&').map((p) => ({ key: p.split('=')[0], value: p.split('=')[1] })) } : {}) },
  },
});

const collection = {
  info: { name: 'FarmasLog-API', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json', description: 'Set baseUrl, then log in to fill token. Use only test keys (sk_test_...) and synthetic phone numbers. Change the state, lga and community variables to demo any area.' },
  variable: [
    { key: 'baseUrl', value: 'http://localhost:3000' }, { key: 'token', value: '' }, { key: 'apiKey', value: '' },
    { key: 'state', value: 'Nasarawa' }, { key: 'lga', value: 'Awe' }, { key: 'community', value: 'Agwatashi' }, { key: 'farmerId', value: '' }, { key: 'partnerId', value: '' },
  ],
  item: [
    { name: 'Partner verification', item: [
      req('Verify by phone (200/404/429)', 'GET', '/v1/verify', { auth: 'apiKey', query: 'phone=08000000001&state={{state}}&lga={{lga}}' }),
      req('Verify by FarmasLog ID', 'GET', '/v1/verify', { auth: 'apiKey', query: 'farmaslogId=FL-00000000' }),
      req('Missing params (400)', 'GET', '/v1/verify', { auth: 'apiKey' }),
      req('No key (401)', 'GET', '/v1/verify', { auth: 'none', query: 'phone=08000000001' }),
    ] },
    { name: 'Auth', item: [
      { ...req('Login', 'POST', '/v1/auth/login', { auth: 'none', body: { email: 'admin@farmaslog.local', password: '<from seed output>' } }),
        event: [{ listen: 'test', script: { exec: ["const j = pm.response.json(); if (j.token) pm.collectionVariables.set('token', j.token);"] } }] },
      req('Me', 'GET', '/v1/auth/me'),
    ] },
    { name: 'Farmers', item: [
      req('Register farmer (synthetic)', 'POST', '/v1/farmers', { body: { name: 'Test Farmer', phone: '08000000002', state: '{{state}}', lga: '{{lga}}', community: '{{community}}', consent: { given: true, wordingVersion: 'v1' }, isSynthetic: true, farm: { crop: 'White yam', reportedAreaHa: 1.5, location: { lat: 7.0, lng: 9.0, source: 'farmer_pin', accuracyMeters: 20 } } } }),
      req('List farmers', 'GET', '/v1/farmers', { query: 'state={{state}}&lga={{lga}}&limit=25' }),
      req('Get farmer', 'GET', '/v1/farmers/{{farmerId}}'),
      req('Approve', 'POST', '/v1/farmers/{{farmerId}}/review', { body: { decision: 'approve' } }),
      req('Field verification', 'POST', '/v1/farmers/{{farmerId}}/field-verification', { body: { outcome: 'verified', method: 'site_visit', location: { lat: 7.0, lng: 9.0, accuracyMeters: 8 } } }),
      req('Queue enrichment', 'POST', '/v1/farmers/{{farmerId}}/enrich'),
    ] },
    { name: 'Partners & keys', item: [
      req('Create partner', 'POST', '/v1/partners', { body: { organization: 'Test Bank', type: 'bank', plan: 'free' } }),
      req('Create API key', 'POST', '/v1/partners/{{partnerId}}/api-keys', { body: { name: 'Sandbox', mode: 'test' } }),
      req('List keys', 'GET', '/v1/partners/{{partnerId}}/api-keys'),
    ] },
    { name: 'Reporting', item: [
      req('Usage', 'GET', '/v1/usage', { query: 'groupBy=month' }),
      req('Verification logs', 'GET', '/v1/verification-logs'),
      req('Audit logs', 'GET', '/v1/audit-logs'),
    ] },
  ],
};
fs.mkdirSync('postman', { recursive: true });
fs.writeFileSync('postman/FarmasLog-API.postman_collection.json', JSON.stringify(collection, null, 2));
console.log('Wrote postman/FarmasLog-API.postman_collection.json');
