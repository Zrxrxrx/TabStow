import { describe, expect, it } from 'vitest';
import { resolveLocale, t } from './i18n';

describe('i18n', () => {
  it('resolves automatic Simplified Chinese locale', () => {
    expect(resolveLocale('auto', 'zh-CN')).toBe('zh-CN');
  });

  it('falls back to English messages', () => {
    expect(t('en', 'stowCurrentWindow')).toBe('Stow current window');
    expect(t('zh-CN', 'stowCurrentWindow')).toBe('收起当前窗口');
  });
});
