import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const storageMocks = vi.hoisted(() => ({
  getItem: vi.fn(),
  setItem: vi.fn(),
}));

const browserMocks = vi.hoisted(() => ({
  alarms: {
    clear: vi.fn(),
    create: vi.fn(),
    get: vi.fn(),
  },
  tabs: {
    discard: vi.fn(),
    get: vi.fn(),
    query: vi.fn(),
  },
  windows: {
    get: vi.fn(),
  },
}));

const observationMocks = vi.hoisted(() => ({
  clearSleepObservations: vi.fn(),
  reconcileSleepObservations: vi.fn(),
}));

vi.mock('#imports', () => ({ storage: storageMocks }));
vi.mock('@/lib/browser', () => ({ browser: browserMocks }));
vi.mock('./sleep-observations', () => observationMocks);

const POLICY_KEY = 'local:tabstow-tab-lifecycle-policy-v1';
const NOW = Date.UTC(2026, 6, 15, 12);

function storedPolicy(
  automaticSleepEnabled: boolean,
  stowSuggestionsEnabled = true,
) {
  return {
    schemaVersion: 1,
    automaticSleepEnabled,
    automaticSleepAfterDays: 7,
    stowSuggestionsEnabled,
    stowSuggestionAfterDays: 14,
  };
}

function eligibleTab(): chrome.tabs.Tab {
  return {
    id: 7,
    active: false,
    audible: false,
    autoDiscardable: true,
    discarded: false,
    highlighted: false,
    incognito: false,
    index: 0,
    lastAccessed: NOW - 8 * 86_400_000,
    pinned: false,
    selected: false,
    url: 'https://example.com/old',
    windowId: 1,
  } as chrome.tabs.Tab;
}

describe('tab lifecycle coordinator', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    storageMocks.getItem.mockImplementation(async (key: string) =>
      key === POLICY_KEY ? storedPolicy(true) : undefined,
    );
    browserMocks.alarms.clear.mockResolvedValue(true);
    browserMocks.alarms.create.mockResolvedValue(undefined);
    browserMocks.alarms.get.mockResolvedValue(undefined);
    browserMocks.tabs.query.mockResolvedValue([eligibleTab()]);
    browserMocks.tabs.get.mockResolvedValue(eligibleTab());
    browserMocks.tabs.discard.mockResolvedValue({ id: 7, discarded: true });
    browserMocks.windows.get.mockResolvedValue({
      id: 1,
      incognito: false,
      type: 'normal',
    });
    observationMocks.clearSleepObservations.mockResolvedValue(undefined);
    observationMocks.reconcileSleepObservations.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates one named repeating alarm only when automatic sleep is enabled', async () => {
    const { reconcileTabLifecycleAlarm, TAB_LIFECYCLE_ALARM_NAME } = await import(
      './tab-lifecycle-coordinator'
    );

    await reconcileTabLifecycleAlarm();

    expect(browserMocks.alarms.create).toHaveBeenCalledWith(
      TAB_LIFECYCLE_ALARM_NAME,
      { delayInMinutes: 1, periodInMinutes: 30 },
    );
    expect(browserMocks.alarms.clear).not.toHaveBeenCalled();

    storageMocks.getItem.mockResolvedValue(storedPolicy(false));
    await reconcileTabLifecycleAlarm();

    expect(browserMocks.alarms.clear).toHaveBeenCalledWith(TAB_LIFECYCLE_ALARM_NAME);
  });

  it('does not schedule automatic sleep on unsupported or transiently unavailable Chrome APIs', async () => {
    const { reconcileTabLifecycleAlarm, TAB_LIFECYCLE_ALARM_NAME } = await import(
      './tab-lifecycle-coordinator'
    );
    browserMocks.tabs.query.mockResolvedValue([{ id: 1 }]);

    await reconcileTabLifecycleAlarm();

    expect(browserMocks.alarms.clear).toHaveBeenCalledWith(TAB_LIFECYCLE_ALARM_NAME);
    expect(browserMocks.alarms.create).not.toHaveBeenCalled();

    vi.clearAllMocks();
    storageMocks.getItem.mockImplementation(async (key: string) =>
      key === POLICY_KEY ? storedPolicy(true) : undefined,
    );
    browserMocks.tabs.query.mockRejectedValue(new Error('Tabs unavailable'));

    await reconcileTabLifecycleAlarm();

    expect(browserMocks.alarms.clear).not.toHaveBeenCalled();
    expect(browserMocks.alarms.create).not.toHaveBeenCalled();
  });

  it('keeps an existing correct alarm and repairs a wrong cadence', async () => {
    const { reconcileTabLifecycleAlarm, TAB_LIFECYCLE_ALARM_NAME } = await import(
      './tab-lifecycle-coordinator'
    );
    browserMocks.alarms.get.mockResolvedValueOnce({
      name: TAB_LIFECYCLE_ALARM_NAME,
      scheduledTime: NOW + 60_000,
      periodInMinutes: 30,
    });

    await reconcileTabLifecycleAlarm();

    expect(browserMocks.alarms.create).not.toHaveBeenCalled();

    browserMocks.alarms.get.mockResolvedValueOnce({
      name: TAB_LIFECYCLE_ALARM_NAME,
      scheduledTime: NOW + 60_000,
      periodInMinutes: 10,
    });
    await reconcileTabLifecycleAlarm();

    expect(browserMocks.alarms.create).toHaveBeenCalledWith(
      TAB_LIFECYCLE_ALARM_NAME,
      { delayInMinutes: 1, periodInMinutes: 30 },
    );
  });

  it('runs one current scan for concurrent alarm triggers', async () => {
    let finishGet!: (tab: chrome.tabs.Tab) => void;
    browserMocks.tabs.get.mockReturnValue(
      new Promise((resolve) => {
        finishGet = resolve;
      }),
    );
    const { handleTabLifecycleAlarm } = await import('./tab-lifecycle-coordinator');

    const first = handleTabLifecycleAlarm();
    const second = handleTabLifecycleAlarm();
    await vi.waitFor(() => expect(browserMocks.tabs.get).toHaveBeenCalledTimes(1));
    finishGet(eligibleTab());

    await expect(Promise.all([first, second])).resolves.toEqual([
      { sleptTabIds: [7], skippedTabIds: [], failures: [] },
      { sleptTabIds: [7], skippedTabIds: [], failures: [] },
    ]);
    expect(browserMocks.tabs.discard).toHaveBeenCalledTimes(1);
    expect(observationMocks.reconcileSleepObservations).toHaveBeenCalledTimes(1);
  });

  it('invalidates an in-flight scan after a policy change', async () => {
    let finishGet!: (tab: chrome.tabs.Tab) => void;
    browserMocks.tabs.get.mockReturnValue(
      new Promise((resolve) => {
        finishGet = resolve;
      }),
    );
    const { handleTabLifecycleAlarm, invalidateAutomaticSleepScans } = await import(
      './tab-lifecycle-coordinator'
    );

    const scan = handleTabLifecycleAlarm();
    await vi.waitFor(() => expect(browserMocks.tabs.get).toHaveBeenCalledTimes(1));
    invalidateAutomaticSleepScans();
    finishGet(eligibleTab());

    await expect(scan).resolves.toEqual({
      sleptTabIds: [],
      skippedTabIds: [7],
      failures: [],
    });
    expect(browserMocks.tabs.discard).not.toHaveBeenCalled();
  });

  it('does not scan when the policy is disabled or lastAccessed is unsupported', async () => {
    storageMocks.getItem.mockResolvedValue(storedPolicy(false));
    const { handleTabLifecycleAlarm } = await import('./tab-lifecycle-coordinator');

    await expect(handleTabLifecycleAlarm()).resolves.toBeNull();

    storageMocks.getItem.mockResolvedValue(storedPolicy(true));
    browserMocks.tabs.query.mockResolvedValue([{ id: 1 }]);
    await expect(handleTabLifecycleAlarm()).resolves.toBeNull();
    expect(browserMocks.tabs.discard).not.toHaveBeenCalled();
  });

  it('reconciles normal-window observations or clears them with the suggestion policy', async () => {
    const { reconcileTabLifecycleObservations } = await import(
      './tab-lifecycle-coordinator'
    );
    const tabs = [eligibleTab()];
    browserMocks.tabs.query.mockResolvedValue(tabs);

    await reconcileTabLifecycleObservations();

    expect(browserMocks.tabs.query).toHaveBeenCalledWith({ windowType: 'normal' });
    expect(observationMocks.reconcileSleepObservations).toHaveBeenCalledWith(tabs);

    vi.clearAllMocks();
    storageMocks.getItem.mockResolvedValue(storedPolicy(true, false));
    await reconcileTabLifecycleObservations();

    expect(observationMocks.clearSleepObservations).toHaveBeenCalledTimes(1);
    expect(browserMocks.tabs.query).not.toHaveBeenCalled();
    expect(observationMocks.reconcileSleepObservations).not.toHaveBeenCalled();
  });

  it('bootstraps alarm and observation recovery together', async () => {
    const tabs = [eligibleTab()];
    browserMocks.tabs.query.mockImplementation(async (query) =>
      'windowType' in query ? tabs : [eligibleTab()],
    );
    const { bootstrapTabLifecycleCoordinator } = await import(
      './tab-lifecycle-coordinator'
    );

    await bootstrapTabLifecycleCoordinator();

    expect(browserMocks.alarms.create).toHaveBeenCalledTimes(1);
    expect(browserMocks.tabs.query).toHaveBeenCalledWith({ windowType: 'normal' });
    expect(observationMocks.reconcileSleepObservations).toHaveBeenCalledWith(tabs);
  });

  it('keeps bootstrap best-effort when either recovery path fails', async () => {
    const { bootstrapTabLifecycleCoordinator } = await import(
      './tab-lifecycle-coordinator'
    );
    browserMocks.alarms.get.mockRejectedValueOnce(new Error('alarms unavailable'));

    await expect(bootstrapTabLifecycleCoordinator()).resolves.toBeUndefined();
    expect(observationMocks.reconcileSleepObservations).toHaveBeenCalledTimes(1);

    vi.clearAllMocks();
    storageMocks.getItem.mockImplementation(async (key: string) =>
      key === POLICY_KEY ? storedPolicy(true) : undefined,
    );
    browserMocks.alarms.get.mockResolvedValue(undefined);
    browserMocks.alarms.create.mockResolvedValue(undefined);
    browserMocks.tabs.query.mockImplementation(async (query) => {
      if ('windowType' in query) throw new Error('tabs unavailable');
      return [eligibleTab()];
    });

    await expect(bootstrapTabLifecycleCoordinator()).resolves.toBeUndefined();
    expect(browserMocks.alarms.create).toHaveBeenCalledTimes(1);
  });
});
