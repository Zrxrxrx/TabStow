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
      chromeTabGroups: { enabled: true, mappings: [] },
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

  it('normalizes malformed chrome group mappings without throwing', async () => {
    storageMocks.getItem.mockResolvedValue({
      chromeTabGroups: {
        enabled: true,
        mappings: [null],
      },
    });

    const { getActiveWorkspaceState } = await import('./active-workspace-storage');
    await expect(getActiveWorkspaceState()).resolves.toEqual({
      manualGroups: { groups: [], assignments: {} },
      order: { groupOrder: [], pinnedGroupKeys: [], groupTabOrder: {} },
      chromeTabGroups: { enabled: true, mappings: [] },
    });
  });

  it('preserves an explicit disabled Chrome group sync state', async () => {
    storageMocks.getItem.mockResolvedValue({
      chromeTabGroups: {
        enabled: false,
        mappings: [],
      },
    });

    const { getActiveWorkspaceState } = await import('./active-workspace-storage');
    await expect(getActiveWorkspaceState()).resolves.toEqual({
      manualGroups: { groups: [], assignments: {} },
      order: { groupOrder: [], pinnedGroupKeys: [], groupTabOrder: {} },
      chromeTabGroups: { enabled: false, mappings: [] },
    });
  });

  it('dedupes persisted order arrays while preserving first-seen order', async () => {
    storageMocks.getItem.mockResolvedValue({
      order: {
        groupOrder: ['domain:example.com', 'domain:example.com', 'manual:1', 'manual:1'],
        pinnedGroupKeys: ['pinned:1', 'pinned:1', 'pinned:2', 'pinned:1'],
        groupTabOrder: {
          'domain:example.com': ['tab-1', 'tab-1', 'tab-2', 'tab-2', 'tab-1'],
          'manual:1': ['tab-3', 'tab-3'],
        },
      },
    });

    const { getActiveWorkspaceState } = await import('./active-workspace-storage');
    await expect(getActiveWorkspaceState()).resolves.toEqual({
      manualGroups: { groups: [], assignments: {} },
      order: {
        groupOrder: ['domain:example.com', 'manual:1'],
        pinnedGroupKeys: ['pinned:1', 'pinned:2'],
        groupTabOrder: {
          'domain:example.com': ['tab-1', 'tab-2'],
          'manual:1': ['tab-3'],
        },
      },
      chromeTabGroups: { enabled: true, mappings: [] },
    });
  });
});
