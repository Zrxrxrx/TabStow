import { afterEach, expect, it, vi } from 'vitest';

function eventMock() {
  const listeners = new Set<(...args: unknown[]) => void>();
  return {
    addListener: vi.fn((listener: (...args: unknown[]) => void) => listeners.add(listener)),
    removeListener: vi.fn((listener: (...args: unknown[]) => void) => listeners.delete(listener)),
    emit: (...args: unknown[]) => {
      for (const listener of listeners) listener(...args);
    },
  };
}

function installChromeEvents() {
  const tabs = {
    onCreated: eventMock(),
    onUpdated: eventMock(),
    onRemoved: eventMock(),
    onMoved: eventMock(),
    onAttached: eventMock(),
    onDetached: eventMock(),
    onActivated: eventMock(),
    onReplaced: eventMock(),
  };
  const tabGroups = {
    onCreated: eventMock(),
    onUpdated: eventMock(),
    onRemoved: eventMock(),
    onMoved: eventMock(),
  };
  const windows = {
    onCreated: eventMock(),
    onRemoved: eventMock(),
    onFocusChanged: eventMock(),
  };
  const all = [...Object.values(tabs), ...Object.values(tabGroups), ...Object.values(windows)];
  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    value: { tabs, tabGroups, windows },
  });
  return { tabs, tabGroups, windows, all };
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'chrome');
});

it('subscribes and unsubscribes the complete Chrome change surface', async () => {
  const events = installChromeEvents();
  const onChange = vi.fn();

  const { subscribeToActiveTabsChanges } = await import('./active-tabs-events');
  const unsubscribe = subscribeToActiveTabsChanges(onChange);

  expect(events.all.every((event) => event.addListener.mock.calls[0]?.[0] === onChange)).toBe(true);
  events.tabs.onAttached.emit(10, { newWindowId: 3, newPosition: 1 });
  events.tabGroups.onMoved.emit({ id: 31 });
  events.windows.onFocusChanged.emit(3);
  expect(onChange).toHaveBeenCalledTimes(3);

  unsubscribe();
  expect(events.all.every((event) => event.removeListener.mock.calls[0]?.[0] === onChange)).toBe(
    true,
  );
});

it('does nothing when Chrome APIs are unavailable', async () => {
  Reflect.deleteProperty(globalThis, 'chrome');
  const { subscribeToActiveTabsChanges } = await import('./active-tabs-events');

  expect(() => subscribeToActiveTabsChanges(vi.fn())()).not.toThrow();
});
