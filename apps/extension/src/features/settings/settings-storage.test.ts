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
      theme: 'dark',
    });
    const persisted = storageMocks.setItem.mock.calls[0]?.[1];
    expect(JSON.stringify(persisted)).not.toContain('legacy-secret');
    expect(persisted).not.toHaveProperty('gistId');
    expect(persisted).not.toHaveProperty('gistFileName');
  });

  it('updates synchronized behavior preferences through the IndexedDB repository', async () => {
    storageMocks.getItem.mockResolvedValue({ theme: 'system' });
    dbMocks.updateSyncPreferences.mockResolvedValue({
      includePinnedTabs: false,
      closePinnedTabs: false,
    });
    const { updateSettings } = await import('./settings-storage');

    const settings = await updateSettings({ includePinnedTabs: false, theme: 'light' });

    expect(dbMocks.updateSyncPreferences).toHaveBeenCalledWith({
      includePinnedTabs: false,
    });
    expect(settings.theme).toBe('light');
  });

  it('does not overwrite synchronized preferences when saving an unrelated field', async () => {
    storageMocks.getItem.mockResolvedValue({ theme: 'system' });
    dbMocks.initializeSyncPreferences.mockResolvedValue({
      includePinnedTabs: true,
      closePinnedTabs: true,
    });
    const { updateSettings } = await import('./settings-storage');

    const settings = await updateSettings({ theme: 'light' });

    expect(dbMocks.updateSyncPreferences).not.toHaveBeenCalled();
    expect(settings).toMatchObject({
      theme: 'light',
      includePinnedTabs: true,
      closePinnedTabs: true,
    });
  });
});
