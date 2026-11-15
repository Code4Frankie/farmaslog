import { generateKeyMaterial, parseKey, secretMatches } from '../../src/services/apiKey.service.js';

test('generated keys parse and verify; only a hash is derivable', () => {
  const m = generateKeyMaterial('test');
  expect(m.fullKey).toMatch(/^sk_test_[a-f0-9]{8}_[A-Za-z0-9_-]{43}$/);
  const p = parseKey(m.fullKey);
  expect(p.prefix).toBe(m.prefix);
  expect(secretMatches(p.secret, m.secretHash)).toBe(true);
  expect(m.secretHash).not.toContain(p.secret);
});
test('wrong secret fails', () => {
  const m = generateKeyMaterial('live');
  expect(secretMatches('x'.repeat(43), m.secretHash)).toBe(false);
  expect(secretMatches('x', undefined)).toBe(false);
});
test('malformed keys do not parse', () => {
  for (const bad of ['', 'sk_test_', 'sk_prod_ab12cd34_' + 'a'.repeat(43), 'Bearer abc', undefined]) expect(parseKey(bad)).toBeNull();
});
test('keys are unique', () => expect(generateKeyMaterial('test').fullKey).not.toBe(generateKeyMaterial('test').fullKey));
