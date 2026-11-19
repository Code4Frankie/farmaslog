import { env } from '../config/env.js';

function write(level, msg, meta) {
  if (env.isTest) return;
  const line = JSON.stringify({ level, time: new Date().toISOString(), msg, ...meta });
  (level === 'error' ? console.error : console.log)(line);
}
export const logger = {
  info: (m, x) => write('info', m, x),
  warn: (m, x) => write('warn', m, x),
  error: (m, x) => write('error', m, x),
};
