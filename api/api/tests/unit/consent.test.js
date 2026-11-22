import { renderConsent, fillPlaceholders, isKnownVersion, isLegacyVersion, CURRENT_CONSENT_VERSION, LANGUAGES } from '../../src/config/consent.js';

const ALL = { registeredAddress: 'A', email: 'e@x.ng', phone: '0700', whatsapp: '0800', retention: '5 years', hosting: 'Host, NG' };

describe('consent texts', () => {
  test('current version renders in English with every placeholder filled', () => {
    const c = renderConsent({ values: ALL });
    expect(c).toMatchObject({ version: CURRENT_CONSENT_VERSION, language: 'en', textLanguage: 'en', incomplete: false, needsTranslation: false });
    expect(c.text).not.toMatch(/\{\{|\[registered address\]/);
    expect(c.sections.length).toBeGreaterThan(5);
    expect(Object.keys(c.agreements)).toEqual(['core', 'partnerSharing', 'mediaStorage']);
    expect(c.readAloud).toMatch(/0700/);
  });
  test('unset placeholders show as visible [brackets] and mark the text incomplete', () => {
    const c = renderConsent({ values: {} });
    expect(c.incomplete).toBe(true);
    expect(c.text).toContain('[registered address]');
    expect(c.missingPlaceholders).toEqual(expect.arrayContaining(['email', 'retention', 'hosting']));
  });
  test.each(['ha', 'yo', 'ig', 'pcm'])('%s is an untranslated placeholder: English is served and flagged', (lang) => {
    const c = renderConsent({ language: lang, values: ALL });
    expect(c).toMatchObject({ language: lang, textLanguage: 'en', needsTranslation: true });
  });
  test('unknown language falls back to English; unknown version returns null', () => {
    expect(renderConsent({ language: 'xx', values: ALL }).language).toBe('en');
    expect(renderConsent({ version: 'nope' })).toBeNull();
  });
  test('version helpers', () => {
    expect(isKnownVersion('console-draft-v0')).toBe(true);
    expect(isLegacyVersion('console-draft-v0')).toBe(true);
    expect(isLegacyVersion(CURRENT_CONSENT_VERSION)).toBe(false);
    expect(isKnownVersion('v1')).toBe(false);
    expect(LANGUAGES).toEqual(['en', 'ha', 'yo', 'ig', 'pcm']);
  });
  test('fillPlaceholders leaves other text alone', () => {
    expect(fillPlaceholders('call {{phone}} now', { phone: '1' }).text).toBe('call 1 now');
  });
});
