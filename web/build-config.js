// Vercel build step: copies the site to dist/ and writes config.js from the FARMASLOG_API_URL environment variable.
// Not set -> demo mode (sample data, no server). No secrets are involved: the API URL is public.
const fs = require('fs');
const path = require('path');

const url = (process.env.FARMASLOG_API_URL || '').trim().replace(/\/+$/, '');
if (url && !/^(https:\/\/[^\s"'<>\\]+|http:\/\/localhost(:\d+)?)$/.test(url)) {
  console.error(`FARMASLOG_API_URL must be an https URL (or http://localhost:PORT). Got: ${url}`);
  process.exit(1);
}
const dist = path.join(__dirname, 'dist');
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist);
for (const f of ['index.html', 'styles.css', 'app.js', 'areas.json']) fs.copyFileSync(path.join(__dirname, f), path.join(dist, f));
fs.writeFileSync(path.join(dist, 'config.js'), `window.FARMASLOG_CONFIG = ${JSON.stringify({ apiUrl: url })};\n`);
console.log(url ? `Built for API: ${url}` : 'Built in DEMO mode (FARMASLOG_API_URL is not set)');
