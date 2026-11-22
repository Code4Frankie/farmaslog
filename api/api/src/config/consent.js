// Versioned consent texts. PURE module: no env, no database. Placeholders look like {{registeredAddress}} and are
// filled by services/consent.service.js from environment variables; anything unset renders as "[registered address]"
// so an unfinished text is obvious on screen (and flagged with `incomplete: true`).
//
// Bump the version whenever the wording changes. Old versions stay in LEGACY_VERSIONS / TEXTS so existing records can
// still be explained, but only CURRENT_CONSENT_VERSION is accepted for NEW registrations.

export const CURRENT_CONSENT_VERSION = 'consent-v1-draft';
// Wordings used before this system existed. Records carrying them are flagged "needs_reconsent" by the migration.
export const LEGACY_VERSIONS = ['console-draft-v0', 'qservers-form-v1'];
export const KNOWN_VERSIONS = [CURRENT_CONSENT_VERSION, ...LEGACY_VERSIONS];

export const LANGUAGES = ['en', 'ha', 'yo', 'ig', 'pcm'];
export const LANGUAGE_NAMES = { en: 'English', ha: 'Hausa', yo: 'Yoruba', ig: 'Igbo', pcm: 'Nigerian Pidgin' };
export const CONSENT_METHODS = ['agent_read_aloud', 'agent_checkbox', 'self_checkbox'];
export const CONSENT_STATUSES = ['valid', 'needs_reconsent', 'withdrawn'];

export const PLACEHOLDERS = {
  registeredAddress: { label: 'registered address', env: 'CONSENT_REGISTERED_ADDRESS' },
  email: { label: 'email', env: 'CONSENT_CONTACT_EMAIL' },
  phone: { label: 'phone number', env: 'CONSENT_CONTACT_PHONE' },
  whatsapp: { label: 'WhatsApp number', env: 'CONSENT_CONTACT_WHATSAPP' },
  retention: { label: 'retention period', env: 'CONSENT_RETENTION_PERIOD' },
  hosting: { label: 'hosting provider/country', env: 'CONSENT_HOSTING' },
};

const EN_V1 = {
  title: 'FarmasLog: Farmer consent',
  sections: [
    { heading: 'Who we are.', body: 'FarmasLog is run by Frankiecode Solutions, {{registeredAddress}}. We keep a record of smallholder farmers so that banks, insurers and farming programmes can check that a farmer is real and where the farm is. You can contact us at {{email}}, {{phone}} or {{whatsapp}}.' },
    { heading: 'What we collect.', body: 'Your name, your phone number (if you have one) or the contact of someone who can reach you, your state, local government area and community, your main crop, the size of your farm, and where your farm is (GPS location, if you or an agent record it). You may also choose to tell us your gender and age group. You do not have to answer those questions. If a FarmasLog agent visits your farm, they may take a GPS reading and, with your permission, a photo or document.' },
    { heading: 'What we do not collect.', body: 'We do not ask for your BVN, NIN, bank details, date of birth or proof of land ownership.' },
    { heading: 'Why we collect it.', body: 'To create a FarmasLog record for you and to help organisations that work with farmers confirm that your record exists and how strong the evidence is. We do not sell your data.' },
    { heading: 'Who can see it.', body: 'FarmasLog staff and agents who need it to do their job. Approved partner organisations (banks, insurers, programmes and cooperatives) can check whether your record exists. They can see your crop, your approximate location and how well your record is backed up. They can see your exact farm coordinates only if they have been given that access. They do not see your gender or age group.' },
    { heading: 'Being on the record is not a loan.', body: 'Being on FarmasLog does not guarantee a loan, insurance or any programme benefit. A lender makes its own decision.' },
    { heading: 'How long we keep it.', body: 'For as long as your record is active, and up to {{retention}} after that, unless you ask us to delete it sooner or the law requires us to keep it.' },
    { heading: 'Your choices and rights.', body: 'Saying yes is voluntary. You can say no and nothing bad happens to you. You can ask to see your record, to correct it, to withdraw your consent or to have it deleted, by contacting us using the details above or by telling a FarmasLog agent. If you withdraw consent, we stop sharing your record with partners. You can also complain to the Nigeria Data Protection Commission.' },
    { heading: 'Storage.', body: 'Your data is stored securely on {{hosting}}. We protect it with access controls and keep a record of who views or changes it.' },
  ],
  agreementsIntro: 'Your agreement. Tick the box only if you understand the above and agree:',
  agreements: {
    core: 'I have read, or had read to me, how FarmasLog will use my information, and I agree to it.',
    partnerSharing: 'I agree that approved partners can check whether my record exists and see the information described above.',
    mediaStorage: '(Optional) I agree that FarmasLog may keep photos or documents I give to support my record.',
  },
  readAloud: 'I work with FarmasLog. We keep a record of farmers so that banks and farming programmes can confirm you are a real farmer and where your farm is. I will write down your name, phone number or a contact person, where you live, your crop and your farm size. If I visit your farm, I will take its GPS location. You do not have to answer any question, and you can say no. Banks and programmes we approve can check that your record exists, your crop and your approximate location. We do not sell your information. Being on the list does not promise a loan. You can ask to see, correct or delete your record at any time by telling an agent or calling {{phone}}. Do you understand, and are you happy for me to register you?',
  agentNote: 'The agent should tick the consent box only after a clear yes, and should record the language used.',
};

// Other languages: placeholders until a person has translated AND back-translated them. Until `needsTranslation`
// is removed the API serves the English text (textLanguage 'en') so no unreviewed translation is ever shown.
const todo = { needsTranslation: true };
export const TEXTS = {
  [CURRENT_CONSENT_VERSION]: { en: EN_V1, ha: todo, yo: todo, ig: todo, pcm: todo },
};

const esc = (s) => String(s);

/** Replace {{tokens}}. `values` maps token -> string. Unset tokens become "[label]". Returns { text, missing }. */
export function fillPlaceholders(text, values = {}) {
  const missing = new Set();
  const out = esc(text).replace(/\{\{(\w+)\}\}/g, (_m, key) => {
    const v = String(values[key] ?? '').trim();
    if (v) return v;
    missing.add(key);
    return `[${PLACEHOLDERS[key]?.label ?? key}]`;
  });
  return { text: out, missing: [...missing] };
}

export function isKnownVersion(v) { return KNOWN_VERSIONS.includes(v); }
export function isLegacyVersion(v) { return LEGACY_VERSIONS.includes(v); }

/**
 * Build the consent payload for a version + language.
 * Returns { version, language (requested), textLanguage (actually shown), needsTranslation, title, sections,
 * text (flat string), agreements, agentNote, readAloud, incomplete, missingPlaceholders }.
 */
export function renderConsent({ version = CURRENT_CONSENT_VERSION, language = 'en', values = {} } = {}) {
  const byLang = TEXTS[version];
  if (!byLang) return null;
  const lang = LANGUAGES.includes(language) ? language : 'en';
  const wanted = byLang[lang];
  const shown = wanted && !wanted.needsTranslation ? wanted : byLang.en;
  const textLanguage = shown === byLang.en ? 'en' : lang;
  const missing = new Set();
  const fill = (s) => { const r = fillPlaceholders(s, values); r.missing.forEach((m) => missing.add(m)); return r.text; };

  const sections = shown.sections.map((s) => ({ heading: s.heading, body: fill(s.body) }));
  const readAloud = fill(shown.readAloud);
  const agreements = { ...shown.agreements };
  const text = [shown.title, ...sections.map((s) => `${s.heading} ${s.body}`), shown.agreementsIntro,
    ...Object.values(agreements).map((a) => `[ ] ${a}`)].join('\n\n');
  return {
    version, language: lang, textLanguage,
    needsTranslation: !!wanted?.needsTranslation && lang !== 'en',
    title: shown.title, sections, text, agreementsIntro: shown.agreementsIntro, agreements,
    readAloud, agentNote: shown.agentNote,
    incomplete: missing.size > 0, missingPlaceholders: [...missing],
  };
}
