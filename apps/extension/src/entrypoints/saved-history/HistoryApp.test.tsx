import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HistoryEntry } from '@/features/history/types';
import { HistoryApp } from './HistoryApp';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const { sendExtensionMessage, storageGetItem } = vi.hoisted(() => ({
  sendExtensionMessage: vi.fn(),
  storageGetItem: vi.fn(),
}));

vi.mock('@/lib/messages', () => ({ sendExtensionMessage }));
vi.mock('#imports', () => ({
  storage: {
    getItem: storageGetItem,
    setItem: vi.fn(),
  },
}));

const ENTRY: HistoryEntry = {
  id: 'history-1',
  sourceSessionId: 'session-1',
  sourceTitle: 'Reading',
  tabs: [
    {
      id: 'tab-1',
      url: 'https://example.com/',
      title: 'Example',
      favIconUrl: 'https://example.com/favicon.ico',
      createdAt: '2026-07-01T00:00:00.000Z',
    },
  ],
  originalCreatedAt: '2026-07-01T00:00:00.000Z',
  movedAt: '2026-07-10T01:02:03.000Z',
  reason: 'opened',
  deviceId: 'device-1',
};

let container: HTMLDivElement;
let root: Root;
let runtimeMessages: ReturnType<typeof createRuntimeMessageEvent>;

function createRuntimeMessageEvent() {
  const listeners = new Set<(message: unknown) => unknown>();
  return {
    addListener: vi.fn((listener: (message: unknown) => unknown) => listeners.add(listener)),
    removeListener: vi.fn((listener: (message: unknown) => unknown) => listeners.delete(listener)),
    emit(message: unknown) {
      return Array.from(listeners, (listener) => listener(message));
    },
  };
}

describe('HistoryApp', () => {
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    sendExtensionMessage.mockReset();
    storageGetItem.mockReset().mockResolvedValue('en');
    runtimeMessages = createRuntimeMessageEvent();
    Object.defineProperty(globalThis, 'chrome', {
      configurable: true,
      value: {
        runtime: {
          getURL: vi.fn((path: string) => `chrome-extension://tabstow-test${path}`),
          onMessage: runtimeMessages,
        },
      },
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it('loads and renders History entries', async () => {
    sendExtensionMessage.mockResolvedValueOnce({ ok: true, data: [ENTRY] });

    await renderHistory();

    expect(sendExtensionMessage).toHaveBeenCalledWith({ type: 'history:list' });
    expect(getByRole('heading', 'History')).not.toBeNull();
    expect(getByText('Tabstow')).not.toBeNull();
    expect(getByRole('link', 'Back to workspace').getAttribute('href')).toBe(
      'chrome-extension://tabstow-test/newtab.html',
    );
    expect(getByText('Opened from Reading')).not.toBeNull();
    expect(getByText('https://example.com/')).not.toBeNull();
    expect(getByRole('button', 'Open Example in background')).not.toBeNull();
    expect(container.querySelector('time')?.getAttribute('datetime')).toBe(ENTRY.movedAt);
    expect(container.querySelector('.history-empty-state')).toBeNull();
  });

  it('refreshes History for local Saved changes but not sync-only invalidations', async () => {
    sendExtensionMessage
      .mockResolvedValueOnce({ ok: true, data: [ENTRY] })
      .mockResolvedValueOnce({ ok: true, data: [] });

    await renderHistory();
    expect(runtimeMessages.emit({ type: 'sync:data-changed' })).toEqual([undefined]);
    expect(sendExtensionMessage).toHaveBeenCalledTimes(1);

    await act(async () => {
      runtimeMessages.emit({ type: 'saved-data:changed' });
      await Promise.resolve();
    });

    expect(sendExtensionMessage).toHaveBeenCalledTimes(2);
    expect(getByText('History is empty.')).not.toBeNull();
  });

  it('renders the reason and source title for every History reason', async () => {
    sendExtensionMessage.mockResolvedValueOnce({
      ok: true,
      data: [
        ENTRY,
        { ...ENTRY, id: 'history-2', reason: 'restored', sourceTitle: 'Research' },
        { ...ENTRY, id: 'history-3', reason: 'deleted', sourceTitle: 'Archive' },
      ],
    });

    await renderHistory();

    expect(getByText('Opened from Reading')).not.toBeNull();
    expect(getByText('Restored from Research')).not.toBeNull();
    expect(getByText('Removed from Archive')).not.toBeNull();
  });

  it('localizes exact generated source titles and preserves mismatches', async () => {
    storageGetItem.mockResolvedValueOnce('zh-CN');
    sendExtensionMessage.mockResolvedValueOnce({
      ok: true,
      data: [
        { ...ENTRY, id: 'history-generated', sourceTitle: '1 tabs stowed' },
        { ...ENTRY, id: 'history-mismatch', reason: 'restored', sourceTitle: '2 tabs stowed' },
        { ...ENTRY, id: 'history-custom', reason: 'deleted', sourceTitle: '阅读清单' },
      ],
    });

    await renderHistory();

    expect(getByText('从已收起 1 个标签页打开')).not.toBeNull();
    expect(getByText('从2 tabs stowed恢复')).not.toBeNull();
    expect(getByText('从阅读清单移除')).not.toBeNull();
    expect(Array.from(container.querySelectorAll('time')).every((time) => /年|月|日/.test(time.textContent ?? ''))).toBe(true);
  });

  it('shows a loading state while History is being fetched', async () => {
    sendExtensionMessage.mockReturnValueOnce(new Promise(() => {}));

    await renderHistory();

    expect(getByText('Loading History…')).not.toBeNull();
  });

  it('uses the saved language preference', async () => {
    storageGetItem.mockResolvedValueOnce('zh-CN');
    sendExtensionMessage.mockResolvedValueOnce({ ok: true, data: [] });

    await renderHistory();

    expect(getByRole('heading', '历史记录')).not.toBeNull();
    expect(getByText('历史记录为空。')).not.toBeNull();
    expect(
      getByText('从“已保存的窗口”打开、恢复或移除的标签页会保留在此设备上，供你稍后恢复或永久删除。'),
    ).not.toBeNull();
    expect(document.documentElement.lang).toBe('zh-CN');
  });

  it('shows the empty state when History has no entries', async () => {
    sendExtensionMessage.mockResolvedValueOnce({ ok: true, data: [] });

    await renderHistory();

    expect(getByText('History is empty.')).not.toBeNull();
    expect(
      getByText(
        'Tabs opened, restored, or removed from Saved windows stay on this device so you can recover or permanently delete them later.',
      ),
    ).not.toBeNull();
    const emptyState = container.querySelector('.history-empty-state');
    expect(emptyState?.querySelector('a, button')).toBeNull();
    const backToWorkspace = getByRole('link', 'Back to workspace');
    expect(Array.from(container.querySelectorAll('a[href], button'))).toEqual([backToWorkspace]);
  });

  it('shows an initial theme read failure without suppressing History content', async () => {
    sendExtensionMessage.mockResolvedValueOnce({ ok: true, data: [] });

    await renderHistory({ initialThemeError: 'Theme storage unavailable' });

    expect(getByRole('alert', 'Theme storage unavailable')).not.toBeNull();
    expect(getByText('History is empty.')).not.toBeNull();
  });

  it('shows an error returned while loading History', async () => {
    sendExtensionMessage.mockResolvedValueOnce({
      ok: false,
      error: { code: 'unknown-error', message: 'History unavailable.' },
    });

    await renderHistory();

    expect(getByRole('alert', 'History unavailable.')).not.toBeNull();
  });

  it('opens a History tab in the background without consuming the entry', async () => {
    sendExtensionMessage
      .mockResolvedValueOnce({ ok: true, data: [ENTRY] })
      .mockResolvedValueOnce({ ok: true, data: { opened: true } });
    await renderHistory();

    await click(getByRole('button', 'Open Example in background'));

    expect(sendExtensionMessage.mock.calls).toEqual([
      [{ type: 'history:list' }],
      [{ type: 'history:open-tab', historyId: 'history-1', tabId: 'tab-1' }],
    ]);
    expect(getByText('Opened Example in the background.')).not.toBeNull();
    expect(getByText('Opened from Reading')).not.toBeNull();
  });

  it('restores a whole History entry and reloads the list', async () => {
    sendExtensionMessage
      .mockResolvedValueOnce({ ok: true, data: [ENTRY] })
      .mockImplementationOnce(async () => {
        runtimeMessages.emit({ type: 'saved-data:changed' });
        return { ok: true, data: { id: 'restored-session' } };
      })
      .mockResolvedValueOnce({ ok: true, data: [] });
    await renderHistory();

    await click(getByRole('button', 'Restore to Saved windows'));

    expect(sendExtensionMessage.mock.calls).toEqual([
      [{ type: 'history:list' }],
      [{ type: 'history:restore', historyId: 'history-1' }],
      [{ type: 'history:list' }],
    ]);
    expect(getByText('Restored to Saved windows.')).not.toBeNull();
    expect(getByText('History is empty.')).not.toBeNull();
  });

  it('permanently deletes an entry only after confirmation and reloads the list', async () => {
    sendExtensionMessage
      .mockResolvedValueOnce({ ok: true, data: [ENTRY] })
      .mockResolvedValueOnce({ ok: true, data: { deleted: true } })
      .mockResolvedValueOnce({ ok: true, data: [] });
    const confirm = vi
      .spyOn(window, 'confirm')
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    await renderHistory();

    await click(getByRole('button', 'Delete permanently'));
    expect(sendExtensionMessage).toHaveBeenCalledTimes(1);

    await click(getByRole('button', 'Delete permanently'));

    expect(confirm).toHaveBeenCalledTimes(2);
    expect(confirm).toHaveBeenCalledWith('Delete this History entry permanently?');
    expect(sendExtensionMessage.mock.calls).toEqual([
      [{ type: 'history:list' }],
      [{ type: 'history:delete', historyId: 'history-1' }],
      [{ type: 'history:list' }],
    ]);
    expect(getByText('Deleted permanently.')).not.toBeNull();
  });
});

async function renderHistory(
  props: { initialThemeError?: string | null } = {},
) {
  await act(async () => {
    root.render(<HistoryApp {...props} />);
  });
}

async function click(element: HTMLElement) {
  await act(async () => element.click());
}

function getByRole(role: string, name: string): HTMLElement {
  const match = Array.from(container.querySelectorAll<HTMLElement>('*')).find((element) => {
    const hasRole =
      (role === 'button' && element.tagName === 'BUTTON') ||
      (role === 'link' && element.tagName === 'A') ||
      (role === 'heading' && /^H[1-6]$/.test(element.tagName)) ||
      element.getAttribute('role') === role;
    return hasRole && accessibleName(element) === name;
  });
  if (!match) throw new Error(`Missing role: ${role} ${name}`);
  return match;
}

function getByText(text: string): HTMLElement {
  const match = Array.from(container.querySelectorAll<HTMLElement>('*')).find(
    (element) => element.textContent?.trim() === text,
  );
  if (!match) throw new Error(`Missing text: ${text}`);
  return match;
}

function accessibleName(element: HTMLElement): string {
  return element.getAttribute('aria-label') ?? element.textContent?.trim() ?? '';
}
