import { DEFAULT_SETTINGS, extensionSettingsSchema, type ExtensionSettings } from '@tabstow/core';
import { storage } from '#imports';
import {
  getReplicaId,
  initializeSyncPreferences,
  updateSyncPreferences,
} from '@/db/db';

const SETTINGS_KEY = 'local:tabstow-settings';

type LegacyStoredSettings = Partial<ExtensionSettings> & {
  githubToken?: unknown;
  gistId?: unknown;
  gistFileName?: unknown;
};

export async function getSettings(): Promise<ExtensionSettings> {
  const stored = await storage.getItem<LegacyStoredSettings>(SETTINGS_KEY);
  const replicaId = await getReplicaId(stored?.deviceId);
  const preferences = await initializeSyncPreferences(
    {
      includePinnedTabs:
        typeof stored?.includePinnedTabs === 'boolean'
          ? stored.includePinnedTabs
          : DEFAULT_SETTINGS.includePinnedTabs,
      closePinnedTabs:
        typeof stored?.closePinnedTabs === 'boolean'
          ? stored.closePinnedTabs
          : DEFAULT_SETTINGS.closePinnedTabs,
    },
    replicaId,
  );
  const settings = extensionSettingsSchema.parse({
    ...DEFAULT_SETTINGS,
    theme: stored?.theme ?? DEFAULT_SETTINGS.theme,
    ...preferences,
    deviceId: replicaId,
  });

  await storage.setItem(SETTINGS_KEY, settings);

  return settings;
}

export async function updateSettings(
  partial: Partial<ExtensionSettings>,
): Promise<ExtensionSettings> {
  const current = await getSettings();
  const requested = extensionSettingsSchema.parse({
    ...current,
    ...partial,
    deviceId: current.deviceId,
  });
  const preferencePatch: Partial<
    Pick<ExtensionSettings, 'includePinnedTabs' | 'closePinnedTabs'>
  > = {};
  if (typeof partial.includePinnedTabs === 'boolean') {
    preferencePatch.includePinnedTabs = partial.includePinnedTabs;
  }
  if (typeof partial.closePinnedTabs === 'boolean') {
    preferencePatch.closePinnedTabs = partial.closePinnedTabs;
  }
  const preferences =
    Object.keys(preferencePatch).length > 0
      ? await updateSyncPreferences(preferencePatch)
      : {
          includePinnedTabs: current.includePinnedTabs,
          closePinnedTabs: current.closePinnedTabs,
        };
  const next = extensionSettingsSchema.parse({ ...requested, ...preferences });

  await storage.setItem(SETTINGS_KEY, next);
  return next;
}

export async function getOrCreateDeviceId(): Promise<string> {
  const settings = await getSettings();
  return settings.deviceId;
}
