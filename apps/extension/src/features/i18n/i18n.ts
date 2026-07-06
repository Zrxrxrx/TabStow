import { storage } from '#imports';

const LANGUAGE_KEY = 'local:tabstow-language';

export type LanguagePreference = 'auto' | 'en' | 'zh-CN';
export type Locale = 'en' | 'zh-CN';

const messages = {
  en: {
    activeTabs: 'Active tabs',
    addQuickLink: 'Add quick link',
    quickLinks: 'Quick links',
    searchTheWeb: 'Search the web',
    stowCurrentWindow: 'Stow current window',
    stowedSessions: 'Stowed sessions',
    todos: 'Todos',
  },
  'zh-CN': {
    activeTabs: '打开的标签页',
    addQuickLink: '添加快捷链接',
    quickLinks: '快捷链接',
    searchTheWeb: '搜索网页',
    stowCurrentWindow: '收起当前窗口',
    stowedSessions: '已收起的标签页',
    todos: '待办',
  },
} as const;

export type MessageKey = keyof typeof messages.en;
type MessageVars = Record<string, string | number>;

export function normalizeLanguagePreference(input: unknown): LanguagePreference {
  const value = typeof input === 'string' ? input.trim() : '';
  return value === 'en' || value === 'zh-CN' || value === 'auto' ? value : 'auto';
}

export function resolveLocale(preference: LanguagePreference, browserLanguage: string): Locale {
  if (preference === 'zh-CN' || preference === 'en') return preference;

  const normalizedBrowserLanguage = String(browserLanguage ?? '').toLowerCase();
  return normalizedBrowserLanguage.startsWith('zh') ? 'zh-CN' : 'en';
}

export function t(locale: Locale, key: MessageKey, vars?: MessageVars): string {
  const template = messages[locale]?.[key] ?? messages.en[key];

  if (!vars) return template;

  return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => {
    const value = vars[name];
    return value === undefined || value === null ? '' : String(value);
  });
}

export async function getLanguagePreference(): Promise<LanguagePreference> {
  return normalizeLanguagePreference(await storage.getItem<LanguagePreference>(LANGUAGE_KEY));
}

export async function saveLanguagePreference(preference: LanguagePreference): Promise<LanguagePreference> {
  const normalized = normalizeLanguagePreference(preference);
  await storage.setItem(LANGUAGE_KEY, normalized);
  return normalized;
}
