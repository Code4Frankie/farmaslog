// Small RFC-4180 reader/writer. The writer neutralises spreadsheet formulas (values starting with = + - @)
// so a malicious name cannot execute when someone opens a rejects/report file in Excel.
export function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  const src = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ''));
}

export function csvEscape(v, neutralise = true) {
  let s = String(v ?? '');
  if (neutralise && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
// neutralise=false writes values verbatim (what PHP's fputcsv does); use it only for fixtures that mimic the website.
export const toCsv = (rows, { neutralise = true } = {}) => rows.map((r) => r.map((v) => csvEscape(v, neutralise)).join(',')).join('\n') + '\n';

// -> array of {column: value} objects
export function readObjects(text) {
  const [header, ...lines] = parseCsv(text).map((r) => r.map((x) => x.trim()));
  return { header: header ?? [], rows: lines.map((cells) => Object.fromEntries((header ?? []).map((h, k) => [h, cells[k] ?? '']))) };
}
