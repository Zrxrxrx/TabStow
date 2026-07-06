import { beforeEach, describe, expect, it, vi } from 'vitest';

const browserMocks = vi.hoisted(() => ({
  search: {
    query: vi.fn(),
  },
  tabs: {
    query: vi.fn(),
    remove: vi.fn(),
    update: vi.fn(),
  },
  windows: {
    update: vi.fn(),
  },
}));

vi.mock('@/lib/browser', () => ({
  browser: browserMocks,
}));

describe('active tabs service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists active browser tabs from all windows', async () => {
    browserMocks.tabs.query.mockResolvedValue([
      { id: 1, windowId: 2, index: 0, url: 'https://example.com' },
    ]);

    const { listActiveTabs } = await import('./active-tabs-service');
    const result = await listActiveTabs();

    expect(browserMocks.tabs.query).toHaveBeenCalledWith({});
    expect(result).toEqual({
      ok: true,
      data: [{ id: 1, windowId: 2, index: 0, url: 'https://example.com' }],
    });
  });

  it('focuses a tab and its window', async () => {
    const { focusActiveTab } = await import('./active-tabs-service');
    const result = await focusActiveTab(5, 8);

    expect(browserMocks.windows.update).toHaveBeenCalledWith(8, { focused: true });
    expect(browserMocks.tabs.update).toHaveBeenCalledWith(5, { active: true });
    expect(result).toEqual({ ok: true, data: { focused: true } });
  });

  it('closes requested tabs', async () => {
    const { closeActiveTabs } = await import('./active-tabs-service');
    const result = await closeActiveTabs([3, 4]);

    expect(browserMocks.tabs.remove).toHaveBeenCalledWith([3, 4]);
    expect(result).toEqual({ ok: true, data: { closed: true, tabCount: 2 } });
  });

  it('runs a default search with trimmed query text', async () => {
    const { runDefaultSearch } = await import('./active-tabs-service');
    const result = await runDefaultSearch('  tab groups  ');

    expect(browserMocks.search.query).toHaveBeenCalledWith({ text: 'tab groups' });
    expect(result).toEqual({ ok: true, data: { searched: true } });
  });
});
