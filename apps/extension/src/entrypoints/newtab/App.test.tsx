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

vi.mock('@/lib/messages', () => ({
  sendExtensionMessage,
}));

vi.mock('@/features/active-tabs/active-workspace-storage', () => ({
  getActiveWorkspaceState,
  updateActiveWorkspaceState,
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
    promptSpy = vi.spyOn(window, 'prompt').mockReturnValue(null);
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
