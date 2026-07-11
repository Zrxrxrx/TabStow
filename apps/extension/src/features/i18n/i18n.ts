import { storage } from '#imports';

const LANGUAGE_KEY = 'local:tabstow-language';

export type LanguagePreference = 'auto' | 'en' | 'zh-CN';
export type Locale = 'en' | 'zh-CN';

const messages = {
  en: {
    activeTabs: 'Active tabs',
    activeTabsSubtitle: 'Mirrors eligible tabs, windows, and groups from Chrome.',
    activeTabsNavigation: 'Active tab windows and groups',
    allActiveTabs: 'All',
    addOpenTab: 'Add open tab',
    addTodo: 'Add todo',
    addQuickLink: 'Add quick link',
    add: 'Add',
    appearance: 'Appearance',
    auto: 'Auto',
    clearCompleted: 'Clear completed',
    cancel: 'Cancel',
    clearTabSearch: 'Clear tab search',
    collapseChromeGroups: 'Collapse Chrome groups',
    chromeGroupFallback: 'Chrome group {{id}}',
    chromeGroupCollapsed: 'Collapsed',
    chromeGroupExpanded: 'Expanded',
    customBackground: 'Custom background',
    currentWindow: 'Current window',
    dark: 'Dark',
    darkMode: 'Dark mode',
    delete: 'Delete',
    dragGroup: 'Drag {{label}} group',
    dragTab: 'Drag {{label}}',
    chooseOpenTab: 'Choose open tab',
    editQuickLink: 'Edit {{label}}',
    editQuickLinksMode: 'Edit quick links',
    fetchQuickLink: 'Fetch',
    history: 'History',
    language: 'Language',
    light: 'Light',
    lightMode: 'Light mode',
    moveDown: 'Move {{label}} down',
    moveUp: 'Move {{label}} up',
    noQuickLinks: 'No quick links yet.',
    noOpenTabsForQuickLink: 'No open tabs with URLs are available.',
    noSavedSessions: 'No saved sessions yet.',
    noTodos: 'No todos yet.',
    openSavedTab: 'Open {{label}}',
    openSettings: 'Open settings',
    palette: 'Palette',
    pinnedTabs: 'Pinned tabs',
    pull: 'Pull',
    push: 'Push',
    quickLinkIcon: 'Quick link icon',
    quickLinkIconHelp: 'Leave blank to use the site icon.',
    quickLinkLabel: 'Quick link label',
    quickLinkPreview: 'Quick link preview',
    quickLinkUrl: 'Quick link URL',
    quickLinks: 'Quick links',
    quickLinksSubtitle: 'Custom web icons stay one click away at the top of the new tab page.',
    refreshFromChrome: 'Refresh from Chrome',
    removeQuickLink: 'Remove {{label}}',
    restore: 'Restore',
    restoreAll: 'Restore all',
    savedForLater: 'Saved for later',
    savedSessionsSubtitle: 'Durable stowed sessions sorted newest first. Restoring keeps the saved copy.',
    saveTabForLater: 'Save {{label}} for later',
    save: 'Save',
    searchTheWeb: 'Search the web',
    searchTabs: 'Search active and saved tabs',
    searchTodos: 'Search todos',
    searchWithDefaultEngine: 'Search with your default engine',
    showQuickLinksMode: 'Show quick links',
    stowThisWindow: 'Stow this window',
    surfaceTransparency: 'Surface transparency',
    system: 'System',
    themeMode: 'Theme mode',
    switchLanguage: 'Switch language',
    switchTheme: 'Switch theme',
    uploadQuickLinkIcon: 'Upload icon for {{label}}',
    welcomeUser: 'Welcome, {{name}}',
    windowNumber: 'Window {{number}}',
    todoDetails: 'Todo details',
    todoTitle: 'Todo title',
    stowCurrentWindow: 'Stow current window',
    stowedSessions: 'Stowed sessions',
    todos: 'Todos',
  },
  'zh-CN': {
    activeTabs: '打开的标签页',
    activeTabsSubtitle: '与 Chrome 中可管理的标签页、窗口和分组保持一致。',
    activeTabsNavigation: '标签页窗口和分组',
    allActiveTabs: '全部',
    addOpenTab: '添加打开的标签页',
    addTodo: '添加待办',
    addQuickLink: '添加快捷链接',
    add: '添加',
    appearance: '外观',
    auto: '自动',
    clearCompleted: '清除已完成',
    cancel: '取消',
    clearTabSearch: '清除标签页搜索',
    collapseChromeGroups: '折叠 Chrome 分组',
    chromeGroupFallback: 'Chrome 分组 {{id}}',
    chromeGroupCollapsed: '已折叠',
    chromeGroupExpanded: '已展开',
    customBackground: '自定义背景',
    currentWindow: '当前窗口',
    dark: '深色',
    darkMode: '深色模式',
    delete: '删除',
    dragGroup: '拖动 {{label}} 分组',
    dragTab: '拖动 {{label}}',
    chooseOpenTab: '选择打开的标签页',
    editQuickLink: '编辑 {{label}}',
    editQuickLinksMode: '编辑快捷链接',
    fetchQuickLink: '获取',
    history: '历史记录',
    language: '语言',
    light: '浅色',
    lightMode: '浅色模式',
    moveDown: '下移 {{label}}',
    moveUp: '上移 {{label}}',
    noQuickLinks: '还没有快捷链接。',
    noOpenTabsForQuickLink: '没有可添加的网址标签页。',
    noSavedSessions: '还没有保存的会话。',
    noTodos: '还没有待办。',
    openSavedTab: '打开 {{label}}',
    openSettings: '打开设置',
    palette: '调色板',
    pinnedTabs: '固定标签页',
    pull: '拉取',
    push: '推送',
    quickLinkIcon: '快捷链接图标',
    quickLinkIconHelp: '留空以使用网站图标。',
    quickLinkLabel: '快捷链接名称',
    quickLinkPreview: '快捷链接预览',
    quickLinkUrl: '快捷链接网址',
    quickLinks: '快捷链接',
    quickLinksSubtitle: '自定义网页图标会固定在新标签页顶部，随时一键打开。',
    refreshFromChrome: '从 Chrome 刷新',
    removeQuickLink: '移除 {{label}}',
    restore: '恢复',
    restoreAll: '全部恢复',
    savedForLater: '稍后查看',
    savedSessionsSubtitle: '持久保存的会话按最新优先排序，恢复时会保留已保存副本。',
    saveTabForLater: '保存 {{label}} 到稍后查看',
    save: '保存',
    searchTheWeb: '搜索网页',
    searchTabs: '搜索打开和已保存的标签页',
    searchTodos: '搜索待办',
    searchWithDefaultEngine: '使用默认搜索引擎搜索',
    showQuickLinksMode: '显示快捷链接',
    stowThisWindow: '收起此窗口',
    surfaceTransparency: '界面透明度',
    system: '跟随系统',
    themeMode: '主题模式',
    switchLanguage: '切换语言',
    switchTheme: '切换主题',
    uploadQuickLinkIcon: '为 {{label}} 上传图标',
    welcomeUser: '欢迎，{{name}}',
    windowNumber: '窗口 {{number}}',
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
