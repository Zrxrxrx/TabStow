import { act, type ComponentProps } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import type { HistoryEntry } from '@/features/history/types';
import { RecoveryBinDialog } from './RecoveryBinDialog';

const sendExtensionMessage = vi.hoisted(() => vi.fn());
vi.mock('@/lib/messages', () => ({ sendExtensionMessage }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function runtimeMessageEvent() {
  const listeners = new Set<(message: unknown) => unknown>();
  return {
    addListener: vi.fn((listener: (message: unknown) => unknown) => listeners.add(listener)),
    removeListener: vi.fn((listener: (message: unknown) => unknown) => listeners.delete(listener)),
    emit(message: unknown) {
      return Array.from(listeners, (listener) => listener(message));
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('RecoveryBinDialog', () => {
  it('sorts History newest-first, limits the preview to five, and restores complete entries', async () => {
    sendExtensionMessage.mockReset();
    const runtimeMessages = runtimeMessageEvent();
    Object.defineProperty(globalThis, 'chrome', {
      configurable: true,
      value: {
        runtime: {
          getURL: (path: string) => `chrome-extension://test${path}`,
          onMessage: runtimeMessages,
        },
      },
    });
    const entries = Array.from({ length: 6 }, (_, index) => ({
      id: `history-${index}`,
      sourceSessionId: `session-${index}`,
      sourceTitle: `Session ${index}`,
      tabs: [{ id: `tab-${index}`, title: `Tab ${index}`, url: `https://example.com/${index}`, createdAt: '2026-07-01T00:00:00.000Z' }],
      originalCreatedAt: '2026-07-01T00:00:00.000Z',
      movedAt: `2026-07-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
      reason: 'deleted' as const,
      deviceId: 'device-1',
    }));
    sendExtensionMessage.mockImplementation(async (message: { type: string; historyId?: string }) => {
      if (message.type === 'history:list') return { ok: true, data: entries };
      if (message.type === 'history:restore') {
        runtimeMessages.emit({ type: 'saved-data:changed' });
        return { ok: true, data: { id: message.historyId } };
      }
      throw new Error(`Unexpected message: ${message.type}`);
    });
    const mutationCalls = vi.fn();
    const runSavedDataMutation: ComponentProps<typeof RecoveryBinDialog>['runSavedDataMutation'] =
      async (mutation) => {
        mutationCalls();
        return mutation();
      };
    const container = document.createElement('div');
    container.id = 'root';
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => root.render(<RecoveryBinDialog locale="en" onClose={() => undefined} runSavedDataMutation={runSavedDataMutation} />));

    const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]')!;
    const titleId = dialog.getAttribute('aria-labelledby')!;
    expect(document.getElementById(titleId)?.textContent).toBe('History');
    expect(dialog.textContent).not.toContain('Recovery Bin');
    const fullHistory = dialog.querySelector<HTMLAnchorElement>('.recovery-history-link')!;
    expect(fullHistory.textContent).toContain('View full History');
    expect(fullHistory.href).toBe('chrome-extension://test/saved-history.html');
    expect(fullHistory.getAttribute('target')).toBeNull();
    expect(document.body.querySelectorAll('.recovery-entry')).toHaveLength(5);
    expect(document.body.querySelector('.recovery-entry strong')?.textContent).toBe('Session 5');
    expect(document.body.querySelector<HTMLImageElement>('.recovery-entry img.saved-tab-favicon')?.src).toContain(
      '_favicon/?pageUrl=https%3A%2F%2Fexample.com%2F5',
    );
    const newestMeta = document.body.querySelector('.recovery-entry .tab-url')?.textContent ?? '';
    expect(newestMeta).toContain('1 tab · Removed ·');
    expect(newestMeta).toContain('Jul');
    expect(newestMeta).not.toContain('deleted');
    const restore = document.body.querySelector<HTMLButtonElement>('.recovery-entry button')!;
    await act(async () => restore.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(sendExtensionMessage).toHaveBeenCalledWith({ type: 'history:restore', historyId: 'history-5' });
    expect(mutationCalls).toHaveBeenCalledTimes(1);
    expect(sendExtensionMessage.mock.calls.filter(
      ([message]) => message.type === 'history:list',
    )).toHaveLength(2);

    await act(async () => root.unmount());
    container.remove();
  });

  it('can open full History outside an embedding surface', async () => {
    sendExtensionMessage.mockResolvedValueOnce({ ok: true, data: [] });
    const container = document.createElement('div');
    container.id = 'root';
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => root.render(
      <RecoveryBinDialog
        historyLinkTarget="_blank"
        locale="en"
        onClose={() => undefined}
        runSavedDataMutation={async (mutation) => mutation()}
      />,
    ));

    expect(
      document.body.querySelector<HTMLAnchorElement>('.recovery-history-link')?.target,
    ).toBe('_blank');

    await act(async () => root.unmount());
    container.remove();
  });

  it('uses the same History vocabulary in Simplified Chinese', async () => {
    const entries: HistoryEntry[] = [
      {
        id: 'history-opened',
        sourceSessionId: 'session-opened',
        sourceTitle: '1 tabs stowed',
        tabs: [{ id: 'tab-opened', title: '已打开', url: 'https://opened.example/', createdAt: '2026-07-01T00:00:00.000Z' }],
        originalCreatedAt: '2026-07-01T00:00:00.000Z',
        movedAt: '2026-07-03T12:00:00.000Z',
        reason: 'opened',
        deviceId: 'device-1',
      },
      {
        id: 'history-restored',
        sourceSessionId: 'session-restored',
        sourceTitle: '2 tabs stowed',
        tabs: [{ id: 'tab-restored', title: '已恢复', url: 'https://restored.example/', createdAt: '2026-07-01T00:00:00.000Z' }],
        originalCreatedAt: '2026-07-01T00:00:00.000Z',
        movedAt: '2026-07-02T12:00:00.000Z',
        reason: 'restored',
        deviceId: 'device-1',
      },
      {
        id: 'history-deleted',
        sourceSessionId: 'session-deleted',
        sourceTitle: '3 tabs stowed',
        tabs: Array.from({ length: 3 }, (_, index) => ({
          id: `tab-deleted-${index}`,
          title: `已移除 ${index}`,
          url: `https://deleted.example/${index}`,
          createdAt: '2026-07-01T00:00:00.000Z',
        })),
        originalCreatedAt: '2026-07-01T00:00:00.000Z',
        movedAt: '2026-07-01T12:00:00.000Z',
        reason: 'deleted',
        deviceId: 'device-1',
      },
    ];
    sendExtensionMessage.mockReset().mockResolvedValue({ ok: true, data: entries });
    Object.defineProperty(globalThis, 'chrome', {
      configurable: true,
      value: { runtime: { getURL: (path: string) => `chrome-extension://test${path}` } },
    });
    const container = document.createElement('div');
    container.id = 'root';
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => root.render(
      <RecoveryBinDialog
        locale="zh-CN"
        onClose={() => undefined}
        runSavedDataMutation={async (mutation) => mutation()}
      />,
    ));

    const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]')!;
    const titleId = dialog.getAttribute('aria-labelledby')!;
    expect(document.getElementById(titleId)?.textContent).toBe('历史记录');
    expect(dialog.textContent).not.toContain('临时找回');
    expect(dialog.querySelector('.recovery-history-link')?.textContent).toContain('查看完整历史记录');
    const titles = Array.from(dialog.querySelectorAll('.recovery-entry strong')).map((node) => node.textContent);
    expect(titles).toEqual(['已收起 1 个标签页', '2 tabs stowed', '已收起 3 个标签页']);
    const metadata = Array.from(dialog.querySelectorAll('.recovery-entry .tab-url')).map((node) => node.textContent ?? '');
    expect(metadata[0]).toContain('1 个标签页 · 已打开 ·');
    expect(metadata[1]).toContain('1 个标签页 · 已恢复 ·');
    expect(metadata[2]).toContain('3 个标签页 · 已移除 ·');
    expect(metadata.every((text) => /年|月|日/.test(text))).toBe(true);
    expect(metadata.join(' ')).not.toMatch(/\b(opened|restored|deleted)\b/);

    await act(async () => root.unmount());
    container.remove();
  });

  it('refreshes for local changes and ignores an older History response', async () => {
    const entry: HistoryEntry = {
      id: 'history-stale',
      sourceSessionId: 'session-stale',
      sourceTitle: 'Stale session',
      tabs: [{
        id: 'tab-stale',
        title: 'Stale tab',
        url: 'https://stale.example/',
        createdAt: '2026-07-01T00:00:00.000Z',
      }],
      originalCreatedAt: '2026-07-01T00:00:00.000Z',
      movedAt: '2026-07-02T00:00:00.000Z',
      reason: 'deleted',
      deviceId: 'device-1',
    };
    const older = deferred<{ ok: true; data: HistoryEntry[] }>();
    const newer = deferred<{ ok: true; data: HistoryEntry[] }>();
    const runtimeMessages = runtimeMessageEvent();
    sendExtensionMessage
      .mockReset()
      .mockResolvedValueOnce({ ok: true, data: [entry] })
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise);
    Object.defineProperty(globalThis, 'chrome', {
      configurable: true,
      value: {
        runtime: {
          getURL: (path: string) => `chrome-extension://test${path}`,
          onMessage: runtimeMessages,
        },
      },
    });
    const container = document.createElement('div');
    container.id = 'root';
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => root.render(
      <RecoveryBinDialog locale="en" onClose={() => undefined} runSavedDataMutation={async (mutation) => mutation()} />,
    ));
    expect(runtimeMessages.emit({ type: 'sync:data-changed' })).toEqual([undefined]);
    expect(sendExtensionMessage).toHaveBeenCalledTimes(1);
    runtimeMessages.emit({ type: 'saved-data:changed' });
    runtimeMessages.emit({ type: 'saved-data:changed' });

    await act(async () => {
      newer.resolve({ ok: true, data: [] });
      await newer.promise;
    });
    expect(document.body.querySelector('.recovery-entry')).toBeNull();

    await act(async () => {
      older.resolve({ ok: true, data: [entry] });
      await older.promise;
    });
    expect(document.body.querySelector('.recovery-entry')).toBeNull();

    await act(async () => root.unmount());
    container.remove();
  });
});
