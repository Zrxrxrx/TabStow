import { beforeEach, describe, expect, it, vi } from 'vitest';

const storageMocks = vi.hoisted(() => ({
  getItem: vi.fn(),
  setItem: vi.fn(),
}));
const dbMocks = vi.hoisted(() => ({
  getReplicaId: vi.fn(),
  initializeSyncPreferences: vi.fn(),
  updateSyncPreferences: vi.fn(),
}));

vi.mock('#imports', () => ({ storage: storageMocks }));
vi.mock('@/db/db', () => dbMocks);

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  dbMocks.getReplicaId.mockResolvedValue('replica-local');
  dbMocks.initializeSyncPreferences.mockResolvedValue({
    includePinnedTabs: true,
    closePinnedTabs: false,
  });
  dbMocks.updateSyncPreferences.mockImplementation(async (preferences) => preferences);
});

describe('settings storage', () => {
  it('rewrites legacy token and Gist configuration as safe local settings', async () => {
    storageMocks.getItem.mockResolvedValue({
      deviceId: 'legacy-device',
      githubToken: 'legacy-secret',
      gistId: 'legacy-gist',
      gistFileName: 'legacy.json',
      includePinnedTabs: true,
      closePinnedTabs: false,
      theme: 'dark',
    });
    const { getSettings } = await import('./settings-storage');

    const settings = await getSettings();

    expect(settings).toEqual({
      deviceId: 'replica-local',
      includePinnedTabs: true,
      closePinnedTabs: false,
    });
    const persisted = storageMocks.setItem.mock.calls[0]?.[1];
    expect(JSON.stringify(persisted)).not.toContain('legacy-secret');
    expect(persisted).not.toHaveProperty('gistId');
    expect(persisted).not.toHaveProperty('gistFileName');
    expect(persisted).not.toHaveProperty('theme');
  });

  it('strips an invalid legacy theme during the existing normalization write', async () => {
    storageMocks.getItem.mockResolvedValue({
      deviceId: 'legacy-device',
      includePinnedTabs: false,
      closePinnedTabs: true,
      theme: { mode: 'twilight' },
    });
    const { getSettings } = await import('./settings-storage');

    const settings = await getSettings();

    expect(settings).not.toHaveProperty('theme');
    expect(storageMocks.setItem).toHaveBeenCalledWith(
      'local:tabstow-settings',
      expect.any(Object),
    );
    expect(storageMocks.setItem.mock.calls[0]?.[1]).not.toHaveProperty('theme');
    expect(storageMocks.getItem).not.toHaveBeenCalledWith(
      'local:tabstow-theme-preferences',
    );
    expect(storageMocks.setItem).not.toHaveBeenCalledWith(
      'local:tabstow-theme-preferences',
      expect.anything(),
    );
  });

  it('updates synchronized behavior preferences through the IndexedDB repository', async () => {
    storageMocks.getItem.mockResolvedValue({});
    dbMocks.updateSyncPreferences.mockResolvedValue({
      includePinnedTabs: false,
      closePinnedTabs: false,
    });
    const { updateSettings } = await import('./settings-storage');

    const settings = await updateSettings({ includePinnedTabs: false });

    expect(dbMocks.updateSyncPreferences).toHaveBeenCalledWith({
      includePinnedTabs: false,
    });
    expect(settings).not.toHaveProperty('theme');
  });

  it('does not write synchronized preferences when the patch is empty', async () => {
    storageMocks.getItem.mockResolvedValue({});
    dbMocks.initializeSyncPreferences.mockResolvedValue({
      includePinnedTabs: true,
      closePinnedTabs: true,
    });
    const { updateSettings } = await import('./settings-storage');

    const settings = await updateSettings({});

    expect(dbMocks.updateSyncPreferences).not.toHaveBeenCalled();
    expect(settings).toMatchObject({
      includePinnedTabs: true,
      closePinnedTabs: true,
    });
  });

  it('rejects theme from a stale Settings page update', async () => {
    storageMocks.getItem.mockResolvedValue({});
    const { updateSettings } = await import('./settings-storage');

    await expect(
      updateSettings({ theme: 'dark' } as unknown as Parameters<typeof updateSettings>[0]),
    ).rejects.toThrow();

    expect(dbMocks.updateSyncPreferences).not.toHaveBeenCalled();
  });
});
