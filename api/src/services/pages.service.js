import { PolicyPage } from '../models/PolicyPage.js';
import { AppError } from '../utils/AppError.js';
import { writeAudit } from './audit.service.js';
import { consentDetails } from './settings.service.js';
import { fillPlaceholders } from '../config/consent.js';
import { PAGE_NAMES, PAGE_SLUGS, STARTERS } from '../config/pages.js';

const sections = (list) => list.map((s) => ({ heading: s.heading, body: s.body }));
const fillAll = (title, secs) => {
  const values = consentDetails(); const missing = new Set();
  const fill = (t) => { const r = fillPlaceholders(t, values); r.missing.forEach((m) => missing.add(m)); return r.text; };
  return { title: fill(title), sections: secs.map((s) => ({ heading: fill(s.heading), body: fill(s.body) })), missing: [...missing] };
};
const find = (slug) => PolicyPage.findOne({ slug });

export async function listPages() {
  const rows = await PolicyPage.find().lean();
  return PAGE_SLUGS.map((slug) => {
    const r = rows.find((x) => x.slug === slug);
    return { slug, name: PAGE_NAMES[slug], publishedVersion: r?.published?.version ?? null, publishedAt: r?.published?.publishedAt ?? null, hasUnpublishedChanges: !!r?.draft?.title && (!r.published || JSON.stringify(r.draft.sections) !== JSON.stringify(r.published.sections) || r.draft.title !== r.published.title) };
  });
}

/** What the editor shows: the saved draft, else the published text, else the starter wording (flagged). */
export async function getPage(slug) {
  const r = (await find(slug))?.toObject();
  const src = r?.draft?.title ? r.draft : r?.published ?? STARTERS[slug];
  const filled = fillAll(src.title, src.sections);
  return {
    slug, name: PAGE_NAMES[slug], title: src.title, sections: sections(src.sections), isStarter: !r?.draft?.title && !r?.published,
    published: r?.published ? { version: r.published.version, publishedAt: r.published.publishedAt } : null,
    history: (r?.history ?? []).map((h) => ({ version: h.version, publishedAt: h.publishedAt })),
    preview: { title: filled.title, sections: filled.sections }, missingPlaceholders: filled.missing,
  };
}

export async function savePageDraft(slug, input, ctx) {
  const row = await PolicyPage.findOneAndUpdate({ slug }, { $set: { draft: { title: input.title, sections: sections(input.sections), updatedAt: new Date(), updatedBy: ctx.actor?.id } } }, { upsert: true, returnDocument: 'after' });
  await writeAudit(ctx, { action: 'page.draft_saved', entityType: 'PolicyPage', entityId: row._id, changes: { slug, sectionCount: input.sections.length } });
  return getPage(slug);
}

export async function publishPage(slug, ctx) {
  const row = await find(slug);
  const src = row?.draft?.title ? row.draft : null;
  if (!src) throw new AppError(409, 'NOTHING_TO_PUBLISH', 'Save the page first. The starter text is not published until you save and publish it.');
  const { missing } = fillAll(src.title, src.sections);
  if (missing.length) throw new AppError(422, 'INCOMPLETE_DETAILS', 'Fill in the missing consent details before publishing.', { missing });
  const version = (row.published?.version ?? 0) + 1;
  const pub = { version, title: src.title, sections: sections(src.sections), publishedAt: new Date(), publishedBy: ctx.actor?.id };
  row.published = pub; row.history.push(pub);
  await row.save();
  await writeAudit(ctx, { action: 'page.published', entityType: 'PolicyPage', entityId: row._id, changes: { slug, version } });
  return getPage(slug);
}

/** Public: the published page with contact details filled in. */
export async function publicPage(slug) {
  const r = await PolicyPage.findOne({ slug }).lean();
  if (!r?.published) throw new AppError(404, 'PAGE_NOT_PUBLISHED', 'This page has not been published yet.');
  const f = fillAll(r.published.title, r.published.sections);
  return { slug, name: PAGE_NAMES[slug], version: r.published.version, publishedAt: r.published.publishedAt, title: f.title, sections: f.sections };
}
