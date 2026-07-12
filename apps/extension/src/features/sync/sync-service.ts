import {
  canonicalSyncFingerprint,
  canonicalizeSyncDocument,
  MAX_SYNC_DOCUMENT_BYTES,
  mergeSyncDocuments,
  parseSyncDocumentForImport,
  syncDocumentSchema,
  type SyncDocument,
  type SyncDocumentV2,
  type TabSession,
} from '@tabstow/core';
import {
  applyRemoteSyncDocument,
  getSyncSnapshot,
  listSessions,
  markSyncGenerationComplete,
} from '@/db/db';
import { getConnectionRecord } from './connection-store';
import { GistClient, GistFileNotFoundError } from './gist-client';

export class SyncConnectionError extends Error {}
export class SyncTargetError extends Error {
  constructor(
    message: string,
    readonly action: 'inspect-file' | 'rebind' = 'inspect-file',
  ) {
    super(message);
  }
}
export class SyncVerificationError extends Error {}

export type ReconcileResult = {
  connectionGeneration: number;
  sessionCount: number;
  quickLinkCount: number;
  exportedAt?: string;
  importedAt: string;
  wrote: boolean;
  dataChanged: boolean;
  removedImageTokens: string[];
};

function isEmptySyncContent(content: string): boolean {
  const trimmed = content.trim();
  if (trimmed === '') return true;
  try {
    const value: unknown = JSON.parse(trimmed);
    return (
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value) &&
      Object.keys(value).length === 0
    );
  } catch {
    return false;
  }
}

function sourceSchemaVersion(content: string): 1 | 2 {
  const value = JSON.parse(content) as { schemaVersion?: unknown };
  if (value.schemaVersion === 1 || value.schemaVersion === 2) return value.schemaVersion;
  throw new SyncTargetError('The configured Gist file is not a valid Tabstow sync document.');
}

function withExportedAt(document: SyncDocumentV2, exportedAt: string): SyncDocumentV2 {
  return canonicalizeSyncDocument({ ...document, exportedAt });
}

function serialized(document: SyncDocumentV2): string {
  return JSON.stringify(canonicalizeSyncDocument(document), null, 2);
}

function importLegacyConflictRevisions(
  migrated: SyncDocumentV2,
  legacy: SyncDocument,
  local: SyncDocumentV2,
  localSessions: TabSession[],
  replicaId: string,
): SyncDocumentV2 {
  const localEntities = new Map(local.sessions.map((session) => [session.id, session]));
  const localTabs = new Map(local.tabs.map((tab) => [tab.id, tab]));
  const localReadModels = new Map(localSessions.map((session) => [session.id, session]));
  const legacySessions = new Map(legacy.sessions.map((session) => [session.id, session]));
  const remoteWinningSessionIds = new Set<string>();
  const localWinningSessionIds = new Set<string>();

  const sessions = migrated.sessions.map((session) => {
    const localEntity = localEntities.get(session.id);
    const localReadModel = localReadModels.get(session.id);
    const legacySession = legacySessions.get(session.id);
    if (!localEntity || !localReadModel || !legacySession) return session;
    const remoteWins =
      legacySession.updatedAt.localeCompare(localReadModel.updatedAt) > 0 ||
      (legacySession.updatedAt === localReadModel.updatedAt &&
        legacySession.deviceId.localeCompare(localReadModel.deviceId) > 0);
    if (!remoteWins) {
      localWinningSessionIds.add(session.id);
      return { ...session, revision: { counter: 0, replicaId } };
    }
    remoteWinningSessionIds.add(session.id);
    return {
      ...session,
      revision: { counter: localEntity.revision.counter + 1, replicaId },
    };
  });

  const survivingRemoteTabs = migrated.tabs.filter(
    (tab) => !localWinningSessionIds.has(tab.sessionId),
  );
  const remoteTabIds = new Set(survivingRemoteTabs.map(({ id }) => id));
  const remoteOwnedTabIds = new Set<string>();
  const deletions = [...migrated.deletions];
  for (const sessionId of remoteWinningSessionIds) {
    const legacySession = legacySessions.get(sessionId);
    if (!legacySession) continue;

    for (const localTab of local.tabs.filter((tab) => tab.sessionId === sessionId)) {
      if (remoteTabIds.has(localTab.id)) {
        remoteOwnedTabIds.add(localTab.id);
        continue;
      }
      deletions.push({
        entityType: 'tab',
        entityId: localTab.id,
        deletedAt: legacySession.updatedAt,
        revision: {
          counter: localTab.revision.counter + 1,
          replicaId,
        },
      });
    }
  }

  const tabs = survivingRemoteTabs.map((tab) => {
    const localTab = localTabs.get(tab.id);
    if (!localTab || !legacySessions.has(tab.sessionId)) return tab;
    if (
      !remoteWinningSessionIds.has(tab.sessionId) &&
      !remoteOwnedTabIds.has(tab.id)
    ) {
      return { ...tab, revision: { counter: 0, replicaId } };
    }
    return {
      ...tab,
      revision: { counter: localTab.revision.counter + 1, replicaId },
    };
  });
  return canonicalizeSyncDocument({ ...migrated, sessions, tabs, deletions });
}

function observedCoversIntended(
  intended: SyncDocumentV2,
  observed: SyncDocumentV2,
): boolean {
  return (
    canonicalSyncFingerprint(mergeSyncDocuments(intended, observed)) ===
    canonicalSyncFingerprint(observed)
  );
}

type ExpectedConnection = {
  generation: number;
  accountId: number;
  gistId: string;
  fileName: string;
};

async function assertConnection(expected: ExpectedConnection): Promise<void> {
  const current = await getConnectionRecord();
  if (
    current.generation !== expected.generation ||
    current.phase !== 'connected' ||
    current.account?.id !== expected.accountId ||
    current.binding?.gistId !== expected.gistId ||
    current.binding.fileName !== expected.fileName
  ) {
    throw new SyncConnectionError('GitHub connection changed during synchronization.');
  }
}

export async function reconcileGist(options: {
  write: boolean;
  allowInitialize?: boolean;
}): Promise<ReconcileResult> {
  const connection = await getConnectionRecord();
  if (
    connection.phase !== 'connected' ||
    !connection.token ||
    !connection.account ||
    !connection.binding
  ) {
    throw new SyncConnectionError('GitHub is not connected to a confirmed Gist.');
  }
  const connectionGeneration = connection.generation;
  const expectedConnection: ExpectedConnection = {
    generation: connectionGeneration,
    accountId: connection.account.id,
    gistId: connection.binding.gistId,
    fileName: connection.binding.fileName,
  };

  const snapshotBefore = await getSyncSnapshot();
  const client = new GistClient(connection.token);
  const gist = await client.getGist(connection.binding.gistId);
  if (gist.owner.id !== connection.account.id || gist.owner.id !== connection.binding.ownerId) {
    throw new SyncTargetError(
      'The configured Gist is no longer owned by this account.',
      'rebind',
    );
  }
  if (gist.public !== connection.binding.public) {
    throw new SyncTargetError(
      'The configured Gist visibility changed. Review and confirm the target again.',
      'rebind',
    );
  }

  const file = gist.files[connection.binding.fileName];
  let remote: SyncDocumentV2 | null = null;
  let remoteSchemaVersion: 1 | 2 | null = null;
  let initializationRequired = false;
  if (!file) {
    if (!options.allowInitialize) {
      throw new GistFileNotFoundError('The configured Gist sync file was not found.');
    }
    initializationRequired = true;
  } else {
    const content = await client.getFileContentFromGist(gist, connection.binding.fileName);
    if (isEmptySyncContent(content)) {
      if (!options.allowInitialize) {
        throw new SyncTargetError('The configured Gist sync file is unexpectedly empty.');
      }
      initializationRequired = true;
    } else {
      try {
        remoteSchemaVersion = sourceSchemaVersion(content);
        remote = parseSyncDocumentForImport(content, snapshotBefore.replicaId);
        if (remoteSchemaVersion === 1) {
          const legacy = syncDocumentSchema.parse(JSON.parse(content));
          remote = importLegacyConflictRevisions(
            remote,
            legacy,
            snapshotBefore.document,
            await listSessions(),
            snapshotBefore.replicaId,
          );
        }
      } catch (error) {
        if (error instanceof SyntaxError || error instanceof SyncTargetError) throw error;
        throw new SyncTargetError(
          'The configured Gist file is not a valid Tabstow sync document.',
        );
      }
    }
  }

  let converged = snapshotBefore.document;
  let pendingGeneration = snapshotBefore.pendingGeneration;
  let removedImageTokens: string[] = [];
  if (remote) {
    await assertConnection(expectedConnection);
    const applied = await applyRemoteSyncDocument(remote);
    converged = applied.document;
    pendingGeneration = applied.pendingGeneration;
    removedImageTokens = applied.removedImageTokens;
  }
  const dataChanged =
    canonicalSyncFingerprint(snapshotBefore.document) !==
    canonicalSyncFingerprint(converged);
  const importedAt = new Date().toISOString();

  const remoteAlreadyCoversLocal =
    remote !== null &&
    canonicalSyncFingerprint(remote) === canonicalSyncFingerprint(converged);
  if (!options.write) {
    if (remote && remoteAlreadyCoversLocal) {
      await markSyncGenerationComplete(pendingGeneration, remote.exportedAt);
    }
    return {
      connectionGeneration,
      sessionCount: converged.sessions.length,
      quickLinkCount: converged.quickLinks.length,
      importedAt,
      wrote: false,
      dataChanged,
      removedImageTokens,
    };
  }

  const needsWrite =
    initializationRequired || remoteSchemaVersion === 1 || !remoteAlreadyCoversLocal;
  if (!needsWrite) {
    await markSyncGenerationComplete(pendingGeneration, remote!.exportedAt);
    return {
      connectionGeneration,
      sessionCount: converged.sessions.length,
      quickLinkCount: converged.quickLinks.length,
      importedAt,
      wrote: false,
      dataChanged,
      removedImageTokens,
    };
  }

  const exportedAt = new Date().toISOString();
  const intended = withExportedAt(converged, exportedAt);
  const intendedContent = serialized(intended);
  if (new TextEncoder().encode(intendedContent).byteLength > MAX_SYNC_DOCUMENT_BYTES) {
    throw new SyncTargetError('Local synchronized data exceeds the 5 MiB safety limit.');
  }
  await assertConnection(expectedConnection);
  await client.updateFile(
    connection.binding.gistId,
    connection.binding.fileName,
    intendedContent,
  );
  await assertConnection(expectedConnection);

  const verificationGist = await client.getGist(connection.binding.gistId);
  if (verificationGist.owner.id !== connection.account.id) {
    throw new SyncTargetError(
      'The configured Gist owner changed during synchronization.',
      'rebind',
    );
  }
  if (verificationGist.public !== connection.binding.public) {
    throw new SyncTargetError(
      'The configured Gist visibility changed during synchronization.',
      'rebind',
    );
  }
  const verificationFile = verificationGist.files[connection.binding.fileName];
  if (!verificationFile) {
    throw new SyncVerificationError('Gist synchronization verification failed: file missing.');
  }
  const verificationContent = await client.getFileContentFromGist(
    verificationGist,
    connection.binding.fileName,
  );
  let observed: SyncDocumentV2;
  try {
    observed = parseSyncDocumentForImport(
      verificationContent,
      snapshotBefore.replicaId,
    );
  } catch {
    throw new SyncTargetError(
      'The Gist sync file became invalid during synchronization.',
    );
  }
  await assertConnection(expectedConnection);
  const verifiedApply = await applyRemoteSyncDocument(observed);
  removedImageTokens.push(...verifiedApply.removedImageTokens);
  if (!observedCoversIntended(intended, observed)) {
    throw new SyncVerificationError(
      'Gist synchronization verification detected a competing writer.',
    );
  }
  await markSyncGenerationComplete(pendingGeneration, exportedAt);

  return {
    connectionGeneration,
    sessionCount: intended.sessions.length,
    quickLinkCount: intended.quickLinks.length,
    exportedAt,
    importedAt,
    wrote: true,
    dataChanged:
      dataChanged ||
      canonicalSyncFingerprint(converged) !==
        canonicalSyncFingerprint(verifiedApply.document),
    removedImageTokens: [...new Set(removedImageTokens)],
  };
}
