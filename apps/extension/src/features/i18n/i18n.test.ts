import { beforeEach, describe, expect, it, vi } from 'vitest';

const storageMocks = vi.hoisted(() => ({
  getItem: vi.fn(),
  setItem: vi.fn(),
}));

vi.mock('#imports', () => ({
  storage: storageMocks,
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});

describe('i18n', () => {
  it('resolves automatic Simplified Chinese locale', async () => {
    const { resolveLocale } = await import('./i18n');

    expect(resolveLocale('auto', 'zh-CN')).toBe('zh-CN');
  });

  it('falls back to English messages', async () => {
    const { t } = await import('./i18n');

    expect(t('en', 'stowCurrentWindow')).toBe('Stow current window');
    expect(t('zh-CN', 'stowCurrentWindow')).toBe('收起当前窗口');
  });

  it('includes Simplified Chinese labels for migrated dashboard surfaces', async () => {
    const { t } = await import('./i18n');

    expect(t('zh-CN', 'activeTabs')).toBe('打开的标签页');
    expect(t('zh-CN', 'stowedSessions')).toBe('已收起的标签页');
    expect(t('zh-CN', 'searchTheWeb')).toBe('搜索网页');
    expect(t('zh-CN', 'appearance')).toBe('外观');
    expect(t('zh-CN', 'themeMode')).toBe('主题模式');
    expect(t('zh-CN', 'palette')).toBe('调色板');
    expect(t('zh-CN', 'surfaceTransparency')).toBe('界面透明度');
    expect(t('zh-CN', 'language')).toBe('语言');
    expect(t('zh-CN', 'customBackground')).toBe('自定义背景');
    expect(t('zh-CN', 'syncManualGroups')).toBe('同步手动分组到 Chrome 标签页分组');
    expect(t('zh-CN', 'moveToManualGroup')).toBe('移至手动分组');
  });

  it('interpolates variables in message templates', async () => {
    const { t } = await import('./i18n');

    expect(t('en', 'welcomeUser', { name: 'Mina' })).toBe('Welcome, Mina');
    expect(t('zh-CN', 'welcomeUser', { name: '米娜' })).toBe('欢迎，米娜');
  });

  it('loads normalized language preference from storage', async () => {
    storageMocks.getItem.mockResolvedValue(' zh-CN ');

    const { getLanguagePreference } = await import('./i18n');

    await expect(getLanguagePreference()).resolves.toBe('zh-CN');
  });

  it('normalizes before saving and returns normalized language preference', async () => {
    const preference = ' zh-CN ' as unknown as Parameters<typeof import('./i18n').saveLanguagePreference>[0];

    const { saveLanguagePreference } = await import('./i18n');

    await expect(saveLanguagePreference(preference)).resolves.toBe('zh-CN');
    expect(storageMocks.setItem).toHaveBeenCalledWith('local:tabstow-language', 'zh-CN');
  });
});
