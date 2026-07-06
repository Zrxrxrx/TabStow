import {
  safeSyncSettingsSchema,
  syncDocumentSchema,
  type ExtensionSettings,
  type SafeSyncSettings,
  type SyncDocument,
  type TabSession,
} from './schemas';

export function toSafeSyncSettings(settings: ExtensionSettings): SafeSyncSettings {
  const { githubToken: _githubToken, ...safeSettings } = settings;
  return safeSyncSettingsSchema.parse(safeSettings);
}

export function toImportableSettings(
  settings: SafeSyncSettings,
): Partial<Omit<ExtensionSettings, 'githubToken' | 'deviceId'>> {
  const { deviceId: _deviceId, ...importableSettings } = settings;
  return importableSettings;
}

export function buildSyncDocument(input: {
  deviceId: string;
  exportedAt: string;
  sessions: TabSession[];
  settings: ExtensionSettings;
}): SyncDocument {
  return syncDocumentSchema.parse({
    schemaVersion: 1,
    deviceId: input.deviceId,
    exportedAt: input.exportedAt,
    sessions: input.sessions,
    settings: toSafeSyncSettings(input.settings),
  });
}

export function parseSyncDocument(value: unknown): SyncDocument {
  return syncDocumentSchema.parse(value);
}
