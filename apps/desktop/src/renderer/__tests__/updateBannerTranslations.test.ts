import { createInstance } from 'i18next';
import { describe, expect, it } from 'vitest';
import en from '../i18n/locales/en/common.json';
import zhCN from '../i18n/locales/zh-CN/common.json';
import zhTW from '../i18n/locales/zh-TW/common.json';
import ja from '../i18n/locales/ja/common.json';
import ko from '../i18n/locales/ko/common.json';

// Real locale lookup: mocked t() in component tests cannot detect misplaced keys.
describe('personal update banner translations', () => {
  for (const [lng, common] of Object.entries({ en, 'zh-CN': zhCN, 'zh-TW': zhTW, ja, ko })) {
    it(`renders readable failure and fallback text in ${lng}`, async () => {
      const i18n = createInstance();
      await i18n.init({ lng, fallbackLng: false, resources: { [lng]: { translation: common } } });
      for (const suffix of ['personalFailureTitle', 'personalFailureDescription', 'personalRetry']) {
        const key = `update.banner.${suffix}`;
        expect(i18n.exists(key)).toBe(true);
        expect(i18n.t(key)).not.toBe(key);
      }
      const key = 'update.banner.personalPreparationFailed';
      const text = i18n.t(key, { latestVersion: '0.1.119', version: '0.1.115' });
      expect(text).not.toBe(key);
      expect(text).toContain('0.1.119');
      expect(text).toContain('0.1.115');
      expect(text).not.toContain('{{');
    });
  }
});
