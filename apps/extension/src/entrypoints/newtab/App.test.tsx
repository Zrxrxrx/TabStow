import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TabSession } from '@tabstow/core';
import type { ActiveBrowserTab, ActiveTabsSnapshot } from '@/features/active-tabs/types';
import { reorderQuickLinks, updateQuickLink, type QuickLink } from '@/features/quick-links/quick-links';
import type { AppResult } from '@/lib/errors';
import type { ExtensionMessage, StowResult } from '@/lib/messages';
import { App } from './App';
import { ActiveWorkspace } from './components/ActiveWorkspace';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const { sendExtensionMessage } = vi.hoisted(() => ({
  sendExtensionMessage: vi.fn(),
}));
const { getQuickLinks, saveQuickLinks, updateQuickLinks } = vi.hoisted(() => ({
  getQuickLinks: vi.fn(),
  saveQuickLinks: vi.fn(),
  updateQuickLinks: vi.fn(),
}));
const { chromeRuntimeMocks } = vi.hoisted(() => ({
  chromeRuntimeMocks: {
    getURL: vi.fn((path: string) => `chrome-extension://tabstow-test${path}`),
    openOptionsPage: vi.fn(),
    onMessage: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
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

vi.mock('@/lib/messages', () => ({
  sendExtensionMessage,
}));

vi.mock('@/features/quick-links/quick-links-storage', () => ({
  getQuickLinks,
  saveQuickLinks,
  updateQuickLinks,
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

const SESSIONS: TabSession[] = [];
const SAVED_SESSIONS: TabSession[] = [
  {
    id: 'session-1',
    title: 'Session One',
    tabs: [
      {
        id: 'saved-tab-1',
        title: 'Saved One',
        url: 'https://one.example/',
        createdAt: '2026-07-11T00:00:00.000Z',
      },
      {
        id: 'saved-tab-2',
        title: 'Saved Two',
        url: 'https://two.example/',
        createdAt: '2026-07-11T00:00:00.000Z',
      },
    ],
    createdAt: '2026-07-11T00:00:00.000Z',
    updatedAt: '2026-07-11T00:00:00.000Z',
    deviceId: 'device-1',
  },
  {
    id: 'session-2',
    title: 'Session Two',
    tabs: [
      {
        id: 'saved-tab-3',
        title: 'Saved Three',
        url: 'https://three.example/',
        createdAt: '2026-07-10T00:00:00.000Z',
      },
    ],
    createdAt: '2026-07-10T00:00:00.000Z',
    updatedAt: '2026-07-10T00:00:00.000Z',
    deviceId: 'device-1',
  },
];
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

function createAppChromeEvent() {
  const listeners = new Set<(...args: unknown[]) => void>();
  return {
    addListener: vi.fn((listener: (...args: unknown[]) => void) => listeners.add(listener)),
    removeListener: vi.fn((listener: (...args: unknown[]) => void) => listeners.delete(listener)),
    emit: (...args: unknown[]) => {
      for (const listener of listeners) listener(...args);
    },
  };
}

function installAppChromeEvents() {
  const tabs = {
    onCreated: createAppChromeEvent(),
    onUpdated: createAppChromeEvent(),
    onRemoved: createAppChromeEvent(),
    onMoved: createAppChromeEvent(),
    onAttached: createAppChromeEvent(),
    onDetached: createAppChromeEvent(),
    onActivated: createAppChromeEvent(),
    onReplaced: createAppChromeEvent(),
  };
  const tabGroups = {
    onCreated: createAppChromeEvent(),
    onUpdated: createAppChromeEvent(),
    onRemoved: createAppChromeEvent(),
    onMoved: createAppChromeEvent(),
  };
  const windows = {
    onCreated: createAppChromeEvent(),
    onRemoved: createAppChromeEvent(),
    onFocusChanged: createAppChromeEvent(),
  };
  return {
    tabs,
    tabGroups,
    windows,
    chrome: { runtime: chromeRuntimeMocks, tabs, tabGroups, windows },
  };
}

let container: HTMLDivElement;
let root: Root;
let promptSpy: ReturnType<typeof vi.spyOn>;
let chromeChangeEvents: ReturnType<typeof installAppChromeEvents>;

describe('App', () => {
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    sendExtensionMessage.mockReset();
    getQuickLinks.mockReset();
    saveQuickLinks.mockReset();
    updateQuickLinks.mockReset();
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
    getQuickLinks.mockResolvedValue([]);
    saveQuickLinks.mockImplementation(async (links: unknown) => links);
    updateQuickLinks.mockImplementation(async (update: (currentLinks: unknown[]) => unknown[] | Promise<unknown[]>) => {
      const currentLinks = await getQuickLinks();
      const nextLinks = await update(currentLinks);
      await saveQuickLinks(nextLinks);
      return nextLinks;
    });
    saveQuickLinkIcon.mockResolvedValue('quick-link-icon:token-1');
    resolveQuickLinkIconUrl.mockResolvedValue('blob:quick-link-icon-token-1');
    deleteQuickLinkIcon.mockResolvedValue(undefined);
    getTodos.mockResolvedValue([]);
    saveTodos.mockImplementation(async (todos: unknown) => todos);
    getThemePreferences.mockResolvedValue({ mode: 'light' });
    saveThemePreferences.mockImplementation(async (preferences: unknown) => preferences);
    getLanguagePreference.mockResolvedValue('auto');
    saveLanguagePreference.mockImplementation(async (language: unknown) => language);
    promptSpy = vi.spyOn(window, 'prompt').mockReturnValue(null);
    document.documentElement.removeAttribute('data-theme-mode');
    document.documentElement.removeAttribute('lang');
    chromeRuntimeMocks.getURL.mockClear();
    chromeRuntimeMocks.openOptionsPage.mockClear();
    chromeRuntimeMocks.onMessage.addListener.mockClear();
    chromeRuntimeMocks.onMessage.removeListener.mockClear();
    chromeChangeEvents = installAppChromeEvents();
    Object.defineProperty(globalThis, 'chrome', {
      configurable: true,
      value: chromeChangeEvents.chrome,
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.useRealTimers();
  });

  it('renders focused Chrome windows, pinned tabs, native groups, and ungrouped tabs in order', async () => {
    const tabs: ActiveBrowserTab[] = [
      {
        ...UNIQUE_TAB,
        favIconUrl: 'https://docs.example.com/favicon.ico',
        id: 20,
        windowId: 8,
        index: 0,
        pinned: true,
        title: 'Pinned',
      },
      { ...UNIQUE_TAB, id: 21, windowId: 8, index: 1, groupId: -1, title: 'Before' },
      { ...UNIQUE_TAB, id: 22, windowId: 8, index: 2, groupId: 31, title: 'Grouped' },
      { ...UNIQUE_TAB, id: 23, windowId: 8, index: 3, groupId: -1, title: 'After' },
      { ...UNIQUE_TAB, id: 24, windowId: 3, index: 0, groupId: -1, title: 'Other window' },
    ];
    sendExtensionMessage.mockImplementation(async (message: ExtensionMessage) => {
      if (message.type === 'sessions:stow-current-window-preview') {
        return { ok: true, data: { eligibleTabCount: tabs.length } };
      }

      if (message.type === 'active-tabs:snapshot') {
        return {
          ok: true,
          data: activeTabsSnapshot(tabs, {
            focusedWindowId: 8,
            chromeGroups: [
              { id: 31, windowId: 8, title: 'Reading', color: 'blue', collapsed: true },
            ],
          }),
        };
      }
      if (message.type === 'sessions:list') return { ok: true, data: SESSIONS };
      throw new Error(`Unexpected message: ${message.type}`);
    });

    await renderApp();

    expect(screen().getByRole('heading', { name: 'Current window' })).not.toBeNull();
    expect(screen().getByRole('heading', { name: 'Window 2' })).not.toBeNull();
    expect(screen().getByText('Pinned tabs')).not.toBeNull();
    expect(screen().getByText('Reading')).not.toBeNull();
    expect(screen().getByText('Collapsed')).not.toBeNull();
    expect(
      container.querySelector<HTMLImageElement>('img.active-tab-favicon')?.getAttribute('src'),
    ).toBe('https://docs.example.com/favicon.ico');
    const activeText = container.querySelector('.active-window-list')?.textContent ?? '';
    expect(activeText.indexOf('Before')).toBeLessThan(activeText.indexOf('Reading'));
    expect(activeText.indexOf('Reading')).toBeLessThan(activeText.indexOf('After'));
    expect(container.textContent).not.toContain('Import Chrome groups');
    expect(container.textContent).not.toContain('Move to domain group');
    expect(container.textContent).not.toContain('Refresh from Chrome');
    expect(container.textContent).not.toContain('Collapse Chrome groups');
    expect(sentMessageTypes()).not.toContain(['chrome-tab-groups', 'sync'].join(':'));
    expect(sentMessageTypes()).not.toContain(['chrome-tab-groups', 'import'].join(':'));
  });

  it('filters active and saved tabs locally while keeping web search and tab actions available', async () => {
    const sessions: TabSession[] = [
      {
        id: 'work',
        title: 'Work',
        tabs: [
          {
            id: 'saved-github',
            title: 'GitHub saved issue',
            url: 'https://github.com/openai/tabstow/issues/44',
            createdAt: '2026-07-11T00:00:00.000Z',
          },
          {
            id: 'saved-mail',
            title: 'Saved mail',
            url: 'https://mail.example.com/inbox',
            createdAt: '2026-07-11T00:00:00.000Z',
          },
        ],
        createdAt: '2026-07-11T00:00:00.000Z',
        updatedAt: '2026-07-11T00:00:00.000Z',
        deviceId: 'device-1',
      },
      {
        id: 'reading',
        title: 'Reading',
        tabs: [
          {
            id: 'saved-article',
            title: 'Saved article',
            url: 'https://example.com/article',
            createdAt: '2026-07-11T00:00:00.000Z',
          },
        ],
        createdAt: '2026-07-10T00:00:00.000Z',
        updatedAt: '2026-07-10T00:00:00.000Z',
        deviceId: 'device-1',
      },
    ];
    mockMessages({
      activeTabs: [
        {
          ...UNIQUE_TAB,
          groupId: 31,
          id: 22,
          index: 0,
          title: 'GitHub active issue',
          url: 'https://github.example.com/openai/tabstow/issues/45',
          windowId: 8,
        },
        {
          ...UNIQUE_TAB,
          groupId: 32,
          id: 23,
          index: 1,
          title: 'Active mail',
          url: 'https://mail.example.com/inbox',
          windowId: 8,
        },
        {
          ...UNIQUE_TAB,
          groupId: -1,
          id: 24,
          index: 0,
          title: 'Other window docs',
          url: 'https://docs.example.com',
          windowId: 12,
        },
      ],
      chromeGroups: [
        { id: 31, windowId: 8, title: 'GitHub group', color: 'blue', collapsed: false },
        { id: 32, windowId: 8, title: 'Mail group', color: 'red', collapsed: false },
      ],
      focusedWindowId: 8,
      sessions,
    });

    await renderApp();

    const tabSearch = screen().getByLabelText('Search active tabs, saved tabs, or the web');
    expect(tabSearch.getAttribute('type')).toBe('search');

    await change(tabSearch, 'GITHUB');

    expect(screen().getByText('GitHub active issue')).not.toBeNull();
    expect(screen().getByText('GitHub group')).not.toBeNull();
    expect(screen().getByText('GitHub saved issue')).not.toBeNull();
    expect(container.textContent).not.toContain('Active mail');
    expect(container.textContent).not.toContain('Mail group');
    expect(container.textContent).not.toContain('Other window docs');
    expect(container.textContent).not.toContain('Saved mail');
    expect(container.textContent).not.toContain('Saved article');
    expect(screen().getByText('1 open')).not.toBeNull();
    expect(screen().getByText('1 session')).not.toBeNull();
    expect(screen().getByText('1 tab')).not.toBeNull();
    expect(screen().getByLabelText('1 session, 1 tab')).not.toBeNull();

    const dragHandle = screen().getByLabelText('Drag GitHub active issue') as HTMLButtonElement;
    expect(dragHandle.disabled).toBe(true);
    expect(dragHandle.draggable).toBe(false);
    expect(
      screen().getByText('GitHub active issue').closest('button') as HTMLButtonElement,
    ).toHaveProperty('disabled', false);
    expect(
      screen().getByLabelText('Save GitHub active issue for later') as HTMLButtonElement,
    ).toHaveProperty('disabled', false);
    expect(
      screen().getByLabelText('Close GitHub active issue') as HTMLButtonElement,
    ).toHaveProperty('disabled', false);
    const savedDragHandles = Array.from(
      container.querySelectorAll<HTMLButtonElement>('.saved-sessions .drag-handle'),
    );
    expect(savedDragHandles).toHaveLength(2);
    expect(savedDragHandles.every((handle) => handle.disabled && !handle.draggable)).toBe(true);
    expect(screen().getByLabelText('Open GitHub saved issue')).toHaveProperty('disabled', false);
    expect(screen().getByLabelText('Move GitHub saved issue to History')).toHaveProperty(
      'disabled',
      false,
    );
    expect(sentMessageTypes()).not.toContain('active-tabs:search');
  });

  it('opens saved tabs on controlled primary and middle clicks without navigating the extension', async () => {
    mockMessages({ activeTabs: [UNIQUE_TAB], sessions: SAVED_SESSIONS });
    await renderApp();

    const row = screen().getByLabelText('Open Saved One');
    const initialUrl = window.location.href;
    const primary = await dispatchMouseEvent(row, 'click', { button: 0 });

    expect(primary.defaultPrevented).toBe(true);
    expect(window.location.href).toBe(initialUrl);
    expect(sendExtensionMessage).toHaveBeenCalledWith({
      type: 'sessions:open-tab',
      sessionId: 'session-1',
      tabId: 'saved-tab-1',
      consume: true,
    });
    expect(screen().getByRole('status').textContent).toBe('Moved tab to History.');

    const middle = await dispatchMouseEvent(row, 'auxclick', { button: 1 });

    expect(middle.defaultPrevented).toBe(true);
    expect(window.location.href).toBe(initialUrl);
    expect(sendExtensionMessage).toHaveBeenCalledWith({
      type: 'sessions:open-tab',
      sessionId: 'session-1',
      tabId: 'saved-tab-1',
      consume: false,
    });
  });

  it('ignores modified primary and right clicks but handles every middle click', async () => {
    mockMessages({ activeTabs: [UNIQUE_TAB], sessions: SAVED_SESSIONS });
    await renderApp();

    const row = screen().getByLabelText('Open Saved One');
    const modified = await dispatchMouseEvent(row, 'click', { button: 0, metaKey: true });
    const right = await dispatchMouseEvent(row, 'auxclick', { button: 2 });
    const modifiedMiddle = await dispatchMouseEvent(row, 'auxclick', {
      button: 1,
      altKey: true,
      ctrlKey: true,
      metaKey: true,
      shiftKey: true,
    });

    expect(modified.defaultPrevented).toBe(false);
    expect(right.defaultPrevented).toBe(false);
    expect(modifiedMiddle.defaultPrevented).toBe(true);
    expect(sendExtensionMessage).toHaveBeenCalledWith({
      type: 'sessions:open-tab',
      sessionId: 'session-1',
      tabId: 'saved-tab-1',
      consume: false,
    });
  });

  it('moves deleted saved tabs and sessions to History and explains destructive restores', async () => {
    mockMessages({ activeTabs: [UNIQUE_TAB], sessions: SAVED_SESSIONS });
    await renderApp();

    await click(screen().getByLabelText('Move Saved One to History'));
    expect(sendExtensionMessage).toHaveBeenCalledWith({
      type: 'sessions:delete-tab',
      sessionId: 'session-1',
      tabId: 'saved-tab-1',
    });
    expect(screen().getByRole('status').textContent).toBe('Moved tab to History.');

    await click(screen().getByLabelText('Move Session One to History'));
    expect(sendExtensionMessage).toHaveBeenCalledWith({
      type: 'sessions:delete',
      sessionId: 'session-1',
    });
    expect(screen().getByRole('status').textContent).toBe('Moved saved session to History.');

    await click(screen().getByLabelText('Restore Session One and move to History'));
    expect(sendExtensionMessage).toHaveBeenCalledWith({
      type: 'sessions:restore',
      sessionId: 'session-1',
    });
    expect(screen().getByRole('status').textContent).toBe(
      'Restored 2 tabs and moved the session to History.',
    );
  });

  it('persists cross-session saved tab drops and session reordering by ID', async () => {
    mockMessages({ activeTabs: [UNIQUE_TAB], sessions: SAVED_SESSIONS });
    await renderApp();

    const tabTransfer = createDataTransfer();
    await dragStart(screen().getByLabelText('Drag saved tab Saved Two'), tabTransfer);
    const tabTarget = screen().getByLabelText('Drop saved tab before Saved Three');
    const tabDragOver = await dragOver(tabTarget, tabTransfer);

    expect(tabDragOver.defaultPrevented).toBe(true);
    expect(tabTarget.className).toContain('is-active-drop-target');
    await drop(tabTarget, tabTransfer);

    expect(sendExtensionMessage).toHaveBeenCalledWith({
      type: 'sessions:move-tab',
      request: {
        sourceSessionId: 'session-1',
        tabId: 'saved-tab-2',
        destinationSessionId: 'session-2',
        destinationIndex: 0,
      },
    });
    expect(screen().getByRole('status').textContent).toBe('Moved saved tab.');

    const sessionTransfer = createDataTransfer();
    await dragStart(screen().getByLabelText('Drag saved session Session Two'), sessionTransfer);
    await drop(screen().getByLabelText('Drop saved session before Session One'), sessionTransfer);

    expect(sendExtensionMessage).toHaveBeenCalledWith({
      type: 'sessions:reorder',
      orderedIds: ['session-2', 'session-1'],
    });
    expect(screen().getByRole('status').textContent).toBe('Reordered saved sessions.');
    expect(sentMessageTypes().filter((type) => type === 'sessions:list').length).toBeGreaterThan(2);
  });

  it('rejects malformed, external, and stale saved drag payloads', async () => {
    mockMessages({ activeTabs: [UNIQUE_TAB], sessions: SAVED_SESSIONS });
    await renderApp();

    const target = screen().getByLabelText('Drop saved tab before Saved Three');
    const externalTransfer = createDataTransfer();
    externalTransfer.setData(
      'application/x-tabstow-saved-tabs',
      JSON.stringify({ kind: 'tab', sessionId: 'session-1', tabId: 'saved-tab-2' }),
    );
    const externalDragOver = await dragOver(target, externalTransfer);
    expect(externalDragOver.defaultPrevented).toBe(false);
    await drop(target, externalTransfer);

    const malformedTransfer = createDataTransfer();
    await dragStart(screen().getByLabelText('Drag saved tab Saved Two'), malformedTransfer);
    malformedTransfer.setData('application/x-tabstow-saved-tabs', '{');
    await drop(target, malformedTransfer);

    const staleTransfer = createDataTransfer();
    await dragStart(screen().getByLabelText('Drag saved tab Saved Two'), staleTransfer);
    staleTransfer.setData(
      'application/x-tabstow-saved-tabs',
      JSON.stringify({ kind: 'tab', sessionId: 'session-1', tabId: 'saved-tab-1' }),
    );
    await drop(target, staleTransfer);

    expect(sentMessageTypes()).not.toContain('sessions:move-tab');
  });

  it('localizes Saved action success messages', async () => {
    getLanguagePreference.mockResolvedValue('zh-CN');
    mockMessages({ activeTabs: [UNIQUE_TAB], sessions: SAVED_SESSIONS });
    await renderApp();

    await click(screen().getByLabelText('将Saved One移至历史记录'));

    expect(screen().getByRole('status').textContent).toBe('已将标签页移至历史记录。');
  });

  it('reloads authoritative sessions and clears drag state after a failed saved drop', async () => {
    let sessionListCalls = 0;
    sendExtensionMessage.mockImplementation(async (message: ExtensionMessage) => {
      if (message.type === 'active-tabs:snapshot') {
        return { ok: true, data: activeTabsSnapshot([UNIQUE_TAB]) };
      }
      if (message.type === 'sessions:list') {
        sessionListCalls += 1;
        return { ok: true, data: SAVED_SESSIONS };
      }
      if (message.type === 'sessions:move-tab') {
        return { ok: false, error: { code: 'storage-error', message: 'Saved move failed' } };
      }
      throw new Error(`Unexpected message: ${message.type}`);
    });
    await renderApp();

    const transfer = createDataTransfer();
    const target = screen().getByLabelText('Drop saved tab before Saved Three');
    await dragStart(screen().getByLabelText('Drag saved tab Saved Two'), transfer);
    await dragOver(target, transfer);
    expect(target.className).toContain('is-active-drop-target');
    await dragLeave(target, transfer);
    expect(target.className).not.toContain('is-active-drop-target');
    await dragOver(target, transfer);
    await drop(target, transfer);

    expect(screen().getByRole('alert').textContent).toBe('Saved move failed');
    expect(sessionListCalls).toBe(2);
    expect(target.className).not.toContain('is-active-drop-target');
    expect(screen().getByLabelText('Drag saved tab Saved Two')).toHaveProperty('disabled', false);
  });

  it('coalesces Chrome tab, group, and window events into one refresh', async () => {
    vi.useFakeTimers();
    mockMessages({ activeTabs: [UNIQUE_TAB], focusedWindowId: 4 });
    await renderApp();
    expect(sentMessageTypes().filter((type) => type === 'active-tabs:snapshot')).toHaveLength(1);

    await act(async () => {
      chromeChangeEvents.tabs.onAttached.emit(12, { newWindowId: 4, newPosition: 0 });
      chromeChangeEvents.tabGroups.onMoved.emit({ id: 31, windowId: 4 });
      chromeChangeEvents.windows.onFocusChanged.emit(4);
      await vi.advanceTimersByTimeAsync(150);
    });

    expect(sentMessageTypes().filter((type) => type === 'active-tabs:snapshot')).toHaveLength(2);
  });

  it('drops an unpinned tab onto a Chrome group header', async () => {
    mockChromeWindowWithUngroupedAndGroupedTabs();
    await renderApp();

    const transfer = createDataTransfer();
    await dragStart(screen().getByLabelText('Drag Before'), transfer);
    const target = screen().getByLabelText('Drop into Reading');
    const dragOverEvent = await dragOver(target, transfer);

    expect(dragOverEvent.defaultPrevented).toBe(true);
    expect(target.className).toContain('is-active-drop-target');
    await drop(target, transfer);

    expect(sendExtensionMessage).toHaveBeenCalledWith({
      type: 'active-tabs:move-tab',
      request: {
        tabId: 21,
        destination: {
          windowId: 8,
          lane: { kind: 'group', groupId: 31 },
          position: { kind: 'end' },
        },
      },
    });
    expect(sentMessageTypes().filter((type) => type === 'active-tabs:snapshot')).toHaveLength(2);
  });

  it('drops a complete group at another window end', async () => {
    mockTwoChromeWindowsWithGroup();
    await renderApp();

    const transfer = createDataTransfer();
    await dragStart(screen().getByLabelText('Drag Reading group'), transfer);
    await drop(screen().getByLabelText('Drop at end of Window 2'), transfer);

    expect(sendExtensionMessage).toHaveBeenCalledWith({
      type: 'active-tabs:move-group',
      request: {
        groupId: 31,
        sourceWindowId: 8,
        destination: { windowId: 3, position: { kind: 'end' } },
      },
    });
  });

  it('uses a complete group as a semantic top-level anchor', async () => {
    mockChromeWindowWithUngroupedAndGroupedTabs();
    await renderApp();

    const transfer = createDataTransfer();
    await dragStart(screen().getByLabelText('Drag Before'), transfer);
    await drop(screen().getByLabelText('Drop after Reading'), transfer);

    expect(sendExtensionMessage).toHaveBeenCalledWith({
      type: 'active-tabs:move-tab',
      request: {
        tabId: 21,
        destination: {
          windowId: 8,
          lane: { kind: 'ungrouped' },
          position: { kind: 'after', anchor: { kind: 'group', groupId: 31 } },
        },
      },
    });
  });

  it('offers an empty pinned lane when dragging a pinned tab', async () => {
    const tabs: ActiveBrowserTab[] = [
      { ...UNIQUE_TAB, id: 20, windowId: 8, index: 0, pinned: true, title: 'Pinned' },
      { ...UNIQUE_TAB, id: 30, windowId: 3, index: 0, title: 'Target' },
    ];
    mockMessages({ activeTabs: tabs, focusedWindowId: 8 });
    await renderApp();

    expect(() => screen().getByLabelText('Drop at end of pinned tabs in Window 2')).toThrow();

    const transfer = createDataTransfer();
    await dragStart(screen().getByLabelText('Drag Pinned'), transfer);
    await drop(screen().getByLabelText('Drop at end of pinned tabs in Window 2'), transfer);

    expect(sendExtensionMessage).toHaveBeenCalledWith({
      type: 'active-tabs:move-tab',
      request: {
        tabId: 20,
        destination: {
          windowId: 3,
          lane: { kind: 'pinned' },
          position: { kind: 'end' },
        },
      },
    });
  });

  it('does not accept a pinned tab on a Chrome group target', async () => {
    const tabs: ActiveBrowserTab[] = [
      {
        ...UNIQUE_TAB,
        id: 20,
        windowId: 8,
        index: 0,
        pinned: true,
        groupId: -1,
        title: 'Pinned',
      },
      {
        ...UNIQUE_TAB,
        id: 22,
        windowId: 8,
        index: 1,
        pinned: false,
        groupId: 31,
        title: 'Grouped',
      },
    ];
    mockMessages({
      activeTabs: tabs,
      focusedWindowId: 8,
      chromeGroups: [
        { id: 31, windowId: 8, title: 'Reading', color: 'blue', collapsed: false },
      ],
    });
    await renderApp();

    const transfer = createDataTransfer();
    await dragStart(screen().getByLabelText('Drag Pinned'), transfer);
    const target = screen().getByLabelText('Drop into Reading');
    const dragOverEvent = await dragOver(target, transfer);
    await drop(target, transfer);

    expect(dragOverEvent.defaultPrevented).toBe(false);
    expect(sentMessageTypes()).not.toContain('active-tabs:move-tab');
  });

  it('does not accept a tab insertion target anchored to the dragged tab', async () => {
    mockChromeWindowWithUngroupedAndGroupedTabs();
    await renderApp();

    const transfer = createDataTransfer();
    await dragStart(screen().getByLabelText('Drag Grouped'), transfer);
    const target = screen().getByLabelText('Drop before Grouped in Reading');
    const dragOverEvent = await dragOver(target, transfer);
    const dropEvent = await drop(target, transfer);

    expect(dragOverEvent.defaultPrevented).toBe(false);
    expect(dropEvent.defaultPrevented).toBe(false);
    expect(target.className).not.toContain('is-active-drop-target');
    expect(sentMessageTypes()).not.toContain('active-tabs:move-tab');
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('allows only one drag move while the first response is pending', async () => {
    const pending = deferred<AppResult<{ moved: boolean }>>();
    const tabs: ActiveBrowserTab[] = [
      { ...UNIQUE_TAB, id: 21, windowId: 8, index: 0, groupId: -1, title: 'Before' },
      { ...UNIQUE_TAB, id: 22, windowId: 8, index: 1, groupId: 31, title: 'Grouped' },
    ];
    sendExtensionMessage.mockImplementation(async (message: ExtensionMessage) => {
      if (message.type === 'active-tabs:snapshot') {
        return {
          ok: true,
          data: activeTabsSnapshot(tabs, {
            focusedWindowId: 8,
            chromeGroups: [
              { id: 31, windowId: 8, title: 'Reading', color: 'blue', collapsed: false },
            ],
          }),
        };
      }
      if (message.type === 'sessions:list') return { ok: true, data: SESSIONS };
      if (message.type === 'active-tabs:move-tab') return pending.promise;
      throw new Error(`Unexpected message: ${message.type}`);
    });
    await renderApp();

    const transfer = createDataTransfer();
    await dragStart(screen().getByLabelText('Drag Before'), transfer);
    const target = screen().getByLabelText('Drop into Reading');
    await act(async () => {
      const first = new Event('drop', { bubbles: true, cancelable: true });
      const second = new Event('drop', { bubbles: true, cancelable: true });
      Object.defineProperty(first, 'dataTransfer', { value: transfer });
      Object.defineProperty(second, 'dataTransfer', { value: transfer });
      target.dispatchEvent(first);
      target.dispatchEvent(second);
    });

    expect(sentMessageTypes().filter((type) => type === 'active-tabs:move-tab')).toHaveLength(1);
    pending.resolve({ ok: true, data: { moved: true } });
    await act(async () => {
      await pending.promise;
    });
  });

  it('keeps move controls disabled through the authoritative refresh after a no-op', async () => {
    const pendingMove = deferred<AppResult<{ moved: boolean }>>();
    const pendingRefresh = deferred<AppResult<ActiveTabsSnapshot>>();
    const tabs: ActiveBrowserTab[] = [
      { ...UNIQUE_TAB, id: 21, windowId: 8, index: 0, groupId: -1, title: 'Before' },
      { ...UNIQUE_TAB, id: 22, windowId: 8, index: 1, groupId: 31, title: 'Grouped' },
    ];
    const snapshot = activeTabsSnapshot(tabs, {
      focusedWindowId: 8,
      chromeGroups: [
        { id: 31, windowId: 8, title: 'Reading', color: 'blue', collapsed: false },
      ],
    });
    let snapshotCalls = 0;
    sendExtensionMessage.mockImplementation(async (message: ExtensionMessage) => {
      if (message.type === 'active-tabs:snapshot') {
        snapshotCalls += 1;
        return snapshotCalls === 1 ? { ok: true, data: snapshot } : pendingRefresh.promise;
      }
      if (message.type === 'sessions:list') return { ok: true, data: SESSIONS };
      if (message.type === 'active-tabs:move-tab') return pendingMove.promise;
      throw new Error(`Unexpected message: ${message.type}`);
    });
    await renderApp();

    const transfer = createDataTransfer();
    await dragStart(screen().getByLabelText('Drag Before'), transfer);
    await drop(screen().getByLabelText('Drop into Reading'), transfer);

    expect(screen().getByLabelText('Drag Before')).toHaveProperty('disabled', true);
    expectChromeControlsAbsent();

    pendingMove.resolve({ ok: true, data: { moved: false } });
    await act(async () => {
      await pendingMove.promise;
      await Promise.resolve();
    });

    expect(snapshotCalls).toBe(2);
    expect(screen().getByLabelText('Drag Before')).toHaveProperty('disabled', true);
    expectChromeControlsAbsent();

    pendingRefresh.resolve({ ok: true, data: snapshot });
    await act(async () => {
      await pendingRefresh.promise;
      await Promise.resolve();
    });

    expect(screen().getByLabelText('Drag Before')).toHaveProperty('disabled', false);
    expectChromeControlsAbsent();
  });

  it('keeps a drag pending until a superseding Chrome refresh settles', async () => {
    const staleRefresh = deferred<AppResult<ActiveTabsSnapshot>>();
    const latestRefresh = deferred<AppResult<ActiveTabsSnapshot>>();
    const blockedSecondMove = deferred<AppResult<{ moved: boolean }>>();
    const initialTabs: ActiveBrowserTab[] = [
      { ...UNIQUE_TAB, id: 21, windowId: 8, index: 0, groupId: -1, title: 'Before' },
      { ...UNIQUE_TAB, id: 22, windowId: 8, index: 1, groupId: 31, title: 'Grouped' },
    ];
    const staleTabs = initialTabs.map((tab) =>
      tab.id === 21 ? { ...tab, title: 'Stale Chrome state' } : tab,
    );
    const latestTabs = initialTabs.map((tab) =>
      tab.id === 21 ? { ...tab, title: 'Newest Chrome state' } : tab,
    );
    const snapshotOptions = {
      focusedWindowId: 8,
      chromeGroups: [
        { id: 31, windowId: 8, title: 'Reading', color: 'blue', collapsed: false },
      ] satisfies ActiveTabsSnapshot['chromeGroups'],
    };
    let emitTabUpdated: (() => void) | undefined;
    const onUpdated = {
      addListener: vi.fn((listener: () => void) => {
        emitTabUpdated = listener;
      }),
      removeListener: vi.fn(),
    };
    Object.defineProperty(globalThis, 'chrome', {
      configurable: true,
      value: {
        runtime: chromeRuntimeMocks,
        tabs: { onUpdated },
      },
    });
    let snapshotCalls = 0;
    let moveCalls = 0;
    sendExtensionMessage.mockImplementation(async (message: ExtensionMessage) => {
      if (message.type === 'active-tabs:snapshot') {
        snapshotCalls += 1;
        if (snapshotCalls === 1) {
          return { ok: true, data: activeTabsSnapshot(initialTabs, snapshotOptions) };
        }
        if (snapshotCalls === 2) return staleRefresh.promise;
        if (snapshotCalls === 3) return latestRefresh.promise;
        throw new Error(`Unexpected snapshot call: ${snapshotCalls}`);
      }
      if (message.type === 'sessions:list') return { ok: true, data: SESSIONS };
      if (message.type === 'active-tabs:move-tab') {
        moveCalls += 1;
        return moveCalls === 1
          ? { ok: true, data: { moved: true } }
          : blockedSecondMove.promise;
      }
      throw new Error(`Unexpected message: ${message.type}`);
    });
    await renderApp();

    const transfer = createDataTransfer();
    await dragStart(screen().getByLabelText('Drag Before'), transfer);
    await drop(screen().getByLabelText('Drop into Reading'), transfer);
    await act(async () => {
      await Promise.resolve();
    });
    expect(snapshotCalls).toBe(2);

    await act(async () => {
      emitTabUpdated?.();
      await new Promise((resolve) => window.setTimeout(resolve, 175));
    });
    expect(snapshotCalls).toBe(3);

    staleRefresh.resolve({ ok: true, data: activeTabsSnapshot(staleTabs, snapshotOptions) });
    await act(async () => {
      await staleRefresh.promise;
      await Promise.resolve();
    });

    const dragHandle = screen().getByLabelText('Drag Before');
    expect(dragHandle).toHaveProperty('disabled', true);
    expectChromeControlsAbsent();
    expect(() => screen().getByText('Stale Chrome state')).toThrow();

    const secondTransfer = createDataTransfer();
    await dragStart(dragHandle, secondTransfer);
    await drop(screen().getByLabelText('Drop into Reading'), secondTransfer);
    expect(moveCalls).toBe(1);

    latestRefresh.resolve({ ok: true, data: activeTabsSnapshot(latestTabs, snapshotOptions) });
    await act(async () => {
      await latestRefresh.promise;
      await Promise.resolve();
    });

    expect(screen().getByText('Newest Chrome state')).not.toBeNull();
    expect(screen().getByLabelText('Drag Newest Chrome state')).toHaveProperty('disabled', false);
    expectChromeControlsAbsent();
  });

  it('settles a pending drag refresh on unmount without post-unmount updates', async () => {
    const pendingRefresh = deferred<AppResult<ActiveTabsSnapshot>>();
    const onStatus = vi.fn();
    const tabs: ActiveBrowserTab[] = [
      { ...UNIQUE_TAB, id: 21, windowId: 8, index: 0, groupId: -1, title: 'Before' },
      { ...UNIQUE_TAB, id: 22, windowId: 8, index: 1, groupId: 31, title: 'Grouped' },
    ];
    const snapshot = activeTabsSnapshot(tabs, {
      focusedWindowId: 8,
      chromeGroups: [
        { id: 31, windowId: 8, title: 'Reading', color: 'blue', collapsed: false },
      ],
    });
    let snapshotCalls = 0;
    sendExtensionMessage.mockImplementation(async (message: ExtensionMessage) => {
      if (message.type === 'active-tabs:snapshot') {
        snapshotCalls += 1;
        return snapshotCalls === 1 ? { ok: true, data: snapshot } : pendingRefresh.promise;
      }
      if (message.type === 'active-tabs:move-tab') {
        return { ok: true, data: { moved: true } };
      }
      throw new Error(`Unexpected message: ${message.type}`);
    });

    await act(async () => {
      root.render(
        <ActiveWorkspace
          busy={false}
          locale="en"
          onStatus={onStatus}
          onStowTab={async () => {}}
          query=""
          refreshKey={0}
        />,
      );
    });

    const transfer = createDataTransfer();
    await dragStart(screen().getByLabelText('Drag Before'), transfer);
    await drop(screen().getByLabelText('Drop into Reading'), transfer);
    await act(async () => {
      await Promise.resolve();
    });

    expect(snapshotCalls).toBe(2);
    expect(screen().getByLabelText('Drag Before')).toHaveProperty('disabled', true);

    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });
    expect(onStatus).not.toHaveBeenCalled();

    pendingRefresh.resolve({
      ok: false,
      error: { code: 'chrome-tabs-error', message: 'Late refresh failure' },
    });
    await act(async () => {
      await pendingRefresh.promise;
      await Promise.resolve();
    });

    expect(onStatus).not.toHaveBeenCalled();
  });

  it('reports a failed move and refreshes Chrome state', async () => {
    const tabs: ActiveBrowserTab[] = [
      { ...UNIQUE_TAB, id: 21, windowId: 8, index: 0, groupId: -1, title: 'Before' },
      { ...UNIQUE_TAB, id: 22, windowId: 8, index: 1, groupId: 31, title: 'Grouped' },
    ];
    sendExtensionMessage.mockImplementation(async (message: ExtensionMessage) => {
      if (message.type === 'sessions:stow-current-window-preview') {
        return { ok: true, data: { eligibleTabCount: tabs.length } };
      }

      if (message.type === 'active-tabs:snapshot') {
        return {
          ok: true,
          data: activeTabsSnapshot(tabs, {
            focusedWindowId: 8,
            chromeGroups: [
              { id: 31, windowId: 8, title: 'Reading', color: 'blue', collapsed: false },
            ],
          }),
        };
      }
      if (message.type === 'sessions:list') return { ok: true, data: SESSIONS };
      if (message.type === 'active-tabs:move-tab') {
        return {
          ok: false,
          error: { code: 'chrome-tabs-error', message: 'Target disappeared' },
        };
      }
      throw new Error(`Unexpected message: ${message.type}`);
    });
    await renderApp();

    const transfer = createDataTransfer();
    await dragStart(screen().getByLabelText('Drag Before'), transfer);
    await drop(screen().getByLabelText('Drop into Reading'), transfer);

    expect(screen().getByRole('alert').textContent).toContain('Target disappeared');
    expect(sentMessageTypes().filter((type) => type === 'active-tabs:snapshot')).toHaveLength(2);
  });

  it('renders stored quick links and todos with the fixed persisted theme mode', async () => {
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
    getThemePreferences.mockResolvedValue({ mode: 'dark' });
    getLanguagePreference.mockResolvedValue('zh-CN');

    await renderApp();

    expect(screen().getByRole('heading', { name: '快捷链接' })).not.toBeNull();
    expect(screen().getByText('Example')).not.toBeNull();
    expect(container.querySelector('.quick-links-panel')).not.toBeNull();
    expect(container.querySelector('.quick-link-card')).not.toBeNull();
    expect(container.querySelector('.quick-link-card-actions')).toBeNull();
    expect(document.documentElement.dataset.themeMode).toBe('dark');
    expect(document.documentElement.lang).toBe('zh-CN');

    await click(screen().getByRole('button', { name: '更多' }));
    expect(screen().getByRole('heading', { name: '待办' })).not.toBeNull();
    expect(screen().getByText('Review launch checklist')).not.toBeNull();
    expect(() => screen().getByRole('heading', { name: '外观' })).toThrow();
  });

  it('renders top-bar language and light-dark switches without auto or system choices', async () => {
    mockMessages({ activeTabs: [UNIQUE_TAB] });
    getLanguagePreference.mockResolvedValue('en');
    getThemePreferences.mockResolvedValue({ mode: 'light' });
    saveLanguagePreference.mockImplementation(async (language: unknown) => language);
    saveThemePreferences.mockImplementation(async (preferences: unknown) => ({
      mode: (preferences as { mode: 'light' | 'dark' }).mode,
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

    await click(screen().getByRole('button', { name: '更多' }));
    expect(() => screen().getByLabelText('语言')).toThrow();
    expect(() => screen().getByLabelText('主题模式')).toThrow();
    expect(container.textContent).not.toContain('Auto');
    expect(container.textContent).not.toContain('System');
  });

  it('renders migrated dashboard labels in Simplified Chinese when selected', async () => {
    mockMessages({ activeTabs: [UNIQUE_TAB], sessions: [SAVED_SESSIONS[1]!] });
    getLanguagePreference.mockResolvedValue('zh-CN');

    await renderApp();

    expect(screen().getByRole('heading', { name: '打开的标签页' })).not.toBeNull();
    expect(screen().getByRole('heading', { name: '快捷链接' })).not.toBeNull();
    expect(screen().getByRole('heading', { name: '稍后查看' })).not.toBeNull();
    expect(screen().getByText('1 个会话')).not.toBeNull();
    expect(screen().getByText('1 个标签页')).not.toBeNull();
    expect(screen().getByLabelText('1 个会话，1 个标签页')).not.toBeNull();
    expect(screen().getByLabelText('搜索打开的标签页、已保存标签页或网页')).not.toBeNull();
    expect(screen().getByLabelText('编辑快捷链接')).not.toBeNull();
    expect(screen().getByText('收起当前窗口')).not.toBeNull();
    expect(() => screen().getByRole('heading', { name: 'Quick links' })).toThrow();
    expect(() => screen().getByRole('heading', { name: 'Saved for later' })).toThrow();

    await click(screen().getByRole('button', { name: '更多' }));
    expect(screen().getByRole('heading', { name: '待办' })).not.toBeNull();
    expect(() => screen().getByRole('heading', { name: '外观' })).toThrow();
  });

  it('renders the V2 desktop shell and moves secondary utilities into the Extra drawer', async () => {
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

    expect(container.querySelector('.newtab-shell')).not.toBeNull();
    expect(container.querySelector('.quick-links-rail')).not.toBeNull();
    expect(container.querySelector('.top-strip')).not.toBeNull();
    expect(container.querySelector('.v2-workspace')).not.toBeNull();
    expect(container.querySelector('.active-region')).not.toBeNull();
    expect(container.querySelector('.saved-region')).not.toBeNull();
    expect(container.querySelector('.page-shell')).toBeNull();
    expect(container.querySelector('.topbar')).toBeNull();
    expect(container.querySelector('.workspace-grid')).toBeNull();
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
    expect(() => screen().getByRole('heading', { name: 'Appearance' })).toThrow();

    await click(screen().getByRole('button', { name: 'Close extra drawer' }));

    expect(container.querySelector('.extra-drawer-backdrop')).toBeNull();
  });

  it('keeps the V2 layout class contract stable for CSS', async () => {
    mockMessages({ activeTabs: [UNIQUE_TAB] });

    await renderApp();

    const requiredSelectors = [
      '.newtab-shell',
      '.quick-links-rail',
      '.rail-brand',
      '.rail-links-scroll',
      '.rail-utilities',
      '.newtab-stage',
      '.top-strip',
      '.brand-lockup',
      '.mark',
      '.v2-workspace',
      '.active-region',
      '.saved-region',
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

  it('uses a fresh derived label when the URL changes after fetching', async () => {
    mockMessages({ activeTabs: [UNIQUE_TAB] });
    saveQuickLinks.mockImplementation(async (links: unknown) => links);

    await renderApp();
    await click(screen().getByRole('button', { name: 'Edit quick links' }));
    await click(screen().getByLabelText('Add quick link'));
    await change(screen().getByLabelText('Quick link URL'), 'example.com/docs');
    await click(screen().getByRole('button', { name: 'Fetch' }));
    await change(screen().getByLabelText('Quick link URL'), 'openai.com/research');
    await click(screen().getByRole('button', { name: 'Add' }));

    expect(saveQuickLinks).toHaveBeenCalledWith([
      expect.objectContaining({
        url: 'https://openai.com/research',
        label: 'openai.com',
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
    const shells = Array.from(container.querySelectorAll<HTMLElement>('.quick-link-card-shell'));
    const transfer = createDataTransfer();
    await dragStart(shells[1]!, transfer);
    await drop(shells[0]!, transfer);

    expect(sendExtensionMessage).toHaveBeenCalledWith({
      type: 'quick-links:reorder',
      orderedIds: ['link-b', 'link-a'],
    });
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

  it('renders Chrome default favicons for site quick links and falls back to a neutral glyph', async () => {
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
    expect(container.querySelector('.quick-link-card .favicon-fallback')).not.toBeNull();
  });

  it('falls back to a neutral glyph when a custom quick-link image cannot resolve', async () => {
    mockMessages({ activeTabs: [UNIQUE_TAB] });
    getQuickLinks.mockResolvedValue([
      {
        id: 'link-1',
        url: 'https://example.com/docs',
        label: 'Example',
        icon: { kind: 'image', value: 'quick-link-icon:missing' },
        createdAt: '2026-07-07T00:00:00.000Z',
      },
    ]);
    resolveQuickLinkIconUrl.mockResolvedValue(null);

    await renderApp();

    const favicon = container.querySelector<HTMLImageElement>('img.quick-link-site-icon');
    expect(favicon).not.toBeNull();

    await act(async () => {
      favicon?.dispatchEvent(new Event('error', { bubbles: true }));
    });

    expect(container.querySelector('.quick-link-card .favicon-fallback')).not.toBeNull();
  });

  it('updates todo actions from the Extra panel without appearance controls', async () => {
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
    saveTodos.mockImplementation(async (todos: unknown) => todos);

    await renderApp();
    await click(screen().getByRole('button', { name: 'Extra' }));

    expect(() => screen().getByLabelText('Palette')).toThrow();

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
    const groupedTabs = DUPLICATE_TABS.map((tab) =>
      tab.id === 7 ? tab : { ...tab, groupId: 31 },
    );
    sendExtensionMessage.mockImplementation(async (message: { type: string; tabIds?: number[] }) => {
      if (message.type === 'active-tabs:snapshot') {
        return {
          ok: true,
          data: activeTabsSnapshot(groupedTabs, {
            chromeGroups: [
              { id: 31, windowId: 3, title: 'Issues', color: 'blue', collapsed: false },
            ],
          }),
        };
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
    const groupClose = screen().getByLabelText('Close Issues tabs');
    const singleClose = screen().getByLabelText('Close openai/tabstow Issue #10');
    expect(duplicateClose).toHaveProperty('disabled', true);
    expect(groupClose).toHaveProperty('disabled', true);
    expect(singleClose).toHaveProperty('disabled', true);
    expectChromeControlsAbsent();
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
      name: 'Inbox - Gmailhttps://mail.google.com/mail/u/0/#inbox',
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
      if (message.type === 'active-tabs:snapshot') {
        return { ok: true, data: activeTabsSnapshot(activeTabs) };
      }
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
            favIconUrl: 'https://tracker.evil.example/favicon.ico',
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
      'chrome-extension://tabstow-test/_favicon/?pageUrl=https%3A%2F%2Fdocs.example.com%2Fpath&size=32',
    );
    expect(
      screen().getByRole('button', { name: 'Restore 2 tabs stowed and move to History' }),
    ).not.toBeNull();
    const savedTabButton = screen().getByLabelText('Open Example Docs');
    expect(savedTabButton.tagName).toBe('BUTTON');
    expect(savedTabButton.getAttribute('href')).toBeNull();
    expect(savedTabButton.querySelector('img.saved-tab-favicon')).not.toBeNull();

    await act(async () => {
      savedTabButton.querySelector<HTMLImageElement>('img.saved-tab-favicon')?.dispatchEvent(
        new Event('error', { bubbles: true }),
      );
    });

    expect(savedTabButton.querySelector('img.saved-tab-favicon')).toBeNull();
    expect(savedTabButton.querySelector('.favicon-fallback')).not.toBeNull();
  });

  it('renders imported non-http saved tabs as inert rows without hrefs', async () => {
    const sessions: TabSession[] = [
      {
        id: 'session-1',
        title: '2 tabs stowed',
        tabs: [
          {
            id: 'saved-tab-1',
            title: 'Unsafe Import',
            url: 'javascript:alert(1)',
            createdAt: '2026-07-07T00:00:00.000Z',
          },
          {
            id: 'saved-tab-2',
            title: 'Safe Docs',
            url: 'https://docs.example.com/path',
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

    expect(screen().getByText('Unsafe Import')).not.toBeNull();
    expect(screen().getByText('javascript:alert(1)')).not.toBeNull();
    expect(container.querySelectorAll('.saved-tab-row')).toHaveLength(2);
    expect(container.querySelectorAll('a.saved-tab-row')).toHaveLength(0);
    const unsafeRow = screen().getByText('Unsafe Import').closest('.saved-tab-row');
    const safeRow = screen().getByText('Safe Docs').closest('.saved-tab-row');
    expect(unsafeRow?.tagName).toBe('DIV');
    expect(unsafeRow?.getAttribute('href')).toBeNull();
    expect(safeRow?.tagName).toBe('DIV');
    expect(safeRow?.getAttribute('href')).toBeNull();
    expect(() => screen().getByLabelText('Open Unsafe Import')).toThrow();
    expect(screen().getByLabelText('Open Safe Docs').tagName).toBe('BUTTON');
  });

  it('omits manual Chrome controls while the active tab snapshot is loading', async () => {
    const pendingSnapshot = deferred<AppResult<ActiveTabsSnapshot>>();
    sendExtensionMessage.mockImplementation(async (message: ExtensionMessage) => {
      if (message.type === 'active-tabs:snapshot') return pendingSnapshot.promise;
      if (message.type === 'sessions:list') return { ok: true, data: SESSIONS };
      throw new Error(`Unexpected message: ${message.type}`);
    });

    await renderApp();

    expectChromeControlsAbsent();

    pendingSnapshot.resolve({ ok: true, data: activeTabsSnapshot([UNIQUE_TAB]) });
    await act(async () => {
      await pendingSnapshot.promise;
    });
  });

  it('omits manual Chrome controls when there is no active window', async () => {
    mockMessages({ activeTabs: [] });

    await renderApp();

    expectChromeControlsAbsent();
  });

  it('does not offer manual Chrome controls for the focused window', async () => {
    mockMessages({ activeTabs: [UNIQUE_TAB], focusedWindowId: 4 });

    await renderApp();

    expectChromeControlsAbsent();
    expect(sentMessageTypes()).not.toContain('chrome-tab-groups:collapse-window');
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
      if (message.type === 'sessions:stow-current-window-preview') {
        return { ok: true, data: { eligibleTabCount: activeTabs.length } };
      }

      if (message.type === 'active-tabs:snapshot') {
        return { ok: true, data: activeTabsSnapshot(activeTabs) };
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
      if (message.type === 'sessions:stow-current-window-preview') {
        return { ok: true, data: { eligibleTabCount: 1 } };
      }

      if (message.type === 'active-tabs:snapshot') {
        return { ok: true, data: activeTabsSnapshot([UNIQUE_TAB]) };
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
    expectChromeControlsAbsent();

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
        closedTabCount: 0,
      },
    });
    await act(async () => {
      await pendingStow.promise;
    });
    expect(screen().getByRole('status').textContent).toContain(
      'Stowed 1 tabs and closed 0.',
    );
  });

  it('guards same-frame stow reentry and only sends one stow message', async () => {
    const pendingStow = deferred<AppResult<StowResult>>();
    sendExtensionMessage.mockImplementation(async (message: { type: string; tabIds?: number[] }) => {
      if (message.type === 'sessions:stow-current-window-preview') {
        return { ok: true, data: { eligibleTabCount: 1 } };
      }

      if (message.type === 'active-tabs:snapshot') {
        return { ok: true, data: activeTabsSnapshot([UNIQUE_TAB]) };
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
      if (message.type === 'sessions:stow-current-window-preview') {
        return { ok: true, data: { eligibleTabCount: 1 } };
      }

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

    secondRefresh.resolve({ ok: true, data: activeTabsSnapshot([]) });
    await act(async () => {
      await secondRefresh.promise;
    });
    expect(screen().getByText('0 open')).not.toBeNull();

    firstRefresh.resolve({
      ok: true,
      data: activeTabsSnapshot([UNIQUE_TAB]),
    });
    await act(async () => {
      await firstRefresh.promise;
    });

    expect(screen().getByText('0 open')).not.toBeNull();
    expect(container.textContent).not.toContain('1 open');
  });

  it('keeps local Quick Link actions enabled while background sync is running', async () => {
    getQuickLinks.mockResolvedValue([
      {
        id: 'link-1',
        url: 'https://one.example/',
        label: 'One',
        icon: null,
        createdAt: '2026-07-07T00:00:00.000Z',
      },
      {
        id: 'link-2',
        url: 'https://two.example/',
        label: 'Two',
        icon: null,
        createdAt: '2026-07-07T00:00:00.000Z',
      },
    ]);
    sendExtensionMessage.mockImplementation(async (message: ExtensionMessage) => {
      if (message.type === 'active-tabs:snapshot') {
        return {
          ok: true,
          data: activeTabsSnapshot([UNIQUE_TAB]),
        };
      }

      if (message.type === 'active-tabs:list') {
        return { ok: true, data: [UNIQUE_TAB] };
      }

      if (message.type === 'sessions:list') {
        return { ok: true, data: SESSIONS };
      }

      if (message.type === 'sync:observe') {
        return {
          ok: true,
          data: {
            phase: 'connected',
            sync: { state: 'syncing' },
            account: { id: 1, login: 'octocat' },
            binding: {
              gistId: 'gist-1',
              fileName: 'tabstow.sync.json',
              public: false,
              htmlUrl: 'https://gist.github.com/octocat/gist-1',
              ownerId: 1,
            },
          },
        };
      }

      throw new Error(`Unexpected message: ${message.type}`);
    });

    await renderApp();
    await click(screen().getByRole('button', { name: 'Edit quick links' }));
    await click(screen().getByLabelText('Add quick link'));
    await change(screen().getByLabelText('Quick link URL'), 'https://example.com');
    await click(screen().getByRole('button', { name: 'Fetch' }));
    await change(screen().getByLabelText('Quick link label'), 'Example');

    expect(container.textContent).not.toContain('Pull');
    expect(container.textContent).not.toContain('Push');
    expect(screen().getByRole('button', { name: 'Show quick links' })).toHaveProperty('disabled', false);
    expect(screen().getByLabelText('Add quick link')).toHaveProperty('disabled', false);
    expect(screen().getByRole('button', { name: 'Add open tab' })).toHaveProperty('disabled', false);
    expect(container.querySelector('.quick-link-card-shell')).toHaveProperty('draggable', true);
    expect(screen().getByLabelText('Upload icon for One')).toHaveProperty('disabled', false);
    expect(screen().getByLabelText('Edit One')).toHaveProperty('disabled', false);
    expect(screen().getByLabelText('Remove One')).toHaveProperty('disabled', false);
    expect(screen().getByRole('button', { name: 'Add' })).toHaveProperty('disabled', false);
    expect(
      container.querySelector<HTMLInputElement>('input[data-quick-link-upload-id="link-1"]')?.disabled,
    ).toBe(false);
  });

  it('refreshes Sessions and Quick Links after a background data-changed event', async () => {
    let storedQuickLinks = [] as Awaited<ReturnType<typeof getQuickLinks>>;
    getQuickLinks.mockImplementation(async () => storedQuickLinks);
    saveQuickLinks.mockImplementation(async (links: typeof storedQuickLinks) => {
      storedQuickLinks = links;
      return links;
    });
    sendExtensionMessage.mockImplementation(async (message: ExtensionMessage) => {
      if (message.type === 'active-tabs:snapshot') {
        return {
          ok: true,
          data: activeTabsSnapshot([UNIQUE_TAB]),
        };
      }

      if (message.type === 'active-tabs:list') {
        return { ok: true, data: [UNIQUE_TAB] };
      }

      if (message.type === 'sessions:list') {
        return { ok: true, data: SESSIONS };
      }

      if (message.type === 'sync:observe') {
        return {
          ok: true,
          data: { phase: 'disconnected', sync: { state: 'disconnected' } },
        };
      }

      throw new Error(`Unexpected message: ${message.type}`);
    });

    await renderApp();
    storedQuickLinks = [
      {
        id: 'remote-1',
        url: 'https://remote.example/',
        label: 'Remote',
        icon: null,
        createdAt: '2026-07-07T00:00:00.000Z',
      },
    ];
    const listener = chromeRuntimeMocks.onMessage.addListener.mock.calls[0]?.[0];
    await act(async () => {
      listener?.({ type: 'sync:data-changed' });
      await Promise.resolve();
    });

    expect(screen().getByText('Remote')).not.toBeNull();
    expect(sendExtensionMessage).toHaveBeenCalledWith({ type: 'sessions:list' });
  });
});

function activeTabsSnapshot(
  tabs: ActiveBrowserTab[],
  options: {
    chromeGroups?: ActiveTabsSnapshot['chromeGroups'];
    focusedWindowId?: number;
  } = {},
): ActiveTabsSnapshot {
  const windowIds = [...new Set(tabs.map((tab) => tab.windowId))].sort((a, b) => a - b);
  const focusedWindowId = options.focusedWindowId ?? windowIds[0];

  return {
    windows: windowIds.map((id) => ({
      id,
      focused: id === focusedWindowId,
      incognito: false,
      type: 'normal',
    })),
    tabs,
    chromeGroups: options.chromeGroups ?? [],
  };
}

function mockMessages({
  activeTabs,
  chromeGroups = [],
  focusedWindowId,
  sessions = SESSIONS,
}: {
  activeTabs: ActiveBrowserTab[];
  chromeGroups?: ActiveTabsSnapshot['chromeGroups'];
  focusedWindowId?: number;
  sessions?: TabSession[];
}) {
  sendExtensionMessage.mockImplementation(async (message: ExtensionMessage) => {
    if (message.type === 'sessions:stow-current-window-preview') {
      return { ok: true, data: { eligibleTabCount: activeTabs.length } };
    }

    if (message.type === 'active-tabs:snapshot') {
      return {
        ok: true,
        data: activeTabsSnapshot(activeTabs, { chromeGroups, focusedWindowId }),
      };
    }

    if (message.type === 'active-tabs:list') {
      return { ok: true, data: activeTabs };
    }

    if (message.type === 'sessions:list') {
      return { ok: true, data: sessions };
    }

    if (message.type === 'sessions:open-tab') {
      return { ok: true, data: { opened: true, consumed: message.consume } };
    }

    if (message.type === 'sessions:delete-tab' || message.type === 'sessions:delete') {
      return { ok: true, data: { deleted: true } };
    }

    if (message.type === 'sessions:restore') {
      const session = sessions.find(({ id }) => id === message.sessionId);
      return { ok: true, data: { restored: true, tabCount: session?.tabs.length ?? 0 } };
    }

    if (message.type === 'sessions:reorder') {
      return { ok: true, data: sessions };
    }

    if (message.type === 'sessions:move-tab') {
      return { ok: true, data: { moved: true } };
    }

    if (message.type === 'active-tabs:close') {
      return { ok: true, data: { closed: true, tabCount: message.tabIds.length } };
    }

    if (message.type === 'active-tabs:focus') {
      return { ok: true, data: { focused: true } };
    }

    if (message.type === 'active-tabs:move-tab' || message.type === 'active-tabs:move-group') {
      return { ok: true, data: { moved: true } };
    }

    if (message.type === 'quick-links:add') {
      const saved = await saveQuickLinks([...((await getQuickLinks()) as QuickLink[]), message.link]);
      return { ok: true, data: saved };
    }

    if (message.type === 'quick-links:update') {
      const currentLinks = (await getQuickLinks()) as QuickLink[];
      const saved = await saveQuickLinks(
        currentLinks.map((link) =>
          link.id === message.linkId ? updateQuickLink(link, message.patch) : link,
        ),
      );
      return { ok: true, data: saved };
    }

    if (message.type === 'quick-links:remove') {
      const saved = await saveQuickLinks(
        ((await getQuickLinks()) as QuickLink[]).filter((link) => link.id !== message.linkId),
      );
      return { ok: true, data: saved };
    }

    if (message.type === 'quick-links:reorder') {
      const saved = await saveQuickLinks(reorderQuickLinks((await getQuickLinks()) as QuickLink[], message.orderedIds));
      return { ok: true, data: saved };
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

type TestDataTransfer = DataTransfer & {
  setProtectedMode: (protectedMode: boolean) => void;
};

function createDataTransfer(): TestDataTransfer {
  const values = new Map<string, string>();
  let protectedMode = false;
  return {
    effectAllowed: 'none',
    dropEffect: 'none',
    get types() {
      return [...values.keys()];
    },
    getData: (type: string) => (protectedMode ? '' : values.get(type) ?? ''),
    setData: (type: string, value: string) => {
      values.set(type, value);
    },
    setProtectedMode: (nextProtectedMode: boolean) => {
      protectedMode = nextProtectedMode;
    },
  } as unknown as TestDataTransfer;
}

async function dispatchDrag(
  element: HTMLElement,
  type: 'dragstart' | 'dragenter' | 'dragover' | 'dragleave' | 'drop' | 'dragend',
  dataTransfer: DataTransfer,
): Promise<Event> {
  (dataTransfer as Partial<TestDataTransfer>).setProtectedMode?.(
    type === 'dragenter' || type === 'dragover',
  );
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
  await act(async () => {
    element.dispatchEvent(event);
  });
  return event;
}

const dragStart = (element: HTMLElement, data: DataTransfer) =>
  dispatchDrag(element, 'dragstart', data);

async function dragOver(element: HTMLElement, data: DataTransfer) {
  await dispatchDrag(element, 'dragenter', data);
  return dispatchDrag(element, 'dragover', data);
}

const dragLeave = (element: HTMLElement, data: DataTransfer) =>
  dispatchDrag(element, 'dragleave', data);

const drop = (element: HTMLElement, data: DataTransfer) =>
  dispatchDrag(element, 'drop', data);

function mockChromeWindowWithUngroupedAndGroupedTabs() {
  const tabs: ActiveBrowserTab[] = [
    { ...UNIQUE_TAB, id: 21, windowId: 8, index: 0, groupId: -1, title: 'Before' },
    { ...UNIQUE_TAB, id: 22, windowId: 8, index: 1, groupId: 31, title: 'Grouped' },
  ];
  mockMessages({
    activeTabs: tabs,
    focusedWindowId: 8,
    chromeGroups: [
      { id: 31, windowId: 8, title: 'Reading', color: 'blue', collapsed: false },
    ],
  });
}

function mockTwoChromeWindowsWithGroup() {
  const tabs: ActiveBrowserTab[] = [
    { ...UNIQUE_TAB, id: 22, windowId: 8, index: 0, groupId: 31, title: 'Grouped' },
    { ...UNIQUE_TAB, id: 30, windowId: 3, index: 0, groupId: -1, title: 'Target' },
  ];
  mockMessages({
    activeTabs: tabs,
    focusedWindowId: 8,
    chromeGroups: [
      { id: 31, windowId: 8, title: 'Reading', color: 'blue', collapsed: false },
    ],
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

async function dispatchMouseEvent(
  element: HTMLElement,
  type: 'click' | 'auxclick',
  init: MouseEventInit,
): Promise<MouseEvent> {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, ...init });
  await act(async () => {
    element.dispatchEvent(event);
  });
  return event;
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

function expectChromeControlsAbsent() {
  expect(container.textContent).not.toContain('Refresh from Chrome');
  expect(container.textContent).not.toContain('Collapse Chrome groups');
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
