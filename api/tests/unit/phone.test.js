import { normalizeNigerianPhone } from '../../src/utils/phone.js';

test.each([
  ['08012345678', '+2348012345678'],
  ['8012345678', '+2348012345678'],
  ['+2348012345678', '+2348012345678'],
  [' 2348012345678', '+2348012345678'], // "+" decoded to a space by a query string
  ['0801 234 5678', '+2348012345678'],
  ['0901-234-5678', '+2349012345678'],
])('normalizes %s', (input, expected) => expect(normalizeNigerianPhone(input)).toBe(expected));

test.each(['', '12345', '0201234567', '+44 7911 123456', 'abc', '0801234567', '080123456789', null, undefined])(
  'rejects %p', (input) => expect(normalizeNigerianPhone(input)).toBeNull());
