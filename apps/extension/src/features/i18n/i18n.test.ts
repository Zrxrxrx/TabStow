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
    expect(t('en', 'switchLanguage')).toBe('Switch language');
    expect(t('en', 'switchTheme')).toBe('Switch theme');
    expect(t('en', 'editQuickLinksMode')).toBe('Edit quick links');
    expect(t('en', 'showQuickLinksMode')).toBe('Show quick links');
    expect(t('en', 'lightMode')).toBe('Light mode');
    expect(t('en', 'darkMode')).toBe('Dark mode');
    expect(t('en', 'searchTabs')).toBe('Search active and saved tabs');
    expect(t('en', 'clearTabSearch')).toBe('Clear tab search');
    expect(t('en', 'history')).toBe('History');
    expect(t('en', 'savedSessionsSubtitle')).toBe(
      'Durable stowed sessions sorted newest first. Normally opened, restored, and removed items move to History; middle-click keeps a Saved copy.',
    );
    expect(t('en', 'restoreAll')).toBe('Restore all and move session to History');
    expect(t('en', 'restoreSavedSession', { label: 'Work' })).toBe(
      'Restore Work and move to History',
    );
    expect(t('en', 'removeSavedTab', { label: 'Docs' })).toBe('Move Docs to History');
    expect(t('en', 'removeSavedSession', { label: 'Work' })).toBe('Move Work to History');
    expect(t('en', 'dragSavedTab', { label: 'Docs' })).toBe('Drag saved tab Docs');
    expect(t('en', 'dragSavedSession', { label: 'Work' })).toBe('Drag saved session Work');
    expect(t('en', 'dropSavedTabBefore', { label: 'Docs' })).toBe(
      'Drop saved tab before Docs',
    );
    expect(t('en', 'dropSavedTabAtEnd', { label: 'Work' })).toBe(
      'Drop saved tab at end of Work',
    );
    expect(t('en', 'dropSavedSessionBefore', { label: 'Work' })).toBe(
      'Drop saved session before Work',
    );
    expect(t('en', 'dropSavedSessionAtEnd')).toBe('Drop saved session at end');
    expect(t('en', 'openedSavedTab')).toBe('Opened saved tab.');
    expect(t('en', 'movedSavedTabToHistory')).toBe('Moved tab to History.');
    expect(t('en', 'restoredSavedSession', { count: 2 })).toBe(
      'Restored 2 tabs and moved the session to History.',
    );
    expect(t('en', 'movedSavedSessionToHistory')).toBe('Moved saved session to History.');
    expect(t('en', 'movedSavedTab')).toBe('Moved saved tab.');
    expect(t('en', 'reorderedSavedSessions')).toBe('Reordered saved sessions.');
    expect(t('en', 'savedCount', { sessions: '2 sessions', tabs: '3 tabs' })).toBe(
      '2 sessions, 3 tabs',
    );
    expect(t('en', 'savedSessionsCount', { count: 2 })).toBe('2 sessions');
    expect(t('en', 'savedTabsCount', { count: 3 })).toBe('3 tabs');
    expect(t('en', 'savedSessionCount', { count: 1 })).toBe('1 session');
    expect(t('en', 'savedTabCount', { count: 1 })).toBe('1 tab');
    expect(t('en', 'syncChangesSavedLocally')).toBe('Changes saved locally');
    expect(t('en', 'syncPaused')).toBe('Sync paused');
    expect(t('en', 'extra')).toBe('Extra');
    expect(t('en', 'settings')).toBe('Settings');
    expect(t('en', 'closeExtra')).toBe('Close extra drawer');
    expect(t('en', 'tabstowSubtitle')).toBe('Tab operations');
    expect(t('en', 'stowTabsReady', { count: 3 })).toBe('3 tabs ready');
    expect(t('en', 'stowingWindow')).toBe('Stowing window…');
    expect(t('en', 'sleptTab')).toBe('Slept 1 tab.');
    expect(t('en', 'sleptTabs', { count: 3 })).toBe('Slept 3 tabs.');
    expect(t('en', 'sleepSearchUnavailableReason')).toBe(
      'Clear search to sleep tabs in the selected window.',
    );
    expect(t('en', 'duplicateTabstowTitle')).toBe('Tabstow is already open');
    expect(t('en', 'duplicateTabstowCloseOthers')).toBe('Close other tabs');
  });

  it('includes Simplified Chinese labels for migrated dashboard surfaces', async () => {
    const { t } = await import('./i18n');

    expect(t('zh-CN', 'activeTabs')).toBe('打开的标签页');
    expect(t('zh-CN', 'stowedSessions')).toBe('已收起的标签页');
    expect(t('zh-CN', 'searchTheWeb')).toBe('搜索网页');
    expect(t('zh-CN', 'language')).toBe('语言');
    expect(t('zh-CN', 'windowNumber', { number: 2 })).toBe('窗口 2');
    expect(t('zh-CN', 'chromeGroupFallback', { id: 31 })).toBe('Chrome 分组 31');
    expect(t('zh-CN', 'dragTab', { label: '示例' })).toBe('拖动 示例');
    expect(t('zh-CN', 'saveTabForLater', { label: '示例' })).toBe('保存 示例 到稍后查看');
    expect(t('zh-CN', 'quickLinkUrl')).toBe('快捷链接网址');
    expect(t('zh-CN', 'quickLinkLabel')).toBe('快捷链接名称');
    expect(t('zh-CN', 'quickLinkIcon')).toBe('快捷链接图标');
    expect(t('zh-CN', 'quickLinkIconHelp')).toBe('留空以使用网站图标。');
    expect(t('zh-CN', 'chooseOpenTab')).toBe('选择打开的标签页');
    expect(t('zh-CN', 'todoTitle')).toBe('待办标题');
    expect(t('zh-CN', 'todoDetails')).toBe('待办详情');
    expect(t('zh-CN', 'cancel')).toBe('取消');
    expect(t('zh-CN', 'save')).toBe('保存');
    expect(t('zh-CN', 'add')).toBe('添加');
    expect(t('zh-CN', 'switchLanguage')).toBe('切换语言');
    expect(t('zh-CN', 'switchTheme')).toBe('切换主题');
    expect(t('zh-CN', 'editQuickLinksMode')).toBe('编辑快捷链接');
    expect(t('zh-CN', 'showQuickLinksMode')).toBe('显示快捷链接');
    expect(t('zh-CN', 'lightMode')).toBe('浅色模式');
    expect(t('zh-CN', 'darkMode')).toBe('深色模式');
    expect(t('zh-CN', 'searchTabs')).toBe('搜索打开和已保存的标签页');
    expect(t('zh-CN', 'clearTabSearch')).toBe('清除标签页搜索');
    expect(t('zh-CN', 'history')).toBe('历史记录');
    expect(t('zh-CN', 'savedSessionsSubtitle')).toBe(
      '持久保存的会话按最新优先排序；正常打开、恢复或移除的内容会移至历史记录，中键打开会保留已保存副本。',
    );
    expect(t('zh-CN', 'restoreAll')).toBe('全部恢复并将会话移至历史记录');
    expect(t('zh-CN', 'restoreSavedSession', { label: '工作' })).toBe(
      '恢复工作并移至历史记录',
    );
    expect(t('zh-CN', 'removeSavedTab', { label: '文档' })).toBe('将文档移至历史记录');
    expect(t('zh-CN', 'removeSavedSession', { label: '工作' })).toBe('将工作移至历史记录');
    expect(t('zh-CN', 'dragSavedTab', { label: '文档' })).toBe('拖动已保存的标签页文档');
    expect(t('zh-CN', 'dragSavedSession', { label: '工作' })).toBe('拖动已保存的会话工作');
    expect(t('zh-CN', 'dropSavedTabBefore', { label: '文档' })).toBe(
      '将已保存的标签页放在文档之前',
    );
    expect(t('zh-CN', 'dropSavedTabAtEnd', { label: '工作' })).toBe(
      '将已保存的标签页放在工作末尾',
    );
    expect(t('zh-CN', 'dropSavedSessionBefore', { label: '工作' })).toBe(
      '将已保存的会话放在工作之前',
    );
    expect(t('zh-CN', 'dropSavedSessionAtEnd')).toBe('将已保存的会话放在末尾');
    expect(t('zh-CN', 'openedSavedTab')).toBe('已打开保存的标签页。');
    expect(t('zh-CN', 'movedSavedTabToHistory')).toBe('已将标签页移至历史记录。');
    expect(t('zh-CN', 'restoredSavedSession', { count: 2 })).toBe(
      '已恢复 2 个标签页，并将会话移至历史记录。',
    );
    expect(t('zh-CN', 'movedSavedSessionToHistory')).toBe('已将保存的会话移至历史记录。');
    expect(t('zh-CN', 'movedSavedTab')).toBe('已移动保存的标签页。');
    expect(t('zh-CN', 'reorderedSavedSessions')).toBe('已重新排列保存的会话。');
    expect(t('zh-CN', 'savedCount', { sessions: '2 个会话', tabs: '3 个标签页' })).toBe(
      '2 个会话，3 个标签页',
    );
    expect(t('zh-CN', 'savedSessionsCount', { count: 2 })).toBe('2 个会话');
    expect(t('zh-CN', 'savedTabsCount', { count: 3 })).toBe('3 个标签页');
    expect(t('zh-CN', 'savedSessionCount', { count: 1 })).toBe('1 个会话');
    expect(t('zh-CN', 'savedTabCount', { count: 1 })).toBe('1 个标签页');
    expect(t('zh-CN', 'syncChangesSavedLocally')).toBe('更改已保存在本地');
    expect(t('zh-CN', 'syncPaused')).toBe('同步已暂停');
    expect(t('zh-CN', 'extra')).toBe('更多');
    expect(t('zh-CN', 'settings')).toBe('设置');
    expect(t('zh-CN', 'closeExtra')).toBe('关闭更多工具');
    expect(t('zh-CN', 'tabstowSubtitle')).toBe('标签页操作');
    expect(t('zh-CN', 'stowTabsReady', { count: 3 })).toBe('3 个标签页待收起');
    expect(t('zh-CN', 'stowingWindow')).toBe('正在收起窗口…');
    expect(t('zh-CN', 'sleptTab')).toBe('已休眠 1 个标签页。');
    expect(t('zh-CN', 'sleptTabs', { count: 3 })).toBe('已休眠 3 个标签页。');
    expect(t('zh-CN', 'sleepSearchUnavailableReason')).toBe(
      '清除搜索后，才能休眠所选窗口中的标签页。',
    );
    expect(t('zh-CN', 'duplicateTabstowTitle')).toBe('Tabstow 已在其他标签页打开');
    expect(t('zh-CN', 'duplicateTabstowCloseOthers')).toBe('关闭其他标签页');
  });

  it('includes English and Simplified Chinese labels for the History page', async () => {
    const { t } = await import('./i18n');

    expect(t('en', 'history')).toBe('History');
    expect(t('en', 'historyEmpty')).toBe('History is empty.');
    expect(t('en', 'historyOpenedFrom', { sourceTitle: 'Reading' })).toBe(
      'Opened from Reading',
    );
    expect(t('en', 'historyRestoredFrom', { sourceTitle: 'Reading' })).toBe(
      'Restored from Reading',
    );
    expect(t('en', 'historyRemovedFrom', { sourceTitle: 'Reading' })).toBe(
      'Removed from Reading',
    );
    expect(t('en', 'historyOpen')).toBe('Open');
    expect(t('en', 'historyRestore')).toBe('Restore to Saved for later');
    expect(t('en', 'historyDeletePermanently')).toBe('Delete permanently');
    expect(t('en', 'historyConfirmDelete')).toBe(
      'Delete this History entry permanently?',
    );
    expect(t('en', 'backToWorkspace')).toBe('Back to workspace');

    expect(t('zh-CN', 'history')).toBe('历史记录');
    expect(t('zh-CN', 'historyEmpty')).toBe('历史记录为空。');
    expect(t('zh-CN', 'historyOpenedFrom', { sourceTitle: '阅读' })).toBe('从阅读打开');
    expect(t('zh-CN', 'historyRestoredFrom', { sourceTitle: '阅读' })).toBe('从阅读恢复');
    expect(t('zh-CN', 'historyRemovedFrom', { sourceTitle: '阅读' })).toBe('从阅读移除');
    expect(t('zh-CN', 'historyOpen')).toBe('打开');
    expect(t('zh-CN', 'historyRestore')).toBe('恢复到稍后查看');
    expect(t('zh-CN', 'historyDeletePermanently')).toBe('永久删除');
    expect(t('zh-CN', 'historyConfirmDelete')).toBe('要永久删除这条历史记录吗？');
    expect(t('zh-CN', 'backToWorkspace')).toBe('返回工作区');
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
