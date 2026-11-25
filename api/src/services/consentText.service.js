import { ConsentVersion } from '../models/ConsentVersion.js';
import { Setting } from '../models/Setting.js';
import { Farmer } from '../models/Farmer.js';
import { AppError } from '../utils/AppError.js';
import { writeAudit } from './audit.service.js';
import { consentDetails } from './settings.service.js';
import { BUILT_IN_VERSION, EN_V1, LANGUAGES, LEGACY_VERSIONS, TEXTS, renderConsent } from '../config/consent.js';

// Consent wordings an administrator publishes from the dashboard. Published versions are cached in memory (loaded at start-up and
// updated on publish) so the consent text can still be built synchronously. Built-in wording stays available as the fallback.
const CURRENT_KEY = 'consentCurrentVersion';
let published = {}; // version -> { lang: content }   (only reviewed languages)
let current = BUILT_IN_VERSION;

const toLangs = (texts) => {
  const out = {};
  for (const [lang, t] of Object.entries(texts || {})) out[lang] = lang === 'en' || t.reviewed ? t : { needsTranslation: true };
  return out;
};

export async function loadConsentTexts() {
  const rows = await ConsentVersion.find({ status: 'published' }).lean();
  published = Object.fromEntries(rows.map((r) => [r.version, toLangs(r.texts)]));
  const cur = await Setting.findOne({ key: CURRENT_KEY }).lean();
  current = cur?.value?.version && (published[cur.value.version] || cur.value.version === BUILT_IN_VERSION) ? cur.value.version : BUILT_IN_VERSION;
}

export const currentVersion = () => current;
export const registry = () => ({ ...TEXTS, ...published });
export const hasVersion = (v) => Object.prototype.hasOwnProperty.call(registry(), v);
/** New consents must use the current wording. Wordings from before this system (imports) are also accepted and flagged for re-consent. */
export const isAcceptedVersion = (v) => v === current || LEGACY_VERSIONS.includes(v);

const clean = (t) => ({ title: t.title, sections: t.sections.map((s) => ({ heading: s.heading, body: s.body })), agreementsIntro: t.agreementsIntro, agreements: { ...t.agreements }, readAloud: t.readAloud, agentNote: t.agentNote ?? '' });
const nextVersionName = () => {
  const nums = Object.keys(registry()).map((v) => Number(/^consent-v(\d+)/.exec(v)?.[1] ?? 0));
  return `consent-v${Math.max(0, ...nums) + 1}`;
};

const langsOf = (texts) => Object.entries(texts || {}).map(([language, t]) => ({ language, reviewed: language === 'en' || !!t.reviewed, reviewedBy: t.reviewedBy ?? null }));

export async function listVersions() {
  const rows = await ConsentVersion.find().sort({ createdAt: -1 }).lean();
  const items = rows.map((r) => ({ version: r.version, status: r.status, current: r.version === current, builtIn: false, languages: langsOf(r.texts), notes: r.notes ?? null, publishedAt: r.publishedAt ?? null, reconsent: r.reconsent ?? null, flaggedCount: r.flaggedCount ?? null, createdAt: r.createdAt }));
  items.push({ version: BUILT_IN_VERSION, status: 'published', current: current === BUILT_IN_VERSION, builtIn: true, languages: [{ language: 'en', reviewed: true, reviewedBy: null }], notes: 'Wording that came with the system.', publishedAt: null, reconsent: null, flaggedCount: null });
  return { current, hasDraft: rows.some((r) => r.status === 'draft'), data: items };
}

const findVersion = async (version) => {
  const row = await ConsentVersion.findOne({ version });
  if (!row) throw new AppError(404, 'VERSION_NOT_FOUND', 'No such consent version.');
  return row;
};
const requireDraft = (row) => { if (row.status !== 'draft') throw new AppError(409, 'VERSION_PUBLISHED', 'A published consent wording cannot be changed. Start a new version instead.'); };

/** Full content of one version, plus a preview rendered with today's contact details. */
export async function getVersion(version, language = 'en') {
  let texts; let meta;
  if (version === BUILT_IN_VERSION) { texts = { en: EN_V1 }; meta = { version, status: 'published', builtIn: true, current: current === version }; }
  else { const row = await findVersion(version); texts = row.toObject().texts; meta = { version, status: row.status, builtIn: false, current: current === version, notes: row.notes ?? null, publishedAt: row.publishedAt ?? null }; }
  const lang = LANGUAGES.includes(language) ? language : 'en';
  const preview = renderConsent({ version, language: lang, values: consentDetails(), registry: { [version]: toLangs(texts) } });
  return { ...meta, languages: langsOf(texts), texts, preview };
}

export async function createDraft({ version, notes }, ctx) {
  if (await ConsentVersion.exists({ status: 'draft' })) throw new AppError(409, 'DRAFT_EXISTS', 'There is already a draft. Publish it or discard it first.');
  const name = version || nextVersionName();
  if (hasVersion(name)) throw new AppError(409, 'VERSION_EXISTS', `Version ${name} already exists.`);
  const base = (published[current]?.en && !published[current].en.needsTranslation ? published[current].en : null) || EN_V1;
  const row = await ConsentVersion.create({ version: name, status: 'draft', texts: { en: clean(base) }, notes, createdBy: ctx.actor?.id, updatedBy: ctx.actor?.id });
  await writeAudit(ctx, { action: 'consent_text.draft_created', entityType: 'ConsentVersion', entityId: row._id, changes: { version: name, copiedFrom: current } });
  return getVersion(name);
}

export async function saveLanguage(version, language, input, ctx) {
  const row = await findVersion(version);
  requireDraft(row);
  const { reviewed, reviewedBy, ...content } = input;
  const texts = { ...row.texts };
  texts[language] = language === 'en' ? content : { ...content, reviewed: !!reviewed, reviewedBy: reviewed ? reviewedBy : undefined };
  row.texts = texts; row.markModified('texts'); row.updatedBy = ctx.actor?.id;
  await row.save();
  // The text itself is not copied into the audit trail; the version and language say what changed.
  await writeAudit(ctx, { action: 'consent_text.draft_updated', entityType: 'ConsentVersion', entityId: row._id, changes: { version, language, reviewed: language === 'en' ? true : !!reviewed } });
  return getVersion(version, language);
}

export async function removeLanguage(version, language, ctx) {
  if (language === 'en') throw new AppError(400, 'ENGLISH_REQUIRED', 'The English text cannot be removed.');
  const row = await findVersion(version);
  requireDraft(row);
  const texts = { ...row.texts }; delete texts[language];
  row.texts = texts; row.markModified('texts'); await row.save();
  await writeAudit(ctx, { action: 'consent_text.draft_updated', entityType: 'ConsentVersion', entityId: row._id, changes: { version, language, removed: true } });
  return getVersion(version);
}

export async function discardDraft(version, ctx) {
  const row = await findVersion(version);
  requireDraft(row);
  await row.deleteOne();
  await writeAudit(ctx, { action: 'consent_text.draft_discarded', entityType: 'ConsentVersion', entityId: row._id, changes: { version } });
}

export async function publishVersion(version, { reconsent }, ctx) {
  const row = await findVersion(version);
  requireDraft(row);
  if (!row.texts?.en) throw new AppError(422, 'ENGLISH_REQUIRED', 'The English text is required before publishing.');
  // Farmers must never see "[retention period]" in a published text, so every language that will be served has to be complete.
  const reg = { [version]: toLangs(row.texts) };
  const missing = new Set();
  for (const [lang, t] of Object.entries(reg[version])) {
    if (t.needsTranslation) continue;
    renderConsent({ version, language: lang, values: consentDetails(), registry: reg }).missingPlaceholders.forEach((m) => missing.add(m));
  }
  if (missing.size) throw new AppError(422, 'INCOMPLETE_DETAILS', 'Fill in the missing consent details before publishing.', { missing: [...missing] });

  const previous = current;
  row.status = 'published'; row.publishedAt = new Date(); row.publishedBy = ctx.actor?.id; row.reconsent = reconsent;
  await row.save();
  await Setting.findOneAndUpdate({ key: CURRENT_KEY }, { value: { version }, updatedBy: ctx.actor?.id }, { upsert: true });
  published[version] = reg[version]; current = version;

  let flagged = 0;
  if (reconsent === 'flag') {
    // Only records that are valid now are flagged: withdrawn stays withdrawn, and records already on the new wording are left alone.
    const r = await Farmer.updateMany({ consentStatus: 'valid', 'consent.wordingVersion': { $ne: version } }, { $set: { consentStatus: 'needs_reconsent' } });
    flagged = r.modifiedCount ?? 0;
  }
  row.flaggedCount = flagged; await row.save();
  await writeAudit(ctx, { action: 'consent_text.published', entityType: 'ConsentVersion', entityId: row._id, changes: { version, previous, languages: langsOf(row.texts).filter((l) => l.reviewed).map((l) => l.language), reconsent, flaggedCount: flagged } });
  return { ...(await getVersion(version)), flaggedCount: flagged };
}
