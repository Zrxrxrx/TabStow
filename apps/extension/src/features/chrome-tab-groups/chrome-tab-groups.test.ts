import { beforeEach, describe, expect, it, vi } from 'vitest';

const browserMocks = vi.hoisted(() => ({
  tabGroups: {
    query: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock('@/lib/browser', () => ({
  browser: browserMocks,
}));

describe('chrome tab groups', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('collapses all groups in a window', async () => {
    browserMocks.tabGroups.query.mockResolvedValue([{ id: 3, windowId: 7 }, { id: 4, windowId: 8 }]);

    const { collapseChromeTabGroups } = await import('./chrome-tab-groups');
    const result = await collapseChromeTabGroups(7);

    expect(browserMocks.tabGroups.update).toHaveBeenCalledWith(3, { collapsed: true });
    expect(browserMocks.tabGroups.update).not.toHaveBeenCalledWith(4, expect.anything());
    expect(result).toEqual({ ok: true, data: { collapsed: true, groupCount: 1 } });
  });
});
