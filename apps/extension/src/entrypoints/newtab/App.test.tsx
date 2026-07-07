import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TabSession } from '@tabstow/core';
import type { ActiveWorkspaceState } from '@/features/active-tabs/active-workspace-storage';
import type { ActiveBrowserTab, ActiveTabsSnapshot, ManualGroupsState } from '@/features/active-tabs/types';
import type { AppResult } from '@/lib/errors';
import type { ExtensionMessage, StowResult } from '@/lib/messages';
import { App } from './App';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const { sendExtensionMessage } = vi.hoisted(() => ({
  sendExtensionMessage: vi.fn(),
}));
const { getActiveWorkspaceState, updateActiveWorkspaceState } = vi.hoisted(() => ({
  getActiveWorkspaceState: vi.fn(),
  updateActiveWorkspaceState: vi.fn(),
}));
const { getQuickLinks, saveQuickLinks } = vi.hoisted(() => ({
  getQuickLinks: vi.fn(),
  saveQuickLinks: vi.fn(),
}));
const { chromeRuntimeMocks } = vi.hoisted(() => ({
  chromeRuntimeMocks: {
    getURL: vi.fn((path: string) => `chrome-extension://tabstow-test${path}`),
    openOptionsPage: vi.fn(),
  },
}));
const { saveQuickLinkIcon, resolveQuickLinkIconUrl, deleteQuickLinkIcon, isQuickLinkIconToken } = vi.hoisted(() => ({
  saveQuickLinkIcon: vi.fn(),
  resolveQuickLinkIconUrl: vi.fn(),
  deleteQuickLinkIcon: vi.fn(),
  isQuickLinkIconToken: vi.fn((value: unknown) => typeof value === 'string' && value.startsWith('quick-link-icon:')),
}));
const { getTodos, saveTodos } = vi.hoisted(() => ({
  getTodos: vi.fn(),
  saveTodos: vi.fn(),
}));
const { getThemePreferences, saveThemePreferences } = vi.hoisted(() => ({
  getThemePreferences: vi.fn(),
  saveThemePreferences: vi.fn(),
}));
const { getLanguagePreference, saveLanguagePreference } = vi.hoisted(() => ({
  getLanguagePreference: vi.fn(),
  saveLanguagePreference: vi.fn(),
}));
const { saveCustomBackgroundFile, resolveCustomBackgroundUrl, deleteCustomBackground } = vi.hoisted(() => ({
  saveCustomBackgroundFile: vi.fn(),
  resolveCustomBackgroundUrl: vi.fn(),
  deleteCustomBackground: vi.fn(),
}));

vi.mock('@/lib/messages', () => ({
  sendExtensionMessage,
}));

vi.mock('@/features/active-tabs/active-workspace-storage', () => ({
  getActiveWorkspaceState,
  updateActiveWorkspaceState,
}));

vi.mock('@/features/quick-links/quick-links-storage', () => ({
  getQuickLinks,
  saveQuickLinks,
}));

vi.mock('@/features/quick-links/quick-link-icons-cache', () => ({
  saveQuickLinkIcon,
  resolveQuickLinkIconUrl,
  deleteQuickLinkIcon,
  isQuickLinkIconToken,
}));

vi.mock('@/features/todos/todos-storage', () => ({
  getTodos,
  saveTodos,
}));

vi.mock('@/features/theme/theme-preferences', async () => {
  const actual = await vi.importActual<typeof import('@/features/theme/theme-preferences')>(
    '@/features/theme/theme-preferences',
  );
  return {
    ...actual,
    getThemePreferences,
    saveThemePreferences,
  };
});

vi.mock('@/features/i18n/i18n', async () => {
  const actual = await vi.importActual<typeof import('@/features/i18n/i18n')>('@/features/i18n/i18n');
  return {
    ...actual,
    getLanguagePreference,
    saveLanguagePreference,
  };
});

vi.mock('@/features/theme/theme-background-cache', () => ({
  saveCustomBackgroundFile,
  resolveCustomBackgroundUrl,
  deleteCustomBackground,
}));

const SESSIONS: TabSession[] = [];
const DUPLICATE_TABS: ActiveBrowserTab[] = [
  {
    active: true,
    groupId: -1,
    id: 7,
    index: 0,
    pinned: false,
    title: 'Inbox - Gmail',
    url: 'https://mail.google.com/mail/u/0/#inbox',
    windowId: 3,
  },
  {
    active: false,
    groupId: -1,
    id: 8,
    index: 1,
    pinned: false,
    title: 'Issue tracker',
    url: 'https://github.com/openai/tabstow/issues/10',
    windowId: 3,
  },
  {
    active: false,
    groupId: -1,
    id: 9,
    index: 2,
    pinned: false,
    title: 'Issue tracker copy',
    url: 'https://github.com/openai/tabstow/issues/10',
    windowId: 3,
  },
  {
    active: false,
    groupId: -1,
    id: 10,
    index: 3,
    pinned: false,
    title: 'Issue tracker copy 2',
    url: 'https://github.com/openai/tabstow/issues/10',
    windowId: 3,
  },
];
const UNIQUE_TAB: ActiveBrowserTab = {
  active: false,
  groupId: -1,
  id: 12,
  index: 0,
  pinned: false,
  title: 'Spec draft',
  url: 'https://docs.example.com/spec',
  windowId: 4,
};
const INVALID_QUICK_LINK_TAB: ActiveBrowserTab = {
  active: false,
  groupId: -1,
  id: 13,
  index: 0,
  pinned: false,
  title: 'Settings',
  url: 'chrome://settings',
  windowId: 4,
};

let container: HTMLDivElement;
let root: Root;
let promptSpy: ReturnType<typeof vi.spyOn>;

describe('App', () => {
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    sendExtensionMessage.mockReset();
    getActiveWorkspaceState.mockReset();
    updateActiveWorkspaceState.mockReset();
    getQuickLinks.mockReset();
    saveQuickLinks.mockReset();
    saveQuickLinkIcon.mockReset();
    resolveQuickLinkIconUrl.mockReset();
    deleteQuickLinkIcon.mockReset();
    isQuickLinkIconToken.mockClear();
    getTodos.mockReset();
    saveTodos.mockReset();
    getThemePreferences.mockReset();
    saveThemePreferences.mockReset();
    getLanguagePreference.mockReset();
    saveLanguagePreference.mockReset();
    saveCustomBackgroundFile.mockReset();
    resolveCustomBackgroundUrl.mockReset();
    deleteCustomBackground.mockReset();
    getActiveWorkspaceState.mockResolvedValue(defaultWorkspace());
    updateActiveWorkspaceState.mockImplementation(
      async (state: {
        manualGroups?: ManualGroupsState;
        chromeTabGroups?: ReturnType<typeof defaultWorkspace>['chromeTabGroups'];
      }) => ({
        ...defaultWorkspace(),
        ...state,
        manualGroups: state.manualGroups ?? defaultWorkspace().manualGroups,
        chromeTabGroups: state.chromeTabGroups ?? defaultWorkspace().chromeTabGroups,
      }),
    );
    getQuickLinks.mockResolvedValue([]);
    saveQuickLinks.mockImplementation(async (links: unknown) => links);
    saveQuickLinkIcon.mockResolvedValue('quick-link-icon:token-1');
    resolveQuickLinkIconUrl.mockResolvedValue('blob:quick-link-icon-token-1');
    deleteQuickLinkIcon.mockResolvedValue(undefined);
    getTodos.mockResolvedValue([]);
    saveTodos.mockImplementation(async (todos: unknown) => todos);
    getThemePreferences.mockResolvedValue({
      mode: 'light',
      paletteId: 'paper',
      surfaceOpacity: 92,
      customBackground: null,
    });
    saveThemePreferences.mockImplementation(async (preferences: unknown) => preferences);
    getLanguagePreference.mockResolvedValue('auto');
    saveLanguagePreference.mockImplementation(async (language: unknown) => language);
    saveCustomBackgroundFile.mockResolvedValue('theme-bg:token-1');
    resolveCustomBackgroundUrl.mockResolvedValue('blob:theme-bg-token-1');
    deleteCustomBackground.mockResolvedValue(undefined);
    promptSpy = vi.spyOn(window, 'prompt').mockReturnValue(null);
    document.documentElement.removeAttribute('data-theme-mode');
    document.documentElement.removeAttribute('data-theme-palette');
    document.documentElement.removeAttribute('lang');
    document.documentElement.style.removeProperty('--surface-opacity');
    document.documentElement.style.removeProperty('--dashboard-background-image');
    chromeRuntimeMocks.getURL.mockClear();
    chromeRuntimeMocks.openOptionsPage.mockClear();
    Object.defineProperty(globalThis, 'chrome', {
      configurable: true,
      value: {
        runtime: chromeRuntimeMocks,
      },
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('renders Chrome group controls below the active workspace header without a duplicate stow hint', async () => {
    mockMessages({ activeTabs: [DUPLICATE_TABS[0]] });

    await renderApp();

    expect(screen().getByRole('heading', { name: 'Active tabs' })).not.toBeNull();
    expect(screen().getByText('1 open')).not.toBeNull();
    expect(sentMessageTypes()).toEqual(expect.arrayContaining(['active-tabs:snapshot', 'sessions:list']));

    const mainText = container.textContent ?? '';
    expect(mainText.indexOf('Active tabs')).toBeLessThan(mainText.indexOf('No saved sessions yet.'));
    expect(container.querySelector('.active-workspace .section-header')).not.toBeNull();
    expect(container.querySelector('.active-workspace .tabs-toolbar')).not.toBeNull();
    expect(container.querySelector('.active-workspace .meta-row')).not.toBeNull();
    expect(() => screen().getByText('Stow this window')).toThrow();
    expect(container.querySelector('.active-workspace .active-workspace-hint')).toBeNull();
  });

  it('renders utility panels from stored quick links, todos, and theme preferences', async () => {
    mockMessages({ activeTabs: [UNIQUE_TAB] });
    getQuickLinks.mockResolvedValue([
      {
        id: 'link-1',
        url: 'https://example.com/',
        label: 'Example',
        icon: null,
        createdAt: '2026-07-07T00:00:00.000Z',
      },
    ]);
    getTodos.mockResolvedValue([
      {
        id: 'todo-1',
        title: 'Review launch checklist',
        description: '',
        createdAt: '2026-07-07T00:00:00.000Z',
        completed: false,
        completedAt: null,
        dismissed: false,
      },
    ]);
    getThemePreferences.mockResolvedValue({
      mode: 'dark',
      paletteId: 'sage',
      surfaceOpacity: 84,
      customBackground: 'theme-bg:stored',
    });
    getLanguagePreference.mockResolvedValue('zh-CN');
    resolveCustomBackgroundUrl.mockResolvedValue('blob:stored-background');

    await renderApp();

    expect(screen().getByRole('heading', { name: '快捷链接' })).not.toBeNull();
    expect(screen().getByText('Example')).not.toBeNull();
    expect(container.querySelector('.quick-links-panel')).not.toBeNull();
    expect(container.querySelector('.quick-link-card')).not.toBeNull();
    expect(container.querySelector('.quick-link-card-actions')).toBeNull();
    expect(document.documentElement.dataset.themeMode).toBe('dark');
    expect(document.documentElement.dataset.themePalette).toBe('sage');
    expect(document.documentElement.style.getPropertyValue('--dashboard-background-image')).toBe(
      'url("blob:stored-background")',
    );
    expect(document.documentElement.lang).toBe('zh-CN');
    expect(resolveCustomBackgroundUrl).toHaveBeenCalledWith('theme-bg:stored');

    await click(screen().getByRole('button', { name: 'Extra' }));
    expect(screen().getByRole('heading', { name: '待办' })).not.toBeNull();
    expect(screen().getByText('Review launch checklist')).not.toBeNull();
    expect(screen().getByRole('heading', { name: '外观' })).not.toBeNull();
  });

  it('renders top-bar language and light-dark switches without auto or system choices', async () => {
    mockMessages({ activeTabs: [UNIQUE_TAB] });
    getLanguagePreference.mockResolvedValue('en');
    getThemePreferences.mockResolvedValue({
      mode: 'light',
      paletteId: 'paper',
      surfaceOpacity: 92,
      customBackground: null,
    });
    saveLanguagePreference.mockImplementation(async (language: unknown) => language);
    saveThemePreferences.mockImplementation(async (preferences: unknown) => ({
      mode: (preferences as { mode: 'light' | 'dark' }).mode,
      paletteId: 'paper',
      surfaceOpacity: 92,
      customBackground: null,
    }));

    await renderApp();

    const languageSwitch = screen().getByRole('button', { name: 'Switch language' });
    const themeSwitch = screen().getByRole('button', { name: 'Switch theme' });
    expect(languageSwitch.querySelector('svg')).not.toBeNull();
    expect(themeSwitch.querySelector('svg')).not.toBeNull();
    expect(languageSwitch.textContent).toContain('English');
    expect(themeSwitch.textContent).toContain('Light');

    await click(languageSwitch);
    expect(saveLanguagePreference).toHaveBeenCalledWith('zh-CN');
    expect(document.documentElement.lang).toBe('zh-CN');
    expect(screen().getByRole('button', { name: '切换语言' })).toBe(languageSwitch);
    expect(screen().getByRole('button', { name: '切换主题' })).toBe(themeSwitch);
    expect(languageSwitch.textContent).toContain('简体中文');

    await click(themeSwitch);
    expect(saveThemePreferences).toHaveBeenCalledWith(expect.objectContaining({ mode: 'dark' }));
    expect(document.documentElement.dataset.themeMode).toBe('dark');
    expect(screen().getByRole('button', { name: '切换主题' })).toBe(themeSwitch);

    await click(screen().getByRole('button', { name: 'Extra' }));
    const languageSelect = screen().getByLabelText('语言');
    const themeSelect = screen().getByLabelText('主题模式');
    expect(Array.from(languageSelect.querySelectorAll('option')).map((option) => option.value)).toEqual([
      'en',
      'zh-CN',
    ]);
    expect(Array.from(themeSelect.querySelectorAll('option')).map((option) => option.value)).toEqual([
      'light',
      'dark',
    ]);
    expect(container.textContent).not.toContain('Auto');
    expect(container.textContent).not.toContain('System');
  });

  it('renders migrated dashboard labels in Simplified Chinese when selected', async () => {
    mockMessages({ activeTabs: [UNIQUE_TAB] });
    getLanguagePreference.mockResolvedValue('zh-CN');

    await renderApp();

    expect(screen().getByRole('heading', { name: '打开的标签页' })).not.toBeNull();
    expect(screen().getByRole('heading', { name: '快捷链接' })).not.toBeNull();
    expect(screen().getByRole('heading', { name: '稍后查看' })).not.toBeNull();
    expect(screen().getByLabelText('搜索网页')).not.toBeNull();
    expect(screen().getByLabelText('编辑快捷链接')).not.toBeNull();
    expect(screen().getByText('收起当前窗口')).not.toBeNull();
    expect(() => screen().getByRole('heading', { name: 'Quick links' })).toThrow();
    expect(() => screen().getByRole('heading', { name: 'Saved for later' })).toThrow();

    await click(screen().getByRole('button', { name: 'Extra' }));
    expect(screen().getByRole('heading', { name: '待办' })).not.toBeNull();
    expect(screen().getByRole('heading', { name: '外观' })).not.toBeNull();
  });

  it('renders the v1 shell and moves secondary utilities into the Extra drawer', async () => {
    mockMessages({ activeTabs: [UNIQUE_TAB] });
    getQuickLinks.mockResolvedValue([
      {
        id: 'link-1',
        url: 'https://example.com/',
        label: 'Example',
        icon: null,
        createdAt: '2026-07-07T00:00:00.000Z',
      },
    ]);

    await renderApp();

    expect(container.querySelector('.page-shell')).not.toBeNull();
    expect(container.querySelector('.topbar')).not.toBeNull();
    expect(container.querySelector('.workspace-grid')).not.toBeNull();
    expect(container.querySelector('.extra-drawer-backdrop')).toBeNull();
    expect(screen().getByRole('button', { name: 'Extra' })).not.toBeNull();
    expect(screen().getByRole('button', { name: 'Open settings' })).not.toBeNull();
    expect(screen().getByRole('button', { name: 'Stow current window' })).not.toBeNull();
    expect(screen().getByText('Example')).not.toBeNull();

    expect(screen().getByRole('heading', { name: 'Active tabs' })).not.toBeNull();
    expect(screen().getByRole('heading', { name: 'Saved for later' })).not.toBeNull();
    expect(container.querySelector('.active-workspace.panel.column')).not.toBeNull();
    expect(container.querySelector('.saved-sessions.panel.column')).not.toBeNull();
    expect(container.querySelector('.meta-pill')).not.toBeNull();
    expect(() => screen().getByRole('heading', { name: 'Todos' })).toThrow();
    expect(() => screen().getByRole('heading', { name: 'Appearance' })).toThrow();

    await click(screen().getByRole('button', { name: 'Extra' }));

    expect(container.querySelector('.extra-drawer-backdrop.is-open')).not.toBeNull();
    expect(screen().getByRole('dialog', { name: 'Extra' })).not.toBeNull();
    expect(screen().getByRole('heading', { name: 'Todos' })).not.toBeNull();
    expect(screen().getByRole('heading', { name: 'Appearance' })).not.toBeNull();

    await click(screen().getByRole('button', { name: 'Close extra drawer' }));

    expect(container.querySelector('.extra-drawer-backdrop')).toBeNull();
  });

  it('shows Chrome group sync as a default passive status instead of a checkbox', async () => {
    mockMessages({ activeTabs: [UNIQUE_TAB] });

    await renderApp();

    expect(screen().getByText('Chrome groups synced')).not.toBeNull();
    expect(container.querySelector('.active-workspace .meta-row input[type="checkbox"]')).toBeNull();
    expect(sentMessageTypes()).toEqual(expect.arrayContaining(['active-tabs:snapshot', 'sessions:list']));
  });

  it('keeps v1 layout class contract stable for CSS', async () => {
    mockMessages({ activeTabs: [UNIQUE_TAB] });

    await renderApp();

    const requiredSelectors = [
      '.page-shell',
      '.topbar',
      '.brand-lockup',
      '.mark',
      '.quick-links-panel',
      '.workspace-grid',
      '.active-workspace.panel.column',
      '.saved-sessions.panel.column',
    ];

    for (const selector of requiredSelectors) {
      expect(container.querySelector(selector), selector).not.toBeNull();
    }

    await click(screen().getByRole('button', { name: 'Extra' }));
    expect(container.querySelector('.extra-drawer')).not.toBeNull();
  });

  it('adds and removes quick links through the utility panel', async () => {
    mockMessages({ activeTabs: [UNIQUE_TAB] });
    saveQuickLinks.mockImplementation(async (links: unknown) => links);

    await renderApp();
    await click(screen().getByRole('button', { name: 'Edit quick links' }));
    await click(screen().getByLabelText('Add quick link'));
    await change(screen().getByLabelText('Quick link URL'), 'https://example.com');
    await click(screen().getByRole('button', { name: 'Fetch' }));
    await change(screen().getByLabelText('Quick link label'), 'Example');
    await click(screen().getByRole('button', { name: 'Add' }));

    expect(promptSpy).not.toHaveBeenCalled();
    expect(saveQuickLinks).toHaveBeenCalledWith([
      expect.objectContaining({
        url: 'https://example.com/',
        label: 'Example',
      }),
    ]);
    expect(screen().getByText('Example')).not.toBeNull();

    await click(screen().getByLabelText('Remove Example'));

    expect(saveQuickLinks).toHaveBeenLastCalledWith([]);
  });

  it('keeps quick-link editing controls hidden until edit mode is enabled', async () => {
    mockMessages({ activeTabs: [UNIQUE_TAB] });
    getQuickLinks.mockResolvedValue([
      {
        id: 'link-1',
        url: 'https://example.com/',
        label: 'Example',
        icon: null,
        createdAt: '2026-07-07T00:00:00.000Z',
      },
    ]);

    await renderApp();

    expect(screen().getByText('Example')).not.toBeNull();
    expect(container.querySelector('.quick-link-card-actions')).toBeNull();
    expect(() => screen().getByLabelText('Add quick link')).toThrow();

    await click(screen().getByRole('button', { name: 'Edit quick links' }));

    expect(screen().getByLabelText('Add quick link')).not.toBeNull();
    expect(screen().getByRole('button', { name: 'Add open tab' })).not.toBeNull();
    expect(container.querySelector('.quick-link-card-actions')).not.toBeNull();
    expect(screen().getByRole('button', { name: 'Show quick links' })).not.toBeNull();
  });

  it('adds a quick link from a bare domain through the utility panel', async () => {
    mockMessages({ activeTabs: [UNIQUE_TAB] });
    saveQuickLinks.mockImplementation(async (links: unknown) => links);

    await renderApp();
    await click(screen().getByRole('button', { name: 'Edit quick links' }));
    await click(screen().getByLabelText('Add quick link'));
    await change(screen().getByLabelText('Quick link URL'), 'google.com');
    await click(screen().getByRole('button', { name: 'Fetch' }));
    await change(screen().getByLabelText('Quick link label'), 'Google');
    await click(screen().getByRole('button', { name: 'Add' }));

    expect(promptSpy).not.toHaveBeenCalled();
    expect(saveQuickLinks).toHaveBeenCalledWith([
      expect.objectContaining({
        url: 'https://google.com/',
        label: 'Google',
      }),
    ]);
    expect(screen().getByText('Google')).not.toBeNull();
  });

  it('adds a quick link from an open-tab chooser', async () => {
    mockMessages({ activeTabs: [INVALID_QUICK_LINK_TAB, UNIQUE_TAB] });
    saveQuickLinks.mockImplementation(async (links: unknown) => links);

    await renderApp();
    await click(screen().getByRole('button', { name: 'Edit quick links' }));
    await click(screen().getByRole('button', { name: 'Add open tab' }));
    expect(screen().getByRole('dialog', { name: 'Choose open tab' })).not.toBeNull();
    expect(document.activeElement).toBe(screen().getByRole('button', { name: 'Spec draft' }));
    expect(() => screen().getByRole('button', { name: 'Settings' })).toThrow();
    await click(screen().getByRole('button', { name: 'Add' }));

    expect(promptSpy).not.toHaveBeenCalled();
    expect(saveQuickLinks).toHaveBeenCalledWith([
      expect.objectContaining({
        url: 'https://docs.example.com/spec',
        label: 'Spec draft',
      }),
    ]);
    expect(screen().getByText('Spec draft')).not.toBeNull();
  });

  it('does not use browser prompt for integrated input actions', async () => {
    mockMessages({ activeTabs: [UNIQUE_TAB] });
    saveQuickLinks.mockImplementation(async (links: unknown) => links);
    saveTodos.mockImplementation(async (todos: unknown) => todos);

    await renderApp();

    await click(screen().getByRole('button', { name: 'Edit quick links' }));
    await click(screen().getByLabelText('Add quick link'));
    await change(screen().getByLabelText('Quick link URL'), 'example.com');
    await click(screen().getByRole('button', { name: 'Cancel' }));

    await click(screen().getByRole('button', { name: 'Add open tab' }));
    await click(screen().getByRole('button', { name: 'Cancel' }));

    await click(screen().getByRole('button', { name: 'Extra' }));
    await click(screen().getByLabelText('Add todo'));
    await click(screen().getByRole('button', { name: 'Cancel' }));

    expect(promptSpy).not.toHaveBeenCalled();
  });

  it('fetches a quick-link preview from a pasted URL before saving', async () => {
    mockMessages({ activeTabs: [UNIQUE_TAB] });
    saveQuickLinks.mockImplementation(async (links: unknown) => links);

    await renderApp();
    await click(screen().getByRole('button', { name: 'Edit quick links' }));
    await click(screen().getByLabelText('Add quick link'));
    await change(screen().getByLabelText('Quick link URL'), 'example.com/docs');
    await click(screen().getByRole('button', { name: 'Fetch' }));

    expect(screen().getByText('example.com')).not.toBeNull();
    expect(container.querySelector<HTMLImageElement>('img.quick-link-site-icon')?.getAttribute('src')).toBe(
      'chrome-extension://tabstow-test/_favicon/?pageUrl=https%3A%2F%2Fexample.com%2Fdocs&size=32',
    );

    await change(screen().getByLabelText('Quick link label'), 'Docs');
    await click(screen().getByRole('button', { name: 'Add' }));

    expect(saveQuickLinks).toHaveBeenCalledWith([
      expect.objectContaining({
        url: 'https://example.com/docs',
        label: 'Docs',
        icon: { kind: 'site', value: null },
      }),
    ]);
  });

  it('edits quick link label and icon metadata through the utility panel', async () => {
    mockMessages({ activeTabs: [UNIQUE_TAB] });
    getQuickLinks.mockResolvedValue([
      {
        id: 'link-1',
        url: 'https://example.com/',
        label: 'Example',
        icon: null,
        createdAt: '2026-07-07T00:00:00.000Z',
      },
    ]);
    saveQuickLinks.mockImplementation(async (links: unknown) => links);

    await renderApp();
    await click(screen().getByRole('button', { name: 'Edit quick links' }));
    await click(screen().getByLabelText('Edit Example'));
    await change(screen().getByLabelText('Quick link label'), 'Example docs');
    await change(screen().getByLabelText('Quick link icon'), '*');
    await click(screen().getByRole('button', { name: 'Save' }));

    expect(promptSpy).not.toHaveBeenCalled();
    expect(saveQuickLinks).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'link-1',
        label: 'Example docs',
        icon: { kind: 'emoji', value: '*' },
      }),
    ]);
    expect(screen().getByText('Example docs')).not.toBeNull();
    expect(screen().getByText('*')).not.toBeNull();
  });

  it('reorders quick links through the utility panel', async () => {
    mockMessages({ activeTabs: [UNIQUE_TAB] });
    getQuickLinks.mockResolvedValue([
      {
        id: 'link-a',
        url: 'https://a.example/',
        label: 'A',
        icon: null,
        createdAt: '2026-07-07T00:00:00.000Z',
      },
      {
        id: 'link-b',
        url: 'https://b.example/',
        label: 'B',
        icon: null,
        createdAt: '2026-07-07T00:00:00.000Z',
      },
    ]);
    saveQuickLinks.mockImplementation(async (links: unknown) => links);

    await renderApp();
    await click(screen().getByRole('button', { name: 'Edit quick links' }));
    await click(screen().getByLabelText('Move B up'));

    expect(saveQuickLinks).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'link-b' }),
      expect.objectContaining({ id: 'link-a' }),
    ]);
  });

  it('keeps current quick links when manual quick-link input is invalid', async () => {
    mockMessages({ activeTabs: [UNIQUE_TAB] });
    getQuickLinks.mockResolvedValue([
      {
        id: 'link-1',
        url: 'https://example.com/',
        label: 'Example',
        icon: null,
        createdAt: '2026-07-07T00:00:00.000Z',
      },
    ]);

    await renderApp();
    await click(screen().getByRole('button', { name: 'Edit quick links' }));
    await click(screen().getByLabelText('Add quick link'));
    await change(screen().getByLabelText('Quick link URL'), 'notaurl');
    await change(screen().getByLabelText('Quick link label'), 'Broken');
    await click(screen().getByRole('button', { name: 'Add' }));

    expect(promptSpy).not.toHaveBeenCalled();
    expect(saveQuickLinks).not.toHaveBeenCalled();
    expect(screen().getByText('Example')).not.toBeNull();
    expect(screen().getByRole('alert').textContent).toBe('Quick link URL is invalid.');
  });

  it('rejects javascript quick-link URLs from manual input', async () => {
    mockMessages({ activeTabs: [UNIQUE_TAB] });
    getQuickLinks.mockResolvedValue([
      {
        id: 'link-1',
        url: 'https://example.com/',
        label: 'Example',
        icon: null,
        createdAt: '2026-07-07T00:00:00.000Z',
      },
    ]);

    await renderApp();
    await click(screen().getByRole('button', { name: 'Edit quick links' }));
    await click(screen().getByLabelText('Add quick link'));
    await change(screen().getByLabelText('Quick link URL'), 'javascript:alert(1)');
    await change(screen().getByLabelText('Quick link label'), 'Bad Link');
    await click(screen().getByRole('button', { name: 'Add' }));

    expect(promptSpy).not.toHaveBeenCalled();
    expect(saveQuickLinks).not.toHaveBeenCalled();
    expect(screen().getByText('Example')).not.toBeNull();
    expect(screen().getByRole('alert').textContent).toBe('Quick link URL is invalid.');
  });

  it('uploads a quick-link image icon as a lightweight token and renders the resolved image', async () => {
    mockMessages({ activeTabs: [UNIQUE_TAB] });
    getQuickLinks.mockResolvedValue([
      {
        id: 'link-1',
        url: 'https://example.com/',
        label: 'Example',
        icon: null,
        createdAt: '2026-07-07T00:00:00.000Z',
      },
    ]);
    saveQuickLinks.mockImplementation(async (links: unknown) => links);
    saveQuickLinkIcon.mockResolvedValue('quick-link-icon:upload-1');
    resolveQuickLinkIconUrl.mockResolvedValue('blob:quick-link-icon-upload-1');

    await renderApp();
    await click(screen().getByRole('button', { name: 'Edit quick links' }));

    const uploadInput = container.querySelector<HTMLInputElement>('input[data-quick-link-upload-id="link-1"]');
    expect(uploadInput).not.toBeNull();
    const upload = new File(['icon-bytes'], 'icon.png', { type: 'image/png' });

    await uploadFile(uploadInput as HTMLInputElement, upload);

    expect(saveQuickLinkIcon).toHaveBeenCalledWith(upload);
    expect(saveQuickLinks).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'link-1',
        icon: { kind: 'image', value: 'quick-link-icon:upload-1' },
      }),
    ]);
    expect(
      saveQuickLinks.mock.calls.some((call) =>
        JSON.stringify(call[0]).includes('data:image/png'),
      ),
    ).toBe(false);
    const image = container.querySelector<HTMLImageElement>('img.quick-link-image-icon');
    expect(image?.getAttribute('src')).toBe('blob:quick-link-icon-upload-1');
  });

  it('renders Chrome default favicons for site quick links and falls back to initials on image error', async () => {
    mockMessages({ activeTabs: [UNIQUE_TAB] });
    getQuickLinks.mockResolvedValue([
      {
        id: 'link-1',
        url: 'https://example.com/docs',
        label: 'Example',
        icon: null,
        createdAt: '2026-07-07T00:00:00.000Z',
      },
    ]);

    await renderApp();

    const favicon = container.querySelector<HTMLImageElement>('img.quick-link-site-icon');
    expect(favicon).not.toBeNull();
    expect(favicon?.getAttribute('src')).toBe(
      'chrome-extension://tabstow-test/_favicon/?pageUrl=https%3A%2F%2Fexample.com%2Fdocs&size=32',
    );

    await act(async () => {
      favicon?.dispatchEvent(new Event('error', { bubbles: true }));
    });

    expect(container.querySelector('img.quick-link-site-icon')).toBeNull();
    expect(screen().getByText('E')).not.toBeNull();
  });

  it('updates theme controls and todo actions from the utility panels', async () => {
    mockMessages({ activeTabs: [UNIQUE_TAB] });
    getTodos.mockResolvedValue([
      {
        id: 'todo-1',
        title: 'Review launch checklist',
        description: 'Remember the migration notes',
        createdAt: '2026-07-07T00:00:00.000Z',
        completed: false,
        completedAt: null,
        dismissed: false,
      },
      {
        id: 'todo-2',
        title: 'Ship notes',
        description: '',
        createdAt: '2026-07-07T00:00:00.000Z',
        completed: true,
        completedAt: '2026-07-07T00:00:00.000Z',
        dismissed: false,
      },
    ]);
    saveThemePreferences.mockImplementation(async (preferences: unknown) => ({
      mode: 'dark',
      paletteId: 'blush',
      surfaceOpacity: 70,
      customBackground: null,
      ...(preferences as object),
    }));
    saveTodos.mockImplementation(async (todos: unknown) => todos);

    await renderApp();
    await click(screen().getByRole('button', { name: 'Extra' }));

    await change(screen().getByLabelText('Palette'), 'blush');
    expect(saveThemePreferences).toHaveBeenCalledWith(
      expect.objectContaining({
        paletteId: 'blush',
      }),
    );
    expect(document.documentElement.dataset.themePalette).toBe('blush');

    await change(screen().getByLabelText('Search todos'), 'launch');
    expect((screen().getByLabelText('Search todos') as HTMLInputElement).value).toBe('launch');

    await change(screen().getByLabelText('Search todos'), '');
    await click(screen().getByText('Clear completed'));
    expect(saveTodos).toHaveBeenLastCalledWith([
      expect.objectContaining({ id: 'todo-1', dismissed: false }),
      expect.objectContaining({ id: 'todo-2', dismissed: true }),
    ]);
  });

  it('adds a todo through an integrated form', async () => {
    mockMessages({ activeTabs: [UNIQUE_TAB] });
    saveTodos.mockImplementation(async (todos: unknown) => todos);

    await renderApp();
    await click(screen().getByRole('button', { name: 'Extra' }));
    await click(screen().getByLabelText('Add todo'));
    await change(screen().getByLabelText('Todo title'), 'Review launch checklist');
    await change(screen().getByLabelText('Todo details'), 'Remember the migration notes');
    await click(screen().getByRole('button', { name: 'Add' }));

    expect(promptSpy).not.toHaveBeenCalled();
    expect(saveTodos).toHaveBeenCalledWith([
      expect.objectContaining({
        title: 'Review launch checklist',
        description: 'Remember the migration notes',
        completed: false,
        dismissed: false,
      }),
    ]);
    expect(screen().getByText('Review launch checklist')).not.toBeNull();
  });

  it('closes the nested Add todo dialog without closing the Extra drawer on Escape', async () => {
    mockMessages({ activeTabs: [UNIQUE_TAB] });

    await renderApp();
    await click(screen().getByRole('button', { name: 'Extra' }));
    await click(screen().getByLabelText('Add todo'));

    expect(screen().getByRole('dialog', { name: 'Add todo' })).not.toBeNull();

    await keyDown('Escape');

    expect(() => screen().getByRole('dialog', { name: 'Add todo' })).toThrow();
    expect(screen().getByRole('dialog', { name: 'Extra' })).not.toBeNull();
  });

  it('saves only a lightweight custom background token in theme preferences', async () => {
    mockMessages({ activeTabs: [UNIQUE_TAB] });
    await renderApp();
    await click(screen().getByRole('button', { name: 'Extra' }));
    const backgroundInput = screen().getByLabelText('Custom background');
    const upload = new File(['small-background'], 'wallpaper.png', { type: 'image/png' });

    saveThemePreferences.mockImplementation(async (preferences: unknown) => ({
      mode: 'light',
      paletteId: 'paper',
      surfaceOpacity: 92,
      customBackground: (preferences as { customBackground: string }).customBackground,
    }));
    saveCustomBackgroundFile.mockResolvedValue('theme-bg:upload-1');
    resolveCustomBackgroundUrl.mockResolvedValue('blob:upload-1');

    await uploadFile(backgroundInput, upload);

    expect(saveCustomBackgroundFile).toHaveBeenCalledWith(upload);
    expect(saveThemePreferences).toHaveBeenCalledWith(
      expect.objectContaining({
        customBackground: 'theme-bg:upload-1',
      }),
    );
    expect(
      saveThemePreferences.mock.calls.some((call) =>
        String((call[0] as { customBackground?: string }).customBackground ?? '').startsWith('data:'),
      ),
    ).toBe(false);
  });

  it('keeps the applied custom background after closing the Extra drawer', async () => {
    mockMessages({ activeTabs: [UNIQUE_TAB] });
    getThemePreferences.mockResolvedValue({
      mode: 'dark',
      paletteId: 'mist',
      surfaceOpacity: 88,
      customBackground: 'theme-bg:stored',
    });
    resolveCustomBackgroundUrl.mockResolvedValue('blob:stored-background');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

    await renderApp();

    expect(document.documentElement.style.getPropertyValue('--dashboard-background-image')).toBe(
      'url("blob:stored-background")',
    );

    await click(screen().getByRole('button', { name: 'Extra' }));
    await click(screen().getByRole('button', { name: 'Close extra drawer' }));

    expect(document.documentElement.style.getPropertyValue('--dashboard-background-image')).toBe(
      'url("blob:stored-background")',
    );
    expect(revokeObjectURL).not.toHaveBeenCalled();
  });

  it('keeps a stored custom background applied when changing palette', async () => {
    mockMessages({ activeTabs: [UNIQUE_TAB] });
    getThemePreferences.mockResolvedValue({
      mode: 'dark',
      paletteId: 'mist',
      surfaceOpacity: 88,
      customBackground: 'theme-bg:stored',
    });
    saveThemePreferences.mockImplementation(async (preferences: unknown) => ({
      mode: 'dark',
      paletteId: (preferences as { paletteId: 'mist' | 'blush' }).paletteId,
      surfaceOpacity: 88,
      customBackground: 'theme-bg:stored',
    }));
    resolveCustomBackgroundUrl.mockResolvedValue('blob:stored-background');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

    await renderApp();
    await click(screen().getByRole('button', { name: 'Extra' }));
    await change(screen().getByLabelText('Palette'), 'blush');

    expect(saveThemePreferences).toHaveBeenCalledWith(
      expect.objectContaining({
        paletteId: 'blush',
      }),
    );
    expect(resolveCustomBackgroundUrl).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).not.toHaveBeenCalled();
    expect(document.documentElement.dataset.themePalette).toBe('blush');
    expect(document.documentElement.style.getPropertyValue('--dashboard-background-image')).toBe(
      'url("blob:stored-background")',
    );
  });

  it('rejects oversized custom background uploads before saving theme preferences', async () => {
    mockMessages({ activeTabs: [UNIQUE_TAB] });
    await renderApp();
    await click(screen().getByRole('button', { name: 'Extra' }));
    const backgroundInput = screen().getByLabelText('Custom background');
    const oversizedFile = new File(['a'.repeat(129 * 1024)], 'wallpaper.png', { type: 'image/png' });

    await uploadFile(backgroundInput, oversizedFile);

    expect(saveThemePreferences).not.toHaveBeenCalled();
    expect(saveCustomBackgroundFile).not.toHaveBeenCalled();
    expect(screen().getByRole('alert').textContent).toBe('Custom background image is too large to save.');
  });

  it('keeps a successful new background upload when old background cleanup fails', async () => {
    mockMessages({ activeTabs: [UNIQUE_TAB] });
    getThemePreferences.mockResolvedValue({
      mode: 'system' as never,
      paletteId: 'paper',
      surfaceOpacity: 92,
      customBackground: 'theme-bg:old-token',
    });
    resolveCustomBackgroundUrl
      .mockResolvedValueOnce('blob:old-token')
      .mockResolvedValueOnce('blob:new-token');
    saveCustomBackgroundFile.mockResolvedValue('theme-bg:new-token');
    saveThemePreferences.mockImplementation(async (preferences: unknown) => ({
      mode: 'light',
      paletteId: 'paper',
      surfaceOpacity: 92,
      customBackground: (preferences as { customBackground: string }).customBackground,
    }));
    deleteCustomBackground.mockImplementation(async (token: string | null | undefined) => {
      if (token === 'theme-bg:old-token') throw new Error('cache delete failed');
    });

    await renderApp();
    await click(screen().getByRole('button', { name: 'Extra' }));
    const backgroundInput = screen().getByLabelText('Custom background');
    const upload = new File(['replacement-background'], 'replacement.png', { type: 'image/png' });

    await uploadFile(backgroundInput, upload);

    expect(saveThemePreferences).toHaveBeenCalledWith(
      expect.objectContaining({
        customBackground: 'theme-bg:new-token',
      }),
    );
    expect(deleteCustomBackground).toHaveBeenCalledWith('theme-bg:old-token');
    expect(deleteCustomBackground).not.toHaveBeenCalledWith('theme-bg:new-token');
    expect(() => screen().getByRole('alert')).toThrow();
  });

  it('closes duplicate tabs from the active workspace action', async () => {
    mockMessages({ activeTabs: DUPLICATE_TABS });

    await renderApp();
    await click(screen().getByRole('button', { name: 'Close 2 duplicates' }));

    expect(sendExtensionMessage).toHaveBeenCalledWith({
      type: 'active-tabs:close',
      tabIds: [9, 10],
    });
  });

  it('disables active workspace close controls and guards close reentry while a close is pending', async () => {
    const pendingClose = deferred<AppResult<{ closed: true; tabCount: number }>>();
    sendExtensionMessage.mockImplementation(async (message: { type: string; tabIds?: number[] }) => {
      if (message.type === 'active-tabs:snapshot') {
        return { ok: true, data: { tabs: DUPLICATE_TABS, chromeGroups: [] } };
      }

      if (message.type === 'active-tabs:list') {
        return { ok: true, data: DUPLICATE_TABS };
      }

      if (message.type === 'sessions:list') {
        return { ok: true, data: SESSIONS };
      }

      if (message.type === 'active-tabs:close') {
        return pendingClose.promise;
      }

      throw new Error(`Unexpected message: ${message.type}`);
    });

    await renderApp();
    await click(screen().getByRole('button', { name: 'Close 2 duplicates' }));

    const duplicateClose = screen().getByRole('button', { name: 'Close 2 duplicates' });
    const groupClose = screen().getByLabelText('Close github com tabs');
    const singleClose = screen().getByLabelText('Close openai/tabstow Issue #10');
    expect(duplicateClose).toHaveProperty('disabled', true);
    expect(groupClose).toHaveProperty('disabled', true);
    expect(singleClose).toHaveProperty('disabled', true);
    expect(container.querySelector('.active-workspace .meta-row input[type="checkbox"]')).toBeNull();
    expect(screen().getByText('Chrome groups synced')).not.toBeNull();
    expect(screen().getByText('Collapse Chrome groups')).toHaveProperty('disabled', true);
    expect(screen().getByText('Import Chrome groups')).toHaveProperty('disabled', true);
    expect(closeCalls()).toHaveLength(1);

    await click(groupClose);
    await click(singleClose);

    expect(closeCalls()).toHaveLength(1);

    pendingClose.resolve({ ok: true, data: { closed: true, tabCount: 2 } });
    await act(async () => {
      await pendingClose.promise;
    });
  });

  it('focuses a tab in its original window', async () => {
    mockMessages({ activeTabs: [DUPLICATE_TABS[0]] });

    await renderApp();
    const focusButton = screen().getByRole('button', {
      name: 'IInbox - Gmailhttps://mail.google.com/mail/u/0/#inbox',
    });
    expect(focusButton).toHaveProperty('className', expect.stringContaining('tab-open-button'));

    await click(focusButton);

    expect(sendExtensionMessage).toHaveBeenCalledWith({
      type: 'active-tabs:focus',
      tabId: 7,
      windowId: 3,
    });
  });

  it('saves a single active tab for later from its row action', async () => {
    let activeTabs = [UNIQUE_TAB];
    let sessions: TabSession[] = [];
    const savedSession: TabSession = {
      id: 'session-1',
      title: 'Spec draft',
      tabs: [
        {
          id: 'saved-tab-1',
          title: 'Spec draft',
          url: 'https://docs.example.com/spec',
          createdAt: '2026-07-07T00:00:00.000Z',
        },
      ],
      sourceWindowId: 4,
      createdAt: '2026-07-07T00:00:00.000Z',
      updatedAt: '2026-07-07T00:00:00.000Z',
      deviceId: 'device-1',
    };
    sendExtensionMessage.mockImplementation(async (message: ExtensionMessage) => {
      if (message.type === 'active-tabs:snapshot') return { ok: true, data: { tabs: activeTabs, chromeGroups: [] } };
      if (message.type === 'active-tabs:list') return { ok: true, data: activeTabs };
      if (message.type === 'sessions:list') return { ok: true, data: sessions };
      if (message.type === 'sessions:stow-tab') {
        activeTabs = [];
        sessions = [savedSession];
        return {
          ok: true,
          data: {
            session: savedSession,
            savedTabCount: 1,
            closedTabCount: 1,
          },
        };
      }
      throw new Error(`Unexpected message: ${message.type}`);
    });

    await renderApp();
    expect(screen().getByText('1 open')).not.toBeNull();

    await click(screen().getByLabelText('Save Spec draft for later'));

    expect(sendExtensionMessage).toHaveBeenCalledWith({
      type: 'sessions:stow-tab',
      tabId: 12,
    });
    expect(sentMessageTypes().filter((type) => type === 'active-tabs:snapshot')).toHaveLength(2);
    expect(sentMessageTypes().filter((type) => type === 'sessions:list')).toHaveLength(2);
    expect(screen().getByText('0 open')).not.toBeNull();
    expect(screen().getByText('Spec draft')).not.toBeNull();
  });

  it('renders every saved tab with favicon title and URL detail', async () => {
    const sessions: TabSession[] = [
      {
        id: 'session-1',
        title: '2 tabs stowed',
        tabs: [
          {
            id: 'saved-tab-1',
            title: 'Example Docs',
            url: 'https://docs.example.com/path',
            favIconUrl: 'https://docs.example.com/favicon.ico',
            createdAt: '2026-07-07T00:00:00.000Z',
          },
          {
            id: 'saved-tab-2',
            title: 'Example Blog',
            url: 'https://blog.example.com/post',
            createdAt: '2026-07-07T00:00:00.000Z',
          },
        ],
        sourceWindowId: 4,
        createdAt: '2026-07-07T00:00:00.000Z',
        updatedAt: '2026-07-07T00:00:00.000Z',
        deviceId: 'device-1',
      },
    ];
    mockMessages({ activeTabs: [UNIQUE_TAB], sessions });

    await renderApp();

    expect(screen().getByText('2 tabs')).not.toBeNull();
    expect(screen().getByText('Example Docs')).not.toBeNull();
    expect(screen().getByText('https://docs.example.com/path')).not.toBeNull();
    expect(screen().getByText('Example Blog')).not.toBeNull();
    expect(screen().getByText('https://blog.example.com/post')).not.toBeNull();
    expect(container.querySelectorAll('.saved-tab-row')).toHaveLength(2);
    expect(container.querySelector<HTMLImageElement>('img.saved-tab-favicon')?.getAttribute('src')).toBe(
      'https://docs.example.com/favicon.ico',
    );
    expect(screen().getByRole('button', { name: 'Restore all' })).not.toBeNull();
    const savedTabLink = container.querySelector<HTMLAnchorElement>('a.saved-tab-row');
    expect(savedTabLink?.getAttribute('href')).toBe('https://docs.example.com/path');
    expect(savedTabLink?.getAttribute('target')).toBe('_blank');
    expect(savedTabLink?.querySelector('img.saved-tab-favicon')).not.toBeNull();

    await act(async () => {
      savedTabLink?.querySelector<HTMLImageElement>('img.saved-tab-favicon')?.dispatchEvent(
        new Event('error', { bubbles: true }),
      );
    });

    expect(savedTabLink?.querySelector('img.saved-tab-favicon')).toBeNull();
    expect(screen().getByText('E')).not.toBeNull();
  });

  it('migrates a stored disabled Chrome group sync state on load', async () => {
    const legacyChromeTabGroups: ActiveWorkspaceState['chromeTabGroups'] = {
      enabled: false,
      mappings: [{ virtualGroupKey: 'manual:manual-1', windowId: 4, chromeGroupId: 88 }],
    };
    let storedWorkspace: ActiveWorkspaceState = {
      ...defaultWorkspace(),
      chromeTabGroups: legacyChromeTabGroups,
    };
    getActiveWorkspaceState.mockImplementation(async () => storedWorkspace);
    updateActiveWorkspaceState.mockImplementation(async (partial: Partial<ReturnType<typeof defaultWorkspace>>) => {
      storedWorkspace = {
        ...storedWorkspace,
        ...partial,
        manualGroups: partial.manualGroups ?? storedWorkspace.manualGroups,
        order: partial.order ?? storedWorkspace.order,
        chromeTabGroups: partial.chromeTabGroups ?? storedWorkspace.chromeTabGroups,
      };
      return storedWorkspace;
    });
    mockMessages({ activeTabs: [UNIQUE_TAB] });

    await renderApp();

    expect(updateActiveWorkspaceState).toHaveBeenCalledWith({
      chromeTabGroups: {
        enabled: true,
        mappings: legacyChromeTabGroups.mappings,
      },
    });
  });

  it('syncs cleared manual groups to Chrome groups with legacy disabled sync state forced on', async () => {
    const syncedChromeGroups: ActiveWorkspaceState['chromeTabGroups'] = {
      enabled: true,
      mappings: [],
    };
    let storedWorkspace: ActiveWorkspaceState = {
      ...defaultWorkspace(),
      manualGroups: {
        groups: [{ id: 'manual-1', name: 'Launch', createdAt: '2026-07-07T00:00:00.000Z' }],
        assignments: { '12': 'manual-1' },
      },
      chromeTabGroups: {
        enabled: false,
        mappings: [{ virtualGroupKey: 'manual:manual-1', windowId: 4, chromeGroupId: 88 }],
      },
    };
    getActiveWorkspaceState.mockImplementation(async () => storedWorkspace);
    updateActiveWorkspaceState.mockImplementation(async (partial: Partial<ReturnType<typeof defaultWorkspace>>) => {
      storedWorkspace = {
        ...storedWorkspace,
        ...partial,
        manualGroups: partial.manualGroups ?? storedWorkspace.manualGroups,
        order: partial.order ?? storedWorkspace.order,
        chromeTabGroups: partial.chromeTabGroups ?? storedWorkspace.chromeTabGroups,
      };
      return storedWorkspace;
    });
    sendExtensionMessage.mockImplementation(async (message: ExtensionMessage) => {
      if (message.type === 'active-tabs:snapshot') {
        return { ok: true, data: { tabs: [UNIQUE_TAB], chromeGroups: [] } };
      }
      if (message.type === 'sessions:list') return { ok: true, data: SESSIONS };
      if (message.type === 'chrome-tab-groups:sync') return { ok: true, data: syncedChromeGroups };
      throw new Error(`Unexpected message: ${message.type}`);
    });

    await renderApp();
    await click(screen().getByLabelText('Move to domain group'));

    expect(sendExtensionMessage).toHaveBeenCalledWith({
      type: 'chrome-tab-groups:sync',
      groups: expect.any(Array),
      state: expect.objectContaining({ enabled: true }),
    });
    expect(updateActiveWorkspaceState).toHaveBeenCalledWith({
      chromeTabGroups: {
        enabled: true,
        mappings: [{ virtualGroupKey: 'manual:manual-1', windowId: 4, chromeGroupId: 88 }],
      },
    });
    expect(updateActiveWorkspaceState).toHaveBeenCalledWith({
      chromeTabGroups: syncedChromeGroups,
    });
  });

  it('clears a manual group assignment when moving a tab back to its domain group', async () => {
    mockMessages({ activeTabs: [UNIQUE_TAB] });
    getActiveWorkspaceState.mockResolvedValue({
      ...defaultWorkspace(),
      manualGroups: {
        groups: [{ id: 'manual-1', name: 'Launch', createdAt: '2026-07-07T00:00:00.000Z' }],
        assignments: { '12': 'manual-1' },
      },
    });

    await renderApp();
    await click(screen().getByLabelText('Move to domain group'));

    expect(updateActiveWorkspaceState).toHaveBeenCalledWith({
      manualGroups: {
        groups: [],
        assignments: {},
      },
    });
  });

  it('disables Chrome group controls while the active workspace state is loading', async () => {
    const pendingWorkspace = deferred<ReturnType<typeof defaultWorkspace>>();
    mockMessages({ activeTabs: [UNIQUE_TAB] });
    getActiveWorkspaceState.mockReturnValue(pendingWorkspace.promise);

    await renderApp();

    expect(container.querySelector('.active-workspace .meta-row input[type="checkbox"]')).toBeNull();
    expect(screen().getByText('Chrome groups synced')).not.toBeNull();
    expect(screen().getByText('Refresh Chrome groups')).toHaveProperty('disabled', true);
    expect(screen().getByText('Collapse Chrome groups')).toHaveProperty('disabled', true);
    expect(screen().getByText('Import Chrome groups')).toHaveProperty('disabled', true);

    pendingWorkspace.resolve(defaultWorkspace());
    await act(async () => {
      await pendingWorkspace.promise;
    });
  });

  it('disables Chrome group collapse when there is no active window to collapse', async () => {
    mockMessages({ activeTabs: [] });

    await renderApp();

    expect(screen().getByText('Collapse Chrome groups')).toHaveProperty('disabled', true);
  });

  it('imports existing Chrome tab groups into the active workspace state', async () => {
    mockMessages({ activeTabs: [UNIQUE_TAB] });

    await renderApp();
    await click(screen().getByText('Import Chrome groups'));

    expect(sendExtensionMessage).toHaveBeenCalledWith({
      type: 'chrome-tab-groups:import',
      tabs: [UNIQUE_TAB],
      manualGroups: {
        groups: [],
        assignments: {},
      },
      state: {
        enabled: true,
        mappings: [],
      },
    });
    expect(updateActiveWorkspaceState).toHaveBeenCalledWith({
      manualGroups: {
        groups: [],
        assignments: {},
      },
      chromeTabGroups: {
        enabled: true,
        mappings: [],
      },
    });
  });

  it('collapses Chrome groups for the active window', async () => {
    mockMessages({ activeTabs: [DUPLICATE_TABS[0]] });

    await renderApp();
    await click(screen().getByText('Collapse Chrome groups'));

    expect(sendExtensionMessage).toHaveBeenCalledWith({
      type: 'chrome-tab-groups:collapse-window',
      windowId: 3,
    });
  });

  it('closes a single tab from its row action', async () => {
    mockMessages({ activeTabs: [UNIQUE_TAB] });

    await renderApp();
    await click(screen().getByLabelText('Close Spec draft'));

    expect(sendExtensionMessage).toHaveBeenCalledWith({
      type: 'active-tabs:close',
      tabIds: [12],
    });
  });

  it('refreshes active tabs after stowing from saved sessions', async () => {
    let activeTabs = [UNIQUE_TAB];
    sendExtensionMessage.mockImplementation(async (message: { type: string; tabIds?: number[] }) => {
      if (message.type === 'active-tabs:snapshot') {
        return { ok: true, data: { tabs: activeTabs, chromeGroups: [] } };
      }

      if (message.type === 'active-tabs:list') {
        return { ok: true, data: activeTabs };
      }

      if (message.type === 'sessions:list') {
        return { ok: true, data: SESSIONS };
      }

      if (message.type === 'sessions:stow-current-window') {
        activeTabs = [];
        return { ok: true, data: { sessionId: 'session-1', savedTabCount: 1, closedTabCount: 1 } };
      }

      throw new Error(`Unexpected message: ${message.type}`);
    });

    await renderApp();
    expect(screen().getByText('1 open')).not.toBeNull();

    await click(screen().getByText('Stow current window'));

    expect(sentMessageTypes().filter((type) => type === 'active-tabs:snapshot')).toHaveLength(2);
    expect(screen().getByText('0 open')).not.toBeNull();
  });

  it('disables active workspace stow while another app action is busy', async () => {
    const pendingStow = deferred<AppResult<StowResult>>();
    sendExtensionMessage.mockImplementation(async (message: { type: string; tabIds?: number[] }) => {
      if (message.type === 'active-tabs:snapshot') {
        return { ok: true, data: { tabs: [UNIQUE_TAB], chromeGroups: [] } };
      }

      if (message.type === 'active-tabs:list') {
        return { ok: true, data: [UNIQUE_TAB] };
      }

      if (message.type === 'sessions:list') {
        return { ok: true, data: SESSIONS };
      }

      if (message.type === 'sessions:stow-current-window') {
        return pendingStow.promise;
      }

      throw new Error(`Unexpected message: ${message.type}`);
    });

    await renderApp();
    await click(screen().getByText('Stow current window'));

    expect(() => screen().getByText('Stow this window')).toThrow();
    expect(container.querySelector('.active-workspace .meta-row input[type="checkbox"]')).toBeNull();
    expect(screen().getByText('Chrome groups synced')).not.toBeNull();
    expect(screen().getByText('Refresh Chrome groups')).toHaveProperty('disabled', true);
    expect(screen().getByText('Collapse Chrome groups')).toHaveProperty('disabled', true);
    expect(screen().getByText('Import Chrome groups')).toHaveProperty('disabled', true);

    pendingStow.resolve({
      ok: true,
      data: {
        session: {
          id: 'session-1',
          title: 'Session 1',
          tabs: [],
          createdAt: '2026-07-07T00:00:00.000Z',
          updatedAt: '2026-07-07T00:00:00.000Z',
          deviceId: 'device-1',
        },
        savedTabCount: 1,
        closedTabCount: 1,
      },
    });
    await act(async () => {
      await pendingStow.promise;
    });
  });

  it('guards same-frame stow reentry and only sends one stow message', async () => {
    const pendingStow = deferred<AppResult<StowResult>>();
    sendExtensionMessage.mockImplementation(async (message: { type: string; tabIds?: number[] }) => {
      if (message.type === 'active-tabs:snapshot') {
        return { ok: true, data: { tabs: [UNIQUE_TAB], chromeGroups: [] } };
      }

      if (message.type === 'sessions:list') {
        return { ok: true, data: SESSIONS };
      }

      if (message.type === 'sessions:stow-current-window') {
        return pendingStow.promise;
      }

      throw new Error(`Unexpected message: ${message.type}`);
    });

    await renderApp();
    const stowButton = screen().getByText('Stow current window');

    await act(async () => {
      stowButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      stowButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(sentMessageTypes().filter((type) => type === 'sessions:stow-current-window')).toHaveLength(1);

    pendingStow.resolve({
      ok: true,
      data: {
        session: {
          id: 'session-1',
          title: 'Session 1',
          tabs: [],
          createdAt: '2026-07-07T00:00:00.000Z',
          updatedAt: '2026-07-07T00:00:00.000Z',
          deviceId: 'device-1',
        },
        savedTabCount: 1,
        closedTabCount: 1,
      },
    });
    await act(async () => {
      await pendingStow.promise;
    });
  });

  it('keeps only the latest active workspace refresh result when refreshes race', async () => {
    const firstRefresh = deferred<AppResult<ActiveTabsSnapshot>>();
    const secondRefresh = deferred<AppResult<ActiveTabsSnapshot>>();
    let refreshCount = 0;

    sendExtensionMessage.mockImplementation(async (message: { type: string; tabIds?: number[] }) => {
      if (message.type === 'active-tabs:snapshot') {
        refreshCount += 1;
        return refreshCount === 1 ? firstRefresh.promise : secondRefresh.promise;
      }

      if (message.type === 'sessions:list') {
        return { ok: true, data: SESSIONS };
      }

      if (message.type === 'sessions:stow-current-window') {
        return { ok: true, data: { sessionId: 'session-1', savedTabCount: 1, closedTabCount: 1 } };
      }

      throw new Error(`Unexpected message: ${message.type}`);
    });

    await renderApp();
    await click(screen().getByText('Stow current window'));

    secondRefresh.resolve({ ok: true, data: { tabs: [], chromeGroups: [] } });
    await act(async () => {
      await secondRefresh.promise;
    });
    expect(screen().getByText('0 open')).not.toBeNull();

    firstRefresh.resolve({ ok: true, data: { tabs: [UNIQUE_TAB], chromeGroups: [] } });
    await act(async () => {
      await firstRefresh.promise;
    });

    expect(screen().getByText('0 open')).not.toBeNull();
    expect(container.textContent).not.toContain('1 open');
  });
});

function defaultWorkspace(): ActiveWorkspaceState {
  return {
    manualGroups: { groups: [], assignments: {} },
    order: { groupOrder: [], pinnedGroupKeys: [], groupTabOrder: {} },
    chromeTabGroups: { enabled: true, mappings: [] },
  };
}

function mockMessages({ activeTabs, sessions = SESSIONS }: { activeTabs: ActiveBrowserTab[]; sessions?: TabSession[] }) {
  sendExtensionMessage.mockImplementation(async (message: ExtensionMessage) => {
    if (message.type === 'active-tabs:snapshot') {
      return { ok: true, data: { tabs: activeTabs, chromeGroups: [] } satisfies ActiveTabsSnapshot };
    }

    if (message.type === 'active-tabs:list') {
      return { ok: true, data: activeTabs };
    }

    if (message.type === 'sessions:list') {
      return { ok: true, data: sessions };
    }

    if (message.type === 'active-tabs:close') {
      return { ok: true, data: { closed: true, tabCount: message.tabIds?.length ?? 0 } };
    }

    if (message.type === 'active-tabs:focus') {
      return { ok: true, data: { focused: true } };
    }

    if (message.type === 'chrome-tab-groups:sync') {
      return { ok: true, data: message.state };
    }

    if (message.type === 'chrome-tab-groups:import') {
      return {
        ok: true,
        data: {
          manualGroups: message.manualGroups,
          chromeTabGroups: message.state,
        },
      };
    }

    if (message.type === 'chrome-tab-groups:collapse-window') {
      return { ok: true, data: { collapsed: true, groupCount: 1 } };
    }

    if (message.type === 'sessions:stow-current-window') {
      return { ok: true, data: { sessionId: 'session-1', savedTabCount: 2, closedTabCount: 2 } };
    }

    throw new Error(`Unexpected message: ${message.type}`);
  });
}

async function renderApp() {
  await act(async () => {
    root.render(<App />);
  });
}

async function click(element: HTMLElement) {
  await act(async () => {
    if (element instanceof HTMLButtonElement && element.type === 'submit' && element.form) {
      if (typeof element.form.requestSubmit === 'function') {
        element.form.requestSubmit(element);
        return;
      }
      element.click();
      return;
    }
    element.click();
  });
}

async function keyDown(key: string) {
  await act(async () => {
    const target =
      document.activeElement instanceof HTMLElement && document.activeElement !== document.body
        ? document.activeElement
        : document.body;
    target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key }));
  });
}

async function change(element: HTMLElement, value: string) {
  await act(async () => {
    if (element instanceof HTMLInputElement) {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(element, value);
    } else if (element instanceof HTMLSelectElement) {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
      setter?.call(element, value);
    } else if (element instanceof HTMLTextAreaElement) {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      setter?.call(element, value);
    }
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

async function uploadFile(element: HTMLElement, file: File) {
  await act(async () => {
    if (!(element instanceof HTMLInputElement)) {
      throw new Error('Expected file input.');
    }
    Object.defineProperty(element, 'files', {
      configurable: true,
      value: [file],
    });
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function sentMessageTypes() {
  return sendExtensionMessage.mock.calls.map((call) => (call[0] as { type: string }).type);
}

function closeCalls() {
  return sendExtensionMessage.mock.calls.filter((call) => call[0]?.type === 'active-tabs:close');
}

function screen() {
  return {
    getByRole(role: string, options?: { name?: string }) {
      const elements = Array.from(container.querySelectorAll<HTMLElement>('*')).filter((element) => {
        if (role === 'button') return element.tagName === 'BUTTON';
        if (role === 'heading') return /^H[1-6]$/.test(element.tagName);
        if (role === 'alert') return element.getAttribute('role') === 'alert';
        return element.getAttribute('role') === role;
      });
      const match = elements.find((element) => matchesName(element, options?.name));
      if (!match) throw new Error(`Missing role: ${role} ${options?.name ?? ''}`.trim());
      return match;
    },
    getByLabelText(label: string) {
      const match = Array.from(container.querySelectorAll<HTMLElement>('*')).find(
        (element) => element.getAttribute('aria-label') === label,
      );
      if (!match) throw new Error(`Missing label: ${label}`);
      return match;
    },
    getByText(text: string) {
      const match = Array.from(container.querySelectorAll<HTMLElement>('*')).find(
        (element) => element.textContent?.trim() === text,
      );
      if (!match) throw new Error(`Missing text: ${text}`);
      return match;
    },
  };
}

function matchesName(element: HTMLElement, name: string | undefined) {
  if (!name) return true;
  return getAccessibleName(element) === name;
}

function getAccessibleName(element: HTMLElement) {
  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel) return ariaLabel;

  const labelledBy = element.getAttribute('aria-labelledby');
  if (labelledBy) {
    const label = labelledBy
      .split(/\s+/)
      .map((id) => container.querySelector<HTMLElement>(`#${id}`)?.textContent?.trim() ?? '')
      .join(' ')
      .trim();
    if (label) return label;
  }

  return element.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}
