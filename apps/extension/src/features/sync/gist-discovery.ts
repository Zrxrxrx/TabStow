import { parseSyncDocumentForImport } from '@tabstow/core';
import { GitHubApiError, type GistClient, type GistInfo } from './gist-client';
import type {
  GistBinding,
  GistCandidateView,
  GitHubAccount,
  PendingGistBinding,
} from './sync-types';

export const CANONICAL_SYNC_FILE_NAME = 'tabstow.sync.json';

export class InvalidSyncTargetError extends Error {}
export class ForeignGistOwnerError extends Error {}

export type InspectedGistTarget = GistBinding & {
  fileState: PendingGistBinding['fileState'];
  schemaVersion?: 1 | 2;
};

function schemaVersionFromContent(content: string): 1 | 2 {
  const value = JSON.parse(content) as { schemaVersion?: unknown };
  if (value.schemaVersion === 1 || value.schemaVersion === 2) return value.schemaVersion;
  throw new InvalidSyncTargetError('The selected Gist sync file is invalid.');
}

function bindingFromGist(gist: GistInfo, fileName: string): GistBinding {
  return {
    gistId: gist.id,
    fileName,
    public: gist.public,
    htmlUrl: gist.htmlUrl,
    ownerId: gist.owner.id,
  };
}

function ensureOwned(gist: GistInfo, account: GitHubAccount): void {
  if (gist.owner.id !== account.id) {
    throw new ForeignGistOwnerError('The selected Gist must be owned by the connected account.');
  }
}

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

function isDiscoveryTransportError(error: unknown): boolean {
  return (
    error instanceof GitHubApiError ||
    error instanceof TypeError ||
    (error instanceof DOMException && error.name === 'AbortError')
  );
}

export async function discoverGistCandidates(
  client: GistClient,
  account: GitHubAccount,
  replicaId: string,
): Promise<GistCandidateView[]> {
  const candidates: GistCandidateView[] = [];
  const gists = await client.listGists();
  for (const gist of gists) {
    if (gist.owner.id !== account.id || !gist.files[CANONICAL_SYNC_FILE_NAME]) continue;
    let content: string;
    try {
      content = await client.getFileContentFromGist(gist, CANONICAL_SYNC_FILE_NAME);
    } catch (error) {
      if (isDiscoveryTransportError(error)) throw error;
      continue;
    }
    try {
      if (isEmptySyncContent(content)) continue;
      const schemaVersion = schemaVersionFromContent(content);
      parseSyncDocumentForImport(content, replicaId);
      candidates.push({
        ...bindingFromGist(gist, CANONICAL_SYNC_FILE_NAME),
        description: gist.description,
        schemaVersion,
      });
    } catch {
      // Invalid content is ignored during discovery and remains manually selectable.
    }
  }
  return candidates;
}

export async function inspectGistTarget(
  client: GistClient,
  account: GitHubAccount,
  gistId: string,
  fileName: string,
  replicaId: string,
): Promise<InspectedGistTarget> {
  const gist = await client.getGist(gistId);
  ensureOwned(gist, account);
  const binding = bindingFromGist(gist, fileName);
  if (!gist.files[fileName]) return { ...binding, fileState: 'missing' };

  const content = await client.getFileContentFromGist(gist, fileName);
  if (isEmptySyncContent(content)) return { ...binding, fileState: 'empty' };

  try {
    const schemaVersion = schemaVersionFromContent(content);
    parseSyncDocumentForImport(content, replicaId);
    return {
      ...binding,
      fileState: schemaVersion === 1 ? 'valid-v1' : 'valid-v2',
      schemaVersion,
    };
  } catch {
    throw new InvalidSyncTargetError(
      'The selected Gist sync file contains invalid non-empty content.',
    );
  }
}
