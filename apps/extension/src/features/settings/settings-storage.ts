import { DEFAULT_SETTINGS, extensionSettingsSchema, type ExtensionSettings } from '@tabstow/core';
import { storage } from '#imports';

const SETTINGS_KEY = 'local:tabstow-settings';

function createDeviceId(): string {
  return crypto.randomUUID();
}

export async function getSettings(): Promise<ExtensionSettings> {
  const stored = await storage.getItem<Partial<ExtensionSettings>>(SETTINGS_KEY);
  const candidate = {
    ...DEFAULT_SETTINGS,
    ...stored,
    deviceId: stored?.deviceId ?? createDeviceId(),
  };
  const settings = extensionSettingsSchema.parse(candidate);

  if (!stored?.deviceId) {
    await storage.setItem(SETTINGS_KEY, settings);
  }

  return settings;
}

export async function updateSettings(
  partial: Partial<ExtensionSettings>,
): Promise<ExtensionSettings> {
  const current = await getSettings();
  const next = extensionSettingsSchema.parse({
    ...current,
    ...partial,
    deviceId: current.deviceId,
  });

  await storage.setItem(SETTINGS_KEY, next);
  return next;
}

export async function getOrCreateDeviceId(): Promise<string> {
  const settings = await getSettings();
  return settings.deviceId;
}
