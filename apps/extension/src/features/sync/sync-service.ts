import {
  buildSyncDocument,
  mergeSessionsById,
  parseSyncDocument,
  toImportableSettings,
} from '@tabstow/core';
import { exportSessions, importSessions, listSessions } from '@/db/db';
import { getSettings, updateSettings } from '@/features/settings/settings-storage';
import { err, ok, toErrorMessage, type AppResult } from '@/lib/errors';
import type { SyncResult } from '@/lib/messages';
import { GistClient } from './gist-client';

function requireSyncSettings(settings: {
  githubToken?: string;
  gistId?: string;
  gistFileName?: string;
}): AppResult<{ githubToken: string; gistId: string; gistFileName: string }> {
  if (!settings.githubToken || !settings.gistId || !settings.gistFileName) {
    return err(
      'missing-sync-settings',
      'GitHub token, Gist ID, and Gist filename are required for manual sync.',
    );
  }

  return ok({
    githubToken: settings.githubToken,
    gistId: settings.gistId,
    gistFileName: settings.gistFileName,
  });
}

export async function pushToGist(): Promise<AppResult<SyncResult>> {
  try {
    const settings = await getSettings();
    const required = requireSyncSettings(settings);
    if (!required.ok) return required;

    const sessions = await exportSessions();
    const exportedAt = new Date().toISOString();
    const document = buildSyncDocument({
      deviceId: settings.deviceId,
      exportedAt,
      sessions,
      settings,
    });

    const client = new GistClient(required.data.githubToken);
    await client.updateFile(
      required.data.gistId,
      required.data.gistFileName,
      JSON.stringify(document, null, 2),
    );

    return ok({ sessionCount: sessions.length, exportedAt });
  } catch (error) {
    return err('github-api-error', toErrorMessage(error));
  }
}

export async function pullFromGist(): Promise<AppResult<SyncResult>> {
  try {
    const settings = await getSettings();
    const required = requireSyncSettings(settings);
    if (!required.ok) return required;

    const client = new GistClient(required.data.githubToken);
    const content = await client.getFileContent(required.data.gistId, required.data.gistFileName);
    const document = parseSyncDocument(JSON.parse(content));
    const merged = mergeSessionsById(await listSessions(), document.sessions);

    await importSessions(merged);
    await updateSettings(toImportableSettings(document.settings));

    return ok({
      sessionCount: merged.length,
      importedAt: new Date().toISOString(),
    });
  } catch (error) {
    const message = toErrorMessage(error);
    if (message === 'Gist file was not found.') {
      return err('gist-file-not-found', message);
    }
    if (error instanceof SyntaxError) {
      return err('invalid-sync-document', 'The configured Gist file did not contain valid JSON.');
    }
    if (message.includes('Invalid') || message.includes('Expected')) {
      return err(
        'invalid-sync-document',
        'The configured Gist file was not a valid Tabstow sync document.',
      );
    }
    return err('github-api-error', message);
  }
}
