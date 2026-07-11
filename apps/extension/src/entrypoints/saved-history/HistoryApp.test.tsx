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
  sourceTitle: 'Saved for later',
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

describe('HistoryApp', () => {
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    sendExtensionMessage.mockReset();
    storageGetItem.mockReset().mockResolvedValue('en');
    Object.defineProperty(globalThis, 'chrome', {
      configurable: true,
      value: {
        runtime: {
          getURL: vi.fn((path: string) => `chrome-extension://tabstow-test${path}`),
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
    expect(getByRole('link', 'Back to Tabstow').getAttribute('href')).toBe(
      'chrome-extension://tabstow-test/newtab.html',
    );
    expect(getByText('Opened from Saved for later')).not.toBeNull();
    expect(getByText('https://example.com/')).not.toBeNull();
    expect(getByRole('button', 'Open Example in background')).not.toBeNull();
    expect(container.querySelector('time')?.getAttribute('datetime')).toBe(ENTRY.movedAt);
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

    expect(getByText('Opened from Saved for later')).not.toBeNull();
    expect(getByText('Restored from Research')).not.toBeNull();
    expect(getByText('Removed from Archive')).not.toBeNull();
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
    expect(document.documentElement.lang).toBe('zh-CN');
  });

  it('shows the empty state when History has no entries', async () => {
    sendExtensionMessage.mockResolvedValueOnce({ ok: true, data: [] });

    await renderHistory();

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
    expect(getByText('Opened from Saved for later')).not.toBeNull();
  });

  it('restores a whole History entry and reloads the list', async () => {
    sendExtensionMessage
      .mockResolvedValueOnce({ ok: true, data: [ENTRY] })
      .mockResolvedValueOnce({ ok: true, data: { id: 'restored-session' } })
      .mockResolvedValueOnce({ ok: true, data: [] });
    await renderHistory();

    await click(getByRole('button', 'Restore to Saved for later'));

    expect(sendExtensionMessage.mock.calls).toEqual([
      [{ type: 'history:list' }],
      [{ type: 'history:restore', historyId: 'history-1' }],
      [{ type: 'history:list' }],
    ]);
    expect(getByText('Restored to Saved for later.')).not.toBeNull();
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

async function renderHistory() {
  await act(async () => {
    root.render(<HistoryApp />);
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
