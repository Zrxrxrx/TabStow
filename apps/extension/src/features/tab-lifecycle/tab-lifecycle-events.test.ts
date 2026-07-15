import { beforeEach, describe, expect, it, vi } from 'vitest';

const browserMocks = vi.hoisted(() => ({
  tabs: {
    get: vi.fn(),
    onActivated: { addListener: vi.fn() },
    onCreated: { addListener: vi.fn() },
    onRemoved: { addListener: vi.fn() },
    onReplaced: { addListener: vi.fn() },
    onUpdated: { addListener: vi.fn() },
  },
}));

const policyMocks = vi.hoisted(() => ({
  getTabLifecyclePolicy: vi.fn(),
}));

const observationMocks = vi.hoisted(() => ({
  clearSleepObservations: vi.fn(),
  observeDiscardedTab: vi.fn(),
  removeSleepObservation: vi.fn(),
}));

vi.mock('@/lib/browser', () => ({ browser: browserMocks }));
vi.mock('./tab-lifecycle-policy', () => policyMocks);
vi.mock('./sleep-observations', () => observationMocks);

const ENABLED_POLICY = {
  automaticSleepEnabled: false,
  automaticSleepAfterDays: 7,
  stowSuggestionsEnabled: true,
  stowSuggestionAfterDays: 14,
} as const;

function sleepingTab(overrides: Partial<chrome.tabs.Tab> = {}): chrome.tabs.Tab {
  return {
    id: 7,
    active: false,
    audible: false,
    autoDiscardable: true,
    discarded: true,
    highlighted: false,
    incognito: false,
    index: 0,
    pinned: false,
    url: 'https://example.com/',
    windowId: 1,
    ...overrides,
  } as chrome.tabs.Tab;
}

describe('tab lifecycle events', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
    policyMocks.getTabLifecyclePolicy.mockResolvedValue({
      ok: true,
      data: ENABLED_POLICY,
    });
    observationMocks.clearSleepObservations.mockResolvedValue(undefined);
    observationMocks.observeDiscardedTab.mockResolvedValue({ observationId: 'observation-1' });
    observationMocks.removeSleepObservation.mockResolvedValue(undefined);
    browserMocks.tabs.get.mockResolvedValue(sleepingTab());
  });

  it('registers every lifecycle listener synchronously', async () => {
    const { registerTabLifecycleEventHandlers } = await import('./tab-lifecycle-events');

    registerTabLifecycleEventHandlers();

    expect(browserMocks.tabs.onCreated.addListener).toHaveBeenCalledTimes(1);
    expect(browserMocks.tabs.onUpdated.addListener).toHaveBeenCalledTimes(1);
    expect(browserMocks.tabs.onActivated.addListener).toHaveBeenCalledTimes(1);
    expect(browserMocks.tabs.onRemoved.addListener).toHaveBeenCalledTimes(1);
    expect(browserMocks.tabs.onReplaced.addListener).toHaveBeenCalledTimes(1);
  });

  it('observes eligible sleeping tabs and resets tabs that no longer qualify', async () => {
    const { reconcileTabLifecycleTab } = await import('./tab-lifecycle-events');
    const tab = sleepingTab();

    await reconcileTabLifecycleTab(tab);

    expect(observationMocks.observeDiscardedTab).toHaveBeenCalledWith(tab);
    expect(observationMocks.removeSleepObservation).not.toHaveBeenCalled();

    observationMocks.observeDiscardedTab.mockResolvedValueOnce(null);
    await reconcileTabLifecycleTab(sleepingTab({ pinned: true }));
    expect(observationMocks.removeSleepObservation).toHaveBeenCalledWith(7);
  });

  it('clears all observation state when suggestions are disabled', async () => {
    policyMocks.getTabLifecyclePolicy.mockResolvedValue({
      ok: true,
      data: { ...ENABLED_POLICY, stowSuggestionsEnabled: false },
    });
    const { reconcileTabLifecycleTab } = await import('./tab-lifecycle-events');

    await reconcileTabLifecycleTab(sleepingTab());

    expect(observationMocks.clearSleepObservations).toHaveBeenCalledTimes(1);
    expect(observationMocks.observeDiscardedTab).not.toHaveBeenCalled();
    expect(observationMocks.removeSleepObservation).not.toHaveBeenCalled();
  });

  it('drops event work whose enabled policy read becomes stale', async () => {
    let resolvePolicy!: (value: {
      ok: true;
      data: typeof ENABLED_POLICY;
    }) => void;
    policyMocks.getTabLifecyclePolicy.mockReturnValue(new Promise((resolve) => {
      resolvePolicy = resolve;
    }));
    const { reconcileTabLifecycleTab } = await import('./tab-lifecycle-events');
    const { invalidateTabLifecycleGeneration } = await import(
      './tab-lifecycle-generation'
    );

    const pending = reconcileTabLifecycleTab(sleepingTab());
    await vi.waitFor(() => expect(policyMocks.getTabLifecyclePolicy).toHaveBeenCalledTimes(1));
    invalidateTabLifecycleGeneration();
    resolvePolicy({ ok: true, data: ENABLED_POLICY });
    await pending;

    expect(observationMocks.observeDiscardedTab).not.toHaveBeenCalled();
    expect(observationMocks.removeSleepObservation).not.toHaveBeenCalled();
    expect(observationMocks.clearSleepObservations).not.toHaveBeenCalled();
  });

  it('routes relevant create, update, activation, removal, and replacement events', async () => {
    const { registerTabLifecycleEventHandlers } = await import('./tab-lifecycle-events');
    registerTabLifecycleEventHandlers();
    const created = browserMocks.tabs.onCreated.addListener.mock.calls[0]?.[0];
    const updated = browserMocks.tabs.onUpdated.addListener.mock.calls[0]?.[0];
    const activated = browserMocks.tabs.onActivated.addListener.mock.calls[0]?.[0];
    const removed = browserMocks.tabs.onRemoved.addListener.mock.calls[0]?.[0];
    const replaced = browserMocks.tabs.onReplaced.addListener.mock.calls[0]?.[0];

    created?.(sleepingTab());
    await vi.waitFor(() =>
      expect(observationMocks.observeDiscardedTab).toHaveBeenCalledWith(
        expect.objectContaining({ id: 7 }),
      ),
    );

    vi.clearAllMocks();
    updated?.(7, { title: 'cosmetic change' }, sleepingTab());
    await Promise.resolve();
    expect(policyMocks.getTabLifecyclePolicy).not.toHaveBeenCalled();

    updated?.(7, { discarded: true }, sleepingTab());
    await vi.waitFor(() =>
      expect(observationMocks.observeDiscardedTab).toHaveBeenCalledTimes(1),
    );

    activated?.({ tabId: 7, windowId: 1 });
    removed?.(8, { isWindowClosing: false, windowId: 1 });
    await vi.waitFor(() =>
      expect(observationMocks.removeSleepObservation.mock.calls).toEqual(
        expect.arrayContaining([[7], [8]]),
      ),
    );

    browserMocks.tabs.get.mockResolvedValueOnce(sleepingTab({ id: 9 }));
    replaced?.(9, 7);
    await vi.waitFor(() => {
      expect(browserMocks.tabs.get).toHaveBeenCalledWith(9);
      expect(observationMocks.observeDiscardedTab).toHaveBeenCalledWith(
        expect.objectContaining({ id: 9 }),
      );
    });
  });
});
