import { beforeEach, describe, expect, it, vi } from 'vitest';

const browserMocks = vi.hoisted(() => ({
  tabs: {
    discard: vi.fn(),
    get: vi.fn(),
    query: vi.fn(),
  },
  windows: {
    get: vi.fn(),
  },
}));

vi.mock('@/lib/browser', () => ({ browser: browserMocks }));

const DAY_MS = 86_400_000;
const NOW = Date.UTC(2026, 6, 15, 12);
const ENABLED_POLICY = {
  automaticSleepEnabled: true,
  automaticSleepAfterDays: 7,
} as const;

function makeTab(overrides: Partial<chrome.tabs.Tab> = {}): chrome.tabs.Tab {
  return {
    active: false,
    audible: false,
    autoDiscardable: true,
    discarded: false,
    frozen: false,
    height: 800,
    highlighted: false,
    incognito: false,
    index: 0,
    lastAccessed: NOW - 7 * DAY_MS,
    pinned: false,
    selected: false,
    status: 'complete',
    url: 'https://example.com/',
    width: 1200,
    windowId: 1,
    ...overrides,
  } as chrome.tabs.Tab;
}

describe('automatic sleep', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    browserMocks.windows.get.mockResolvedValue({
      id: 1,
      incognito: false,
      type: 'normal',
    });
  });

  it('previews tabs at or beyond the inactivity threshold without mutating them', async () => {
    browserMocks.tabs.query.mockResolvedValue([
      makeTab({ id: 1 }),
      makeTab({ id: 2, lastAccessed: NOW - 30 * DAY_MS }),
      makeTab({ id: 3, lastAccessed: NOW - 7 * DAY_MS + 1 }),
    ]);
    const { previewAutomaticSleep } = await import('./automatic-sleep');

    await expect(
      previewAutomaticSleep(ENABLED_POLICY, { now: NOW }),
    ).resolves.toEqual({ eligibleTabCount: 2 });
    expect(browserMocks.tabs.query).toHaveBeenCalledWith({ windowType: 'normal' });
    expect(browserMocks.tabs.get).not.toHaveBeenCalled();
    expect(browserMocks.tabs.discard).not.toHaveBeenCalled();
  });

  it('validates an untrusted preview threshold before querying Chrome', async () => {
    browserMocks.tabs.query.mockResolvedValue([makeTab({ id: 1 })]);
    const { previewAutomaticSleepRule } = await import('./automatic-sleep');

    await expect(previewAutomaticSleepRule(7, { now: NOW })).resolves.toEqual({
      ok: true,
      data: { eligibleTabCount: 1 },
    });
    await expect(previewAutomaticSleepRule(4, { now: NOW })).resolves.toEqual({
      ok: false,
      error: {
        code: 'invalid-tab-lifecycle-policy',
        message: 'Automatic sleep threshold is invalid.',
      },
    });
    expect(browserMocks.tabs.query).toHaveBeenCalledTimes(1);
  });

  it('previews only eligible HTTP(S) tabs with trustworthy inactivity timestamps', async () => {
    browserMocks.tabs.query.mockResolvedValue([
      makeTab({ id: 1, url: 'http://example.com/', lastAccessed: 0 }),
      makeTab({ id: 2, autoDiscardable: undefined }),
      makeTab({ id: undefined }),
      makeTab({ id: Number.NaN }),
      makeTab({ id: 5, url: 'ftp://example.com/' }),
      makeTab({ id: 6, url: 'not a url' }),
      makeTab({ id: 7, active: true }),
      makeTab({ id: 8, discarded: true }),
      makeTab({ id: 9, pinned: true }),
      makeTab({ id: 10, audible: true }),
      makeTab({ id: 11, incognito: true }),
      makeTab({ id: 12, autoDiscardable: false }),
      makeTab({ id: 13, lastAccessed: undefined }),
      makeTab({ id: 14, lastAccessed: Number.NaN }),
      makeTab({ id: 15, lastAccessed: Number.POSITIVE_INFINITY }),
      makeTab({ id: 16, lastAccessed: -1 }),
      makeTab({ id: 17, lastAccessed: NOW + 1 }),
      makeTab({ id: 18, lastAccessed: NOW - DAY_MS }),
    ]);
    const { previewAutomaticSleep } = await import('./automatic-sleep');

    await expect(
      previewAutomaticSleep(ENABLED_POLICY, { now: NOW }),
    ).resolves.toEqual({ eligibleTabCount: 2 });
  });

  it('sleeps eligible tabs from oldest inactivity first', async () => {
    const oldest = makeTab({
      id: 21,
      lastAccessed: NOW - 30 * DAY_MS,
      url: 'https://example.com/oldest',
    });
    const newer = makeTab({
      id: 22,
      lastAccessed: NOW - 8 * DAY_MS,
      url: 'https://example.com/newer',
    });
    const recent = makeTab({
      id: 23,
      lastAccessed: NOW - DAY_MS,
      url: 'https://example.com/recent',
    });
    browserMocks.tabs.query.mockResolvedValue([newer, recent, oldest]);
    browserMocks.tabs.get.mockImplementation(async (tabId: number) => {
      if (tabId === 21) return oldest;
      if (tabId === 22) return newer;
      throw new Error(`Unexpected tab ${tabId}`);
    });
    browserMocks.tabs.discard.mockImplementation(async (tabId: number) => ({
      id: tabId,
      discarded: true,
    }));
    const { runAutomaticSleepScan } = await import('./automatic-sleep');

    await expect(
      runAutomaticSleepScan(ENABLED_POLICY, { now: NOW }),
    ).resolves.toEqual({
      sleptTabIds: [21, 22],
      skippedTabIds: [],
      failures: [],
    });
    expect(browserMocks.tabs.query).toHaveBeenCalledWith({ windowType: 'normal' });
    expect(browserMocks.tabs.get.mock.calls).toEqual([[21], [22]]);
    expect(browserMocks.tabs.discard.mock.calls).toEqual([[21], [22]]);
  });

  it('skips a candidate moved into a non-normal window before discard', async () => {
    const candidate = makeTab({ id: 24 });
    browserMocks.tabs.query.mockResolvedValue([candidate]);
    browserMocks.tabs.get.mockResolvedValue({ ...candidate, windowId: 2 });
    browserMocks.windows.get.mockResolvedValue({
      id: 2,
      incognito: false,
      type: 'popup',
    });
    const { runAutomaticSleepScan } = await import('./automatic-sleep');

    await expect(
      runAutomaticSleepScan(ENABLED_POLICY, { now: NOW }),
    ).resolves.toEqual({
      sleptTabIds: [],
      skippedTabIds: [24],
      failures: [],
    });
    expect(browserMocks.windows.get).toHaveBeenCalledWith(2);
    expect(browserMocks.tabs.discard).not.toHaveBeenCalled();
  });

  it('stops before discard when the coordinator invalidates an in-flight scan', async () => {
    const first = makeTab({
      id: 31,
      lastAccessed: NOW - 30 * DAY_MS,
      url: 'https://example.com/first',
    });
    const second = makeTab({
      id: 32,
      lastAccessed: NOW - 20 * DAY_MS,
      url: 'https://example.com/second',
    });
    browserMocks.tabs.query.mockResolvedValue([first, second]);
    browserMocks.tabs.get.mockResolvedValue(first);
    browserMocks.tabs.discard.mockResolvedValue({ id: 31, discarded: true });
    const shouldContinue = vi.fn().mockReturnValueOnce(true).mockReturnValue(false);
    const { runAutomaticSleepScan } = await import('./automatic-sleep');

    await expect(
      runAutomaticSleepScan(ENABLED_POLICY, { now: NOW, shouldContinue }),
    ).resolves.toEqual({
      sleptTabIds: [],
      skippedTabIds: [31, 32],
      failures: [],
    });
    expect(shouldContinue).toHaveBeenCalledTimes(2);
    expect(browserMocks.tabs.get.mock.calls).toEqual([[31]]);
    expect(browserMocks.tabs.discard).not.toHaveBeenCalled();
  });
});
