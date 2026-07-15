import { beforeEach, describe, expect, it, vi } from 'vitest';

const storageMocks = vi.hoisted(() => ({
  getItem: vi.fn(),
  setItem: vi.fn(),
}));

const browserMocks = vi.hoisted(() => ({
  tabs: {
    query: vi.fn(),
  },
}));

vi.mock('#imports', () => ({ storage: storageMocks }));
vi.mock('@/lib/browser', () => ({ browser: browserMocks }));

const DEFAULT_POLICY = {
  automaticSleepEnabled: false,
  automaticSleepAfterDays: 7,
  stowSuggestionsEnabled: true,
  stowSuggestionAfterDays: 14,
} as const;

beforeEach(() => {
  vi.resetAllMocks();
  vi.resetModules();
  browserMocks.tabs.query.mockResolvedValue([
    { id: 1, lastAccessed: Date.UTC(2026, 6, 15) },
  ]);
});

describe('tab lifecycle policy', () => {
  it('reads the normalized policy without probing Chrome capabilities', async () => {
    storageMocks.getItem.mockResolvedValue({ schemaVersion: 1, ...DEFAULT_POLICY });
    const { getTabLifecyclePolicy } = await import('./tab-lifecycle-policy');

    await expect(getTabLifecyclePolicy()).resolves.toEqual({
      ok: true,
      data: DEFAULT_POLICY,
    });
    expect(browserMocks.tabs.query).not.toHaveBeenCalled();
  });

  it('starts with conservative device-local defaults', async () => {
    storageMocks.getItem.mockResolvedValue(undefined);
    const { getTabLifecycleState } = await import('./tab-lifecycle-policy');

    await expect(getTabLifecycleState()).resolves.toEqual({
      ok: true,
      data: {
        automaticSleepCapability: { status: 'supported' },
        policy: DEFAULT_POLICY,
      },
    });
    expect(storageMocks.setItem).toHaveBeenCalledWith(
      'local:tabstow-tab-lifecycle-policy-v1',
      { schemaVersion: 1, ...DEFAULT_POLICY },
    );
  });

  it('disables a malformed automatic rule without replacing valid suggestion fields', async () => {
    storageMocks.getItem.mockResolvedValue({
      schemaVersion: 1,
      automaticSleepEnabled: true,
      automaticSleepAfterDays: 2,
      stowSuggestionsEnabled: false,
      stowSuggestionAfterDays: 30,
      remoteOnlyField: 'ignored',
    });
    const { getTabLifecycleState } = await import('./tab-lifecycle-policy');

    const result = await getTabLifecycleState();

    expect(result).toEqual({
      ok: true,
      data: {
        automaticSleepCapability: { status: 'supported' },
        policy: {
          automaticSleepEnabled: false,
          automaticSleepAfterDays: 7,
          stowSuggestionsEnabled: false,
          stowSuggestionAfterDays: 30,
        },
      },
    });
    expect(storageMocks.setItem).toHaveBeenCalledWith(
      'local:tabstow-tab-lifecycle-policy-v1',
      {
        schemaVersion: 1,
        automaticSleepEnabled: false,
        automaticSleepAfterDays: 7,
        stowSuggestionsEnabled: false,
        stowSuggestionAfterDays: 30,
      },
    );
  });

  it('does not reinterpret unknown schema versions or unsafe automatic rules', async () => {
    storageMocks.getItem
      .mockResolvedValueOnce({
        schemaVersion: 2,
        automaticSleepEnabled: true,
        automaticSleepAfterDays: 3,
        stowSuggestionsEnabled: false,
        stowSuggestionAfterDays: 30,
      })
      .mockResolvedValueOnce({
        schemaVersion: 1,
        automaticSleepEnabled: true,
        automaticSleepAfterDays: 'tomorrow',
        stowSuggestionsEnabled: false,
        stowSuggestionAfterDays: 30,
      });
    const { getTabLifecycleState } = await import('./tab-lifecycle-policy');

    await expect(getTabLifecycleState()).resolves.toMatchObject({
      ok: true,
      data: { policy: DEFAULT_POLICY },
    });
    await expect(getTabLifecycleState()).resolves.toMatchObject({
      ok: true,
      data: {
        policy: {
          automaticSleepEnabled: false,
          automaticSleepAfterDays: 7,
          stowSuggestionsEnabled: false,
          stowSuggestionAfterDays: 30,
        },
      },
    });
  });

  it('does not rewrite a current valid policy', async () => {
    storageMocks.getItem.mockResolvedValue({ schemaVersion: 1, ...DEFAULT_POLICY });
    const { getTabLifecycleState } = await import('./tab-lifecycle-policy');

    await getTabLifecycleState();

    expect(storageMocks.setItem).not.toHaveBeenCalled();
  });

  it('distinguishes unsupported Chrome from a transient Tabs API failure', async () => {
    storageMocks.getItem.mockResolvedValue({ schemaVersion: 1, ...DEFAULT_POLICY });
    const { getTabLifecycleState } = await import('./tab-lifecycle-policy');

    browserMocks.tabs.query.mockResolvedValueOnce([{ id: 1 }]);
    await expect(getTabLifecycleState()).resolves.toMatchObject({
      ok: true,
      data: { automaticSleepCapability: { status: 'unsupported' } },
    });

    browserMocks.tabs.query.mockRejectedValueOnce(new Error('Tabs unavailable'));
    await expect(getTabLifecycleState()).resolves.toMatchObject({
      ok: true,
      data: {
        automaticSleepCapability: {
          status: 'unavailable',
          message: 'Tabs unavailable',
        },
      },
    });
  });

  it('treats an empty successful tab query as unavailable rather than an old browser', async () => {
    storageMocks.getItem.mockResolvedValue({ schemaVersion: 1, ...DEFAULT_POLICY });
    browserMocks.tabs.query.mockResolvedValue([]);
    const { getTabLifecycleState } = await import('./tab-lifecycle-policy');

    await expect(getTabLifecycleState()).resolves.toMatchObject({
      ok: true,
      data: {
        automaticSleepCapability: {
          status: 'unavailable',
        },
      },
    });
  });

  it('rejects enabling automatic sleep when lastAccessed is unsupported', async () => {
    storageMocks.getItem.mockResolvedValue({ schemaVersion: 1, ...DEFAULT_POLICY });
    browserMocks.tabs.query.mockResolvedValue([{ id: 1 }]);
    const { updateTabLifecyclePolicy } = await import('./tab-lifecycle-policy');

    await expect(
      updateTabLifecyclePolicy({ ...DEFAULT_POLICY, automaticSleepEnabled: true }),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: 'automatic-sleep-unavailable',
        message: 'Automatic sleep requires Chrome 121 or later.',
      },
    });
    expect(storageMocks.setItem).not.toHaveBeenCalled();
  });

  it('stores only a complete valid policy when automatic sleep is supported', async () => {
    storageMocks.getItem.mockResolvedValue({ schemaVersion: 1, ...DEFAULT_POLICY });
    const { updateTabLifecyclePolicy } = await import('./tab-lifecycle-policy');
    const policy = {
      automaticSleepEnabled: true,
      automaticSleepAfterDays: 3,
      stowSuggestionsEnabled: false,
      stowSuggestionAfterDays: 30,
    } as const;

    await expect(updateTabLifecyclePolicy(policy)).resolves.toEqual({
      ok: true,
      data: {
        automaticSleepCapability: { status: 'supported' },
        policy,
      },
    });
    expect(storageMocks.setItem).toHaveBeenCalledWith(
      'local:tabstow-tab-lifecycle-policy-v1',
      { schemaVersion: 1, ...policy },
    );
  });

  it('allows an already-enabled rule to be disabled or retained after a browser downgrade', async () => {
    const enabledPolicy = { ...DEFAULT_POLICY, automaticSleepEnabled: true };
    storageMocks.getItem.mockResolvedValue({ schemaVersion: 1, ...enabledPolicy });
    browserMocks.tabs.query.mockResolvedValue([{ id: 1 }]);
    const { updateTabLifecyclePolicy } = await import('./tab-lifecycle-policy');

    await expect(
      updateTabLifecyclePolicy({ ...enabledPolicy, stowSuggestionsEnabled: false }),
    ).resolves.toMatchObject({
      ok: true,
      data: {
        policy: { automaticSleepEnabled: true, stowSuggestionsEnabled: false },
        automaticSleepCapability: { status: 'unsupported' },
      },
    });
    await expect(
      updateTabLifecyclePolicy({ ...enabledPolicy, automaticSleepEnabled: false }),
    ).resolves.toMatchObject({
      ok: true,
      data: { policy: { automaticSleepEnabled: false } },
    });
  });

  it('rejects incomplete or non-preset policy payloads', async () => {
    const { updateTabLifecyclePolicy } = await import('./tab-lifecycle-policy');

    await expect(
      updateTabLifecyclePolicy({ ...DEFAULT_POLICY, automaticSleepAfterDays: 4 }),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: 'invalid-tab-lifecycle-policy',
        message: 'Tab lifecycle policy is invalid.',
      },
    });
    expect(browserMocks.tabs.query).not.toHaveBeenCalled();
    expect(storageMocks.setItem).not.toHaveBeenCalled();
  });
});
