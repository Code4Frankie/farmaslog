import crypto from 'node:crypto';

// Crockford-style alphabet: no I, L, O, U
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const FARMASLOG_ID_RE = /^FL-[0-9A-HJKMNP-TV-Z]{8}$/;

export function generateFarmaslogId() {
  let s = '';
  for (let i = 0; i < 8; i++) s += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return `FL-${s}`;
}
