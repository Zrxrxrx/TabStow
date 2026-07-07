import { storage } from '#imports';

const LANGUAGE_KEY = 'local:tabstow-language';

export type LanguagePreference = 'auto' | 'en' | 'zh-CN';
export type Locale = 'en' | 'zh-CN';

const messages = {
  en: {
    activeTabs: 'Active tabs',
    addOpenTab: 'Add open tab',
    addTodo: 'Add todo',
    addQuickLink: 'Add quick link',
    add: 'Add',
    appearance: 'Appearance',
    auto: 'Auto',
    clearCompleted: 'Clear completed',
    cancel: 'Cancel',
    collapseChromeGroups: 'Collapse Chrome groups',
    chromeGroupsSynced: 'Chrome groups synced',
    customBackground: 'Custom background',
    dark: 'Dark',
    darkMode: 'Dark mode',
    delete: 'Delete',
    chooseOpenTab: 'Choose open tab',
    editQuickLink: 'Edit {{label}}',
    editQuickLinksMode: 'Edit quick links',
    importChromeGroups: 'Import Chrome groups',
    language: 'Language',
    light: 'Light',
    lightMode: 'Light mode',
    moveDown: 'Move {{label}} down',
    moveToDomainGroup: 'Move to domain group',
    moveToManualGroup: 'Move to manual group',
    moveUp: 'Move {{label}} up',
    noQuickLinks: 'No quick links yet.',
    noOpenTabsForQuickLink: 'No open tabs with URLs are available.',
    noSavedSessions: 'No saved sessions yet.',
    noTodos: 'No todos yet.',
    openSettings: 'Open settings',
    palette: 'Palette',
    pull: 'Pull',
    push: 'Push',
    quickLinkIcon: 'Quick link icon',
    quickLinkIconHelp: 'Leave blank to use the site icon.',
    quickLinkLabel: 'Quick link label',
    quickLinkUrl: 'Quick link URL',
    quickLinks: 'Quick links',
    quickLinksSubtitle: 'Custom web icons stay one click away at the top of the new tab page.',
    refreshChromeGroups: 'Refresh Chrome groups',
    removeQuickLink: 'Remove {{label}}',
    restore: 'Restore',
    savedForLater: 'Saved for later',
    savedSessionsSubtitle: 'Durable stowed sessions sorted newest first. Restoring keeps the saved copy.',
    saveTabForLater: 'Save {{label}} for later',
    save: 'Save',
    searchTheWeb: 'Search the web',
    searchTodos: 'Search todos',
    searchWithDefaultEngine: 'Search with your default engine',
    showQuickLinksMode: 'Show quick links',
    stowThisWindow: 'Stow this window',
    surfaceTransparency: 'Surface transparency',
    syncManualGroups: 'Sync manual groups to Chrome tab groups',
    system: 'System',
    themeMode: 'Theme mode',
    switchLanguage: 'Switch language',
    switchTheme: 'Switch theme',
    uploadQuickLinkIcon: 'Upload icon for {{label}}',
    welcomeUser: 'Welcome, {{name}}',
    todoDetails: 'Todo details',
    todoTitle: 'Todo title',
    stowCurrentWindow: 'Stow current window',
    stowedSessions: 'Stowed sessions',
    todos: 'Todos',
  },
  'zh-CN': {
    activeTabs: '打开的标签页',
    addOpenTab: '添加打开的标签页',
    addTodo: '添加待办',
    addQuickLink: '添加快捷链接',
    add: '添加',
    appearance: '外观',
    auto: '自动',
    clearCompleted: '清除已完成',
    cancel: '取消',
    collapseChromeGroups: '折叠 Chrome 分组',
    chromeGroupsSynced: 'Chrome 分组已同步',
    customBackground: '自定义背景',
    dark: '深色',
    darkMode: '深色模式',
    delete: '删除',
    chooseOpenTab: '选择打开的标签页',
    editQuickLink: '编辑 {{label}}',
    editQuickLinksMode: '编辑快捷链接',
    importChromeGroups: '导入 Chrome 分组',
    language: '语言',
    light: '浅色',
    lightMode: '浅色模式',
    moveDown: '下移 {{label}}',
    moveToDomainGroup: '移回域名分组',
    moveToManualGroup: '移至手动分组',
    moveUp: '上移 {{label}}',
    noQuickLinks: '还没有快捷链接。',
    noOpenTabsForQuickLink: '没有可添加的网址标签页。',
    noSavedSessions: '还没有保存的会话。',
    noTodos: '还没有待办。',
    openSettings: '打开设置',
    palette: '调色板',
    pull: '拉取',
    push: '推送',
    quickLinkIcon: '快捷链接图标',
    quickLinkIconHelp: '留空以使用网站图标。',
    quickLinkLabel: '快捷链接名称',
    quickLinkUrl: '快捷链接网址',
    quickLinks: '快捷链接',
    quickLinksSubtitle: '自定义网页图标会固定在新标签页顶部，随时一键打开。',
    refreshChromeGroups: '刷新 Chrome 分组',
    removeQuickLink: '移除 {{label}}',
    restore: '恢复',
    savedForLater: '稍后查看',
    savedSessionsSubtitle: '持久保存的会话按最新优先排序，恢复时会保留已保存副本。',
    saveTabForLater: '保存 {{label}} 到稍后查看',
    save: '保存',
    searchTheWeb: '搜索网页',
    searchTodos: '搜索待办',
    searchWithDefaultEngine: '使用默认搜索引擎搜索',
    showQuickLinksMode: '显示快捷链接',
    stowThisWindow: '收起此窗口',
    surfaceTransparency: '界面透明度',
    syncManualGroups: '同步手动分组到 Chrome 标签页分组',
    system: '跟随系统',
    themeMode: '主题模式',
    switchLanguage: '切换语言',
    switchTheme: '切换主题',
    uploadQuickLinkIcon: '为 {{label}} 上传图标',
    welcomeUser: '欢迎，{{name}}',
    todoDetails: '待办详情',
    todoTitle: '待办标题',
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
