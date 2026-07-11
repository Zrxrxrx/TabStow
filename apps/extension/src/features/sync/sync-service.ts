import {
  buildSyncDocument,
  deduplicateSessionsByUrl,
  isZodValidationError,
  mergeSessionsById,
  parseSyncDocument,
  toImportableSettings,
} from '@tabstow/core';
import { exportSessions, mergeRemoteSessions } from '@/db/db';
import {
  mergeQuickLinksForPull,
  mergeQuickLinksForPush,
  toSyncedQuickLinks,
} from '@/features/quick-links/quick-links';
import {
  getQuickLinks,
  updateQuickLinks,
} from '@/features/quick-links/quick-links-storage';
import { getSettings, updateSettings } from '@/features/settings/settings-storage';
import { err, ok, toErrorMessage, type AppResult } from '@/lib/errors';
import type { SyncResult } from '@/lib/messages';
import { GistClient, GistFileNotFoundError } from './gist-client';

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

function isEmptyObject(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === 0
  );
}

export async function pushToGist(): Promise<AppResult<SyncResult>> {
  try {
    const settings = await getSettings();
    const required = requireSyncSettings(settings);
    if (!required.ok) return required;

    const localSessions = await exportSessions();
    const localQuickLinks = await getQuickLinks();
    const exportedAt = new Date().toISOString();
    const client = new GistClient(required.data.githubToken);
    let sessionsToPush = deduplicateSessionsByUrl(localSessions);
    let quickLinksToPush = localQuickLinks;

    try {
      const remoteContent = await client.getFileContent(
        required.data.gistId,
        required.data.gistFileName,
      );
      const remoteValue = JSON.parse(remoteContent);
      if (!isEmptyObject(remoteValue)) {
        const remoteDocument = parseSyncDocument(remoteValue);
        sessionsToPush = deduplicateSessionsByUrl(
          mergeSessionsById(remoteDocument.sessions, localSessions),
        );
        quickLinksToPush = mergeQuickLinksForPush(remoteDocument.quickLinks, localQuickLinks);
      }
    } catch (error) {
      if (!(error instanceof GistFileNotFoundError)) {
        if (error instanceof SyntaxError) {
          return err(
            'invalid-sync-document',
            'The configured Gist file did not contain valid JSON.',
          );
        }
        if (isZodValidationError(error)) {
          return err(
            'invalid-sync-document',
            'The configured Gist file was not a valid Tabstow sync document.',
          );
        }
        throw error;
      }
    }

    const document = buildSyncDocument({
      deviceId: settings.deviceId,
      exportedAt,
      sessions: sessionsToPush,
      quickLinks: toSyncedQuickLinks(quickLinksToPush),
      settings,
    });

    await client.updateFile(
      required.data.gistId,
      required.data.gistFileName,
      JSON.stringify(document, null, 2),
    );

    return ok({
      sessionCount: sessionsToPush.length,
      quickLinkCount: quickLinksToPush.length,
      exportedAt,
    });
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
    const merged = await mergeRemoteSessions(document.sessions);
    const mergedQuickLinks = await updateQuickLinks((currentQuickLinks) =>
      mergeQuickLinksForPull(currentQuickLinks, document.quickLinks),
    );

    await updateSettings(toImportableSettings(document.settings));

    return ok({
      sessionCount: merged.length,
      quickLinkCount: mergedQuickLinks.length,
      importedAt: new Date().toISOString(),
    });
  } catch (error) {
    if (error instanceof GistFileNotFoundError) {
      return err('gist-file-not-found', error.message);
    }
    if (error instanceof SyntaxError) {
      return err('invalid-sync-document', 'The configured Gist file did not contain valid JSON.');
    }
    if (isZodValidationError(error)) {
      return err(
        'invalid-sync-document',
        'The configured Gist file was not a valid Tabstow sync document.',
      );
    }
    return err('github-api-error', toErrorMessage(error));
  }
}
