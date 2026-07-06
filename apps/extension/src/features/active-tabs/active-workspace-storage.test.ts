import { beforeEach, describe, expect, it, vi } from 'vitest';

const storageMocks = vi.hoisted(() => ({
  getItem: vi.fn(),
  setItem: vi.fn(),
}));

vi.mock('#imports', () => ({
  storage: storageMocks,
}));

describe('active workspace storage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns default local-only active workspace state', async () => {
    storageMocks.getItem.mockResolvedValue(null);

    const { getActiveWorkspaceState } = await import('./active-workspace-storage');
    await expect(getActiveWorkspaceState()).resolves.toEqual({
      manualGroups: { groups: [], assignments: {} },
      order: { groupOrder: [], pinnedGroupKeys: [], groupTabOrder: {} },
      chromeTabGroups: { enabled: false, mappings: [] },
    });
  });

  it('merges partial updates', async () => {
    storageMocks.getItem.mockResolvedValue(null);

    const { updateActiveWorkspaceState } = await import('./active-workspace-storage');
    const result = await updateActiveWorkspaceState({
      order: { groupOrder: ['domain:example.com'], pinnedGroupKeys: [], groupTabOrder: {} },
    });

    expect(storageMocks.setItem).toHaveBeenCalledWith('local:tabstow-active-workspace', result);
    expect(result.order.groupOrder).toEqual(['domain:example.com']);
  });
});
