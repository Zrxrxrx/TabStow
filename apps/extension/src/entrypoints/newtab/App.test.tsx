import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TabSession } from '@tabstow/core';
import type { ActiveBrowserTab, ManualGroupsState } from '@/features/active-tabs/types';
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
    getTodos.mockResolvedValue([]);
    saveTodos.mockImplementation(async (todos: unknown) => todos);
    getThemePreferences.mockResolvedValue({
      mode: 'system',
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
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('renders Chrome group controls below the active workspace header and before the stow hint', async () => {
    mockMessages({ activeTabs: [DUPLICATE_TABS[0]] });

    await renderApp();

    expect(screen().getByRole('heading', { name: 'Active tabs' })).not.toBeNull();
    expect(screen().getByText('Stow this window')).not.toBeNull();
    expect(screen().getByText('1 open')).not.toBeNull();
    expect(sentMessageTypes()).toEqual(expect.arrayContaining(['active-tabs:list', 'sessions:list']));

    const mainText = container.textContent ?? '';
    expect(mainText.indexOf('Active tabs')).toBeLessThan(mainText.indexOf('No saved sessions yet.'));
    const sectionHeader = container.querySelector('.active-workspace .section-header');
    const controls = container.querySelector('.active-workspace .active-workspace-controls');
    const hint = container.querySelector('.active-workspace .active-workspace-hint');

    expect(sectionHeader?.nextElementSibling).toBe(controls);
    expect(controls?.nextElementSibling).toBe(hint);
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

    expect(screen().getByRole('heading', { name: 'Quick links' })).not.toBeNull();
    expect(screen().getByText('Example')).not.toBeNull();
    expect(screen().getByRole('heading', { name: 'Todos' })).not.toBeNull();
    expect(screen().getByText('Review launch checklist')).not.toBeNull();
    expect(screen().getByRole('heading', { name: 'Appearance' })).not.toBeNull();
    expect(document.documentElement.dataset.themeMode).toBe('dark');
    expect(document.documentElement.dataset.themePalette).toBe('sage');
    expect(document.documentElement.lang).toBe('zh-CN');
    expect(resolveCustomBackgroundUrl).toHaveBeenCalledWith('theme-bg:stored');
  });

  it('adds and removes quick links through the utility panel', async () => {
    mockMessages({ activeTabs: [UNIQUE_TAB] });
    saveQuickLinks.mockImplementation(async (links: unknown) => links);
    promptSpy
      .mockReturnValueOnce('https://example.com')
      .mockReturnValueOnce('Example');

    await renderApp();
    await click(screen().getByLabelText('Add quick link'));

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
    promptSpy
      .mockReturnValueOnce('notaurl')
      .mockReturnValueOnce('Broken');

    await renderApp();
    await click(screen().getByLabelText('Add quick link'));

    expect(saveQuickLinks).not.toHaveBeenCalled();
    expect(screen().getByText('Example')).not.toBeNull();
    expect(screen().getByRole('alert').textContent).toBe('Quick link URL is invalid.');
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

  it('saves only a lightweight custom background token in theme preferences', async () => {
    mockMessages({ activeTabs: [UNIQUE_TAB] });
    await renderApp();
    const backgroundInput = screen().getByLabelText('Custom background');
    const upload = new File(['small-background'], 'wallpaper.png', { type: 'image/png' });

    saveThemePreferences.mockImplementation(async (preferences: unknown) => ({
      mode: 'system',
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

  it('rejects oversized custom background uploads before saving theme preferences', async () => {
    mockMessages({ activeTabs: [UNIQUE_TAB] });
    await renderApp();
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
      mode: 'system',
      paletteId: 'paper',
      surfaceOpacity: 92,
      customBackground: 'theme-bg:old-token',
    });
    resolveCustomBackgroundUrl
      .mockResolvedValueOnce('blob:old-token')
      .mockResolvedValueOnce('blob:new-token');
    saveCustomBackgroundFile.mockResolvedValue('theme-bg:new-token');
    saveThemePreferences.mockImplementation(async (preferences: unknown) => ({
      mode: 'system',
      paletteId: 'paper',
      surfaceOpacity: 92,
      customBackground: (preferences as { customBackground: string }).customBackground,
    }));
    deleteCustomBackground.mockImplementation(async (token: string | null | undefined) => {
      if (token === 'theme-bg:old-token') throw new Error('cache delete failed');
    });

    await renderApp();
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
    const syncToggle = container.querySelector<HTMLInputElement>('.active-workspace-controls input[type="checkbox"]');

    expect(duplicateClose).toHaveProperty('disabled', true);
    expect(groupClose).toHaveProperty('disabled', true);
    expect(singleClose).toHaveProperty('disabled', true);
    expect(syncToggle).not.toBeNull();
    expect(syncToggle).toHaveProperty('disabled', true);
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
    await click(screen().getByRole('button', { name: 'Inbox - Gmail' }));

    expect(sendExtensionMessage).toHaveBeenCalledWith({
      type: 'active-tabs:focus',
      tabId: 7,
      windowId: 3,
    });
  });

  it('creates a manual group assignment from the prompt name', async () => {
    mockMessages({ activeTabs: [UNIQUE_TAB] });
    promptSpy.mockReturnValue('Launch');

    await renderApp();
    await click(screen().getByLabelText('Move to manual group'));

    expect(updateActiveWorkspaceState).toHaveBeenCalledTimes(1);
    expect(updateActiveWorkspaceState.mock.calls[0]?.[0]).toEqual({
      manualGroups: {
        groups: [
          expect.objectContaining({
            name: 'Launch',
          }),
        ],
        assignments: {
          '12': expect.any(String),
        },
      },
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

  it('toggles Chrome tab group sync from the active workspace controls', async () => {
    mockMessages({ activeTabs: [UNIQUE_TAB] });

    await renderApp();
    await click(screen().getByText('Sync manual groups to Chrome tab groups'));

    expect(sendExtensionMessage).toHaveBeenCalledWith({
      type: 'chrome-tab-groups:sync',
      groups: expect.any(Array),
      state: {
        enabled: true,
        mappings: [],
      },
    });
    expect(updateActiveWorkspaceState).toHaveBeenCalledWith({
      chromeTabGroups: {
        enabled: true,
        mappings: [],
      },
    });
    expect(screen().getByText('Chrome tab groups enabled.')).not.toBeNull();
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
        enabled: false,
        mappings: [],
      },
    });
    expect(updateActiveWorkspaceState).toHaveBeenCalledWith({
      manualGroups: {
        groups: [],
        assignments: {},
      },
      chromeTabGroups: {
        enabled: false,
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

    expect(sentMessageTypes().filter((type) => type === 'active-tabs:list')).toHaveLength(2);
    expect(screen().getByText('0 open')).not.toBeNull();
  });

  it('disables active workspace stow while another app action is busy', async () => {
    const pendingStow = deferred<AppResult<StowResult>>();
    sendExtensionMessage.mockImplementation(async (message: { type: string; tabIds?: number[] }) => {
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

    const syncToggle = container.querySelector<HTMLInputElement>('.active-workspace-controls input[type="checkbox"]');
    expect(screen().getByText('Stow this window')).toHaveProperty('disabled', true);
    expect(syncToggle).not.toBeNull();
    expect(syncToggle).toHaveProperty('disabled', true);
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
    const firstRefresh = deferred<AppResult<ActiveBrowserTab[]>>();
    const secondRefresh = deferred<AppResult<ActiveBrowserTab[]>>();
    let refreshCount = 0;

    sendExtensionMessage.mockImplementation(async (message: { type: string; tabIds?: number[] }) => {
      if (message.type === 'active-tabs:list') {
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

    secondRefresh.resolve({ ok: true, data: [] });
    await act(async () => {
      await secondRefresh.promise;
    });
    expect(screen().getByText('0 open')).not.toBeNull();

    firstRefresh.resolve({ ok: true, data: [UNIQUE_TAB] });
    await act(async () => {
      await firstRefresh.promise;
    });

    expect(screen().getByText('0 open')).not.toBeNull();
    expect(container.textContent).not.toContain('1 open');
  });
});

function defaultWorkspace() {
  return {
    manualGroups: { groups: [], assignments: {} },
    order: { groupOrder: [], pinnedGroupKeys: [], groupTabOrder: {} },
    chromeTabGroups: { enabled: false, mappings: [] },
  };
}

function mockMessages({ activeTabs, sessions = SESSIONS }: { activeTabs: ActiveBrowserTab[]; sessions?: TabSession[] }) {
  sendExtensionMessage.mockImplementation(async (message: ExtensionMessage) => {
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
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

async function change(element: HTMLElement, value: string) {
  await act(async () => {
    if (
      element instanceof HTMLInputElement
      || element instanceof HTMLSelectElement
      || element instanceof HTMLTextAreaElement
    ) {
      element.value = value;
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
  return element.textContent?.replace(/\s+/g, ' ').trim() === name;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}
