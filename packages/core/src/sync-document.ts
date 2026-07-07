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
  const { githubToken: _githubToken, theme: _theme, ...safeSettings } = settings;
  return safeSyncSettingsSchema.parse(safeSettings);
}

export function toImportableSettings(
  settings: SafeSyncSettings,
): Partial<ExtensionSettings> {
  const { deviceId: _deviceId, theme: _theme, ...importableSettings } =
    settings as SafeSyncSettings & { theme?: unknown };
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
