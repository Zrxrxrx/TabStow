import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TabSession } from '@tabstow/core';
import type { AppResult } from '@/lib/errors';
import {
  useSavedForLaterController,
  type SavedForLaterController,
  type SavedForLaterStatus,
} from './useSavedForLaterController';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const sendExtensionMessage = vi.hoisted(() => vi.fn());
vi.mock('@/lib/messages', () => ({ sendExtensionMessage }));

type RuntimeListener = (message: unknown) => unknown;

function runtimeMessageEvent() {
  const listeners = new Set<RuntimeListener>();
  return {
    addListener: vi.fn((listener: RuntimeListener) => listeners.add(listener)),
    removeListener: vi.fn((listener: RuntimeListener) => listeners.delete(listener)),
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

function session(id: string): TabSession {
  return {
    id,
    title: id,
    tabs: [{
      id: `${id}-tab`,
      title: id,
      url: `https://${id}.example/`,
      createdAt: '2026-07-18T00:00:00.000Z',
    }],
    createdAt: '2026-07-18T00:00:00.000Z',
    updatedAt: '2026-07-18T00:00:00.000Z',
    deviceId: 'device-1',
  };
}

let container: HTMLDivElement;
let root: Root | null;
let runtimeMessages: ReturnType<typeof runtimeMessageEvent>;
let currentController: SavedForLaterController | null;

function Harness({
  onActionSucceeded,
  onStatus,
}: {
  onActionSucceeded?: () => void;
  onStatus: (status: SavedForLaterStatus) => void;
}) {
  const controller = useSavedForLaterController({ onActionSucceeded, onStatus });
  currentController = controller;
  return <output>{controller.sessions.map(({ id }) => id).join(',')}</output>;
}

describe('useSavedForLaterController', () => {
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    runtimeMessages = runtimeMessageEvent();
    currentController = null;
    sendExtensionMessage.mockReset();
    Object.defineProperty(globalThis, 'chrome', {
      configurable: true,
      value: { runtime: { onMessage: runtimeMessages } },
    });
  });

  afterEach(async () => {
    if (root) await act(async () => root?.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it('refreshes for local events and ignores an older list response', async () => {
    const older = deferred<AppResult<TabSession[]>>();
    const newer = deferred<AppResult<TabSession[]>>();
    sendExtensionMessage
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise);

    await act(async () => root?.render(
      <Harness onStatus={vi.fn<(status: SavedForLaterStatus) => void>()} />,
    ));
    const listenerResults = runtimeMessages.emit({ type: 'saved-data:changed' });
    expect(listenerResults).toEqual([undefined]);

    await act(async () => {
      newer.resolve({ ok: true, data: [session('newer')] });
      await newer.promise;
    });
    expect(container.textContent).toBe('newer');

    await act(async () => {
      older.resolve({ ok: true, data: [session('older')] });
      await older.promise;
    });
    expect(container.textContent).toBe('newer');
  });

  it('ignores stale load errors after a newer refresh succeeds', async () => {
    const older = deferred<AppResult<TabSession[]>>();
    const newer = deferred<AppResult<TabSession[]>>();
    const onStatus = vi.fn<(status: SavedForLaterStatus) => void>();
    sendExtensionMessage
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise);

    await act(async () => root?.render(<Harness onStatus={onStatus} />));
    runtimeMessages.emit({ type: 'sync:data-changed' });

    await act(async () => {
      newer.resolve({ ok: true, data: [session('newer')] });
      await newer.promise;
      older.resolve({
        ok: false,
        error: { code: 'unknown-error', message: 'stale failure' },
      });
      await older.promise;
    });

    expect(container.textContent).toBe('newer');
    expect(onStatus).not.toHaveBeenCalled();
  });

  it('removes the exact runtime listener and invalidates pending loads on unmount', async () => {
    const pending = deferred<AppResult<TabSession[]>>();
    sendExtensionMessage.mockReturnValueOnce(pending.promise);

    await act(async () => root?.render(
      <Harness onStatus={vi.fn<(status: SavedForLaterStatus) => void>()} />,
    ));
    const listener = runtimeMessages.addListener.mock.calls[0]?.[0];
    await act(async () => root?.unmount());
    root = null;

    expect(runtimeMessages.removeListener).toHaveBeenCalledWith(listener);
    await expect(Promise.resolve().then(() => {
      pending.resolve({ ok: true, data: [session('late')] });
      return pending.promise;
    })).resolves.toEqual({ ok: true, data: [session('late')] });
  });

  it('coalesces the mutation event with the action reload', async () => {
    const action = deferred<AppResult<{ saved: true }>>();
    sendExtensionMessage.mockResolvedValue({ ok: true, data: [session('fresh')] });

    await act(async () => root?.render(
      <Harness onStatus={vi.fn<(status: SavedForLaterStatus) => void>()} />,
    ));
    let runPromise: Promise<void> | undefined;
    await act(async () => {
      runPromise = currentController?.runAction(
        'save',
        () => action.promise,
        () => 'Saved',
      );
      await Promise.resolve();
    });
    runtimeMessages.emit({ type: 'saved-data:changed' });

    await act(async () => {
      action.resolve({ ok: true, data: { saved: true } });
      await runPromise;
    });

    expect(sendExtensionMessage.mock.calls.filter(
      ([message]) => message.type === 'sessions:list',
    )).toHaveLength(2);
  });

  it('coalesces events for mutations owned by embedding components', async () => {
    const mutation = deferred<AppResult<{ restored: true }>>();
    sendExtensionMessage.mockResolvedValue({ ok: true, data: [session('fresh')] });

    await act(async () => root?.render(
      <Harness onStatus={vi.fn<(status: SavedForLaterStatus) => void>()} />,
    ));
    let mutationPromise: Promise<AppResult<{ restored: true }>> | undefined;
    await act(async () => {
      mutationPromise = currentController?.runSavedDataMutation(() => mutation.promise);
      await Promise.resolve();
    });
    runtimeMessages.emit({ type: 'saved-data:changed' });

    await act(async () => {
      mutation.resolve({ ok: true, data: { restored: true } });
      await mutationPromise;
    });

    expect(sendExtensionMessage.mock.calls.filter(
      ([message]) => message.type === 'sessions:list',
    )).toHaveLength(2);
  });

  it('does not publish action results or reload after unmount', async () => {
    const action = deferred<AppResult<{ saved: true }>>();
    const onActionSucceeded = vi.fn();
    const onStatus = vi.fn<(status: SavedForLaterStatus) => void>();
    sendExtensionMessage.mockResolvedValue({ ok: true, data: [] });

    await act(async () => root?.render(
      <Harness onActionSucceeded={onActionSucceeded} onStatus={onStatus} />,
    ));
    let runPromise: Promise<void> | undefined;
    await act(async () => {
      runPromise = currentController?.runAction(
        'save',
        () => action.promise,
        () => 'Saved',
      );
      await Promise.resolve();
    });
    await act(async () => root?.unmount());
    root = null;
    onStatus.mockClear();

    action.resolve({ ok: true, data: { saved: true } });
    await runPromise;

    expect(onStatus).not.toHaveBeenCalled();
    expect(onActionSucceeded).not.toHaveBeenCalled();
    expect(sendExtensionMessage).toHaveBeenCalledTimes(1);
  });
});
