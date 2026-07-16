import {
  safeSyncSettingsSchema,
  syncDocumentSchema,
  type ExtensionSettings,
  type SafeSyncSettings,
  type SyncDocument,
  type SyncedQuickLink,
  type TabSession,
} from './schemas';

export function toSafeSyncSettings(settings: ExtensionSettings): SafeSyncSettings {
  return safeSyncSettingsSchema.parse(settings);
}

export function toImportableSettings(
  settings: SafeSyncSettings,
): Partial<ExtensionSettings> {
  const { deviceId: _deviceId, ...importableSettings } = settings;
  return importableSettings;
}

export function buildSyncDocument(input: {
  deviceId: string;
  exportedAt: string;
  sessions: TabSession[];
  settings: ExtensionSettings;
  quickLinks?: SyncedQuickLink[];
}): SyncDocument {
  return syncDocumentSchema.parse({
    schemaVersion: 1,
    deviceId: input.deviceId,
    exportedAt: input.exportedAt,
    sessions: input.sessions,
    quickLinks: input.quickLinks ?? [],
    settings: toSafeSyncSettings(input.settings),
  });
}

export function parseSyncDocument(value: unknown): SyncDocument {
  return syncDocumentSchema.parse(value);
}
