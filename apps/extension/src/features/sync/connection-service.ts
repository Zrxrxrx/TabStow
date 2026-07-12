import {
  getLocalSyncCounts,
  getReplicaId,
  isSyncRepositoryPristine,
} from '@/db/db';
import { getQuickLinks } from '@/features/quick-links/quick-links-storage';
import {
  disconnectConnection,
  getConnectionRecord,
  getConnectionView,
  updateConnectionRecord,
  type ConnectionRecord,
} from './connection-store';
import {
  CANONICAL_SYNC_FILE_NAME,
  discoverGistCandidates,
  inspectGistTarget,
} from './gist-discovery';
import { GistClient } from './gist-client';
import { pollDeviceToken, requestDeviceCode } from './oauth-client';
import type {
  ConnectionView,
  GistBinding,
  GistCandidateView,
  PendingGistBinding,
} from './sync-types';

export type ConnectionServiceResult = {
  view: ConnectionView;
  shouldReconcile: boolean;
  allowInitialize: boolean;
};

function result(
  view: ConnectionView,
  shouldReconcile = false,
  allowInitialize = false,
): ConnectionServiceResult {
  return { view, shouldReconcile, allowInitialize };
}

function candidateBinding(candidate: GistCandidateView): GistBinding {
  return {
    gistId: candidate.gistId,
    fileName: candidate.fileName,
    public: candidate.public,
    htmlUrl: candidate.htmlUrl,
    ownerId: candidate.ownerId,
  };
}

export function getGitHubOAuthClientId(): string {
  return String(import.meta.env.WXT_GITHUB_OAUTH_CLIENT_ID ?? '').trim();
}

type ConnectionGuard = (current: ConnectionRecord) => boolean;

async function updateIfCurrent(
  guard: ConnectionGuard,
  update: (current: ConnectionRecord) => ConnectionRecord,
): Promise<ConnectionRecord | null> {
  let matched = false;
  const record = await updateConnectionRecord((current) => {
    if (!guard(current)) return current;
    matched = true;
    return update(current);
  });
  return matched ? record : null;
}

async function requireCurrent(
  guard: ConnectionGuard,
  update: (current: ConnectionRecord) => ConnectionRecord,
  message: string,
): Promise<ConnectionRecord> {
  const record = await updateIfCurrent(guard, update);
  if (!record) throw new Error(message);
  return record;
}

function isSameAuthorizationAttempt(
  expected: ConnectionRecord,
): ConnectionGuard {
  const attemptId = expected.oauthAttempt?.attemptId;
  return (current) =>
    current.generation === expected.generation &&
    current.phase === 'authorizing' &&
    current.oauthAttempt?.attemptId === attemptId;
}

export async function startGitHubOAuth(
  clientId = getGitHubOAuthClientId(),
): Promise<ConnectionServiceResult> {
  if (!clientId) {
    throw new Error('GitHub OAuth client ID is not configured for this build.');
  }
  const reservation = await updateConnectionRecord((current) => ({
    ...current,
    generation: current.generation + 1,
    phase: 'authorizing',
    token: undefined,
    pendingBinding: undefined,
    candidates: undefined,
    oauthAttempt: undefined,
    initializationAllowed: undefined,
    initialReconciliationPending: undefined,
    retryAttempt: undefined,
    retryMode: undefined,
    sync: { state: 'authorizing', message: 'Waiting for a GitHub device code.' },
  }));

  let grant: Awaited<ReturnType<typeof requestDeviceCode>>;
  try {
    grant = await requestDeviceCode(clientId);
  } catch (error) {
    await updateIfCurrent(
      (current) =>
        current.generation === reservation.generation &&
        current.phase === 'authorizing' &&
        current.oauthAttempt === undefined,
      (current) =>
        authorizationEndedRecord(current, 'GitHub authorization could not be started.'),
    );
    throw error;
  }

  const now = Date.now();
  await updateIfCurrent(
    (current) =>
      current.generation === reservation.generation &&
      current.phase === 'authorizing' &&
      current.oauthAttempt === undefined,
    (current) => ({
      ...current,
      oauthAttempt: {
        attemptId: crypto.randomUUID(),
        deviceCode: grant.deviceCode,
        userCode: grant.userCode,
        verificationUri: grant.verificationUri,
        expiresAt: now + grant.expiresInSeconds * 1_000,
        intervalSeconds: grant.intervalSeconds,
        nextPollAt: now + grant.intervalSeconds * 1_000,
      },
      sync: { state: 'authorizing' },
    }),
  );
  return result(await getConnectionView());
}

function authorizationEndedRecord(current: ConnectionRecord, message: string): ConnectionRecord {
  return {
    generation: current.generation,
    phase: 'disconnected',
    sync: { state: 'disconnected', message },
  };
}

async function finishAuthorization(
  current: ConnectionRecord,
  accessToken: string,
): Promise<ConnectionServiceResult> {
  const client = new GistClient(accessToken);
  const account = await client.getAuthenticatedUser();
  if (current.account?.id === account.id && current.binding) {
    const reconnected = await updateIfCurrent(
      isSameAuthorizationAttempt(current),
      (latest) => ({
        ...latest,
        phase: 'connected',
        token: accessToken,
        account,
        oauthAttempt: undefined,
        initialReconciliationPending: true,
        sync: {
          state: 'pending',
          message: 'GitHub reconnected; synchronization is pending.',
        },
      }),
    );
    return result(await getConnectionView(), reconnected !== null);
  }

  const authorized = await updateIfCurrent(
    isSameAuthorizationAttempt(current),
    () => ({
      generation: current.generation,
      phase: 'needs-target',
      token: accessToken,
      account,
      sync: {
        state: 'needs-target',
        message: 'Looking for an existing Tabstow Gist.',
      },
    }),
  );
  if (!authorized) return result(await getConnectionView());

  const replicaId = await getReplicaId();
  const candidates = await discoverGistCandidates(client, account, replicaId);
  await getQuickLinks();
  const [counts, repositoryIsPristine] = await Promise.all([
    getLocalSyncCounts(),
    isSyncRepositoryPristine(),
  ]);
  const discoveryGuard: ConnectionGuard = (latest) =>
    latest.generation === authorized.generation &&
    latest.phase === 'needs-target' &&
    latest.token === accessToken &&
    latest.account?.id === account.id;
  const onlyCandidate = candidates.length === 1 ? candidates[0] : undefined;
  if (onlyCandidate && !onlyCandidate.public) {
    if (repositoryIsPristine) {
      const connected = await updateIfCurrent(discoveryGuard, (latest) => ({
        generation: latest.generation + 1,
        phase: 'connected',
        token: accessToken,
        account,
        binding: candidateBinding(onlyCandidate),
        initialReconciliationPending: true,
        sync: {
          state: 'pending',
          message: 'GitHub connected; initial synchronization is pending.',
        },
      }));
      return result(await getConnectionView(), connected !== null);
    }
    const pendingBinding: PendingGistBinding = {
      ...candidateBinding(onlyCandidate),
      targetKey: crypto.randomUUID(),
      fileState: onlyCandidate.schemaVersion === 1 ? 'valid-v1' : 'valid-v2',
      localCounts: counts,
    };
    await updateIfCurrent(discoveryGuard, (latest) => ({
      generation: latest.generation + 1,
      phase: 'needs-confirmation',
      token: accessToken,
      account,
      pendingBinding,
      candidates,
      sync: { state: 'needs-confirmation' },
    }));
    return result(await getConnectionView());
  }

  await updateIfCurrent(discoveryGuard, (latest) => ({
    ...latest,
    candidates,
    sync: { state: 'needs-target' },
  }));
  return result(await getConnectionView());
}

export async function pollGitHubOAuth(
  clientId = getGitHubOAuthClientId(),
): Promise<ConnectionServiceResult> {
  const current = await getConnectionRecord();
  const attempt = current.oauthAttempt;
  if (current.phase !== 'authorizing' || !attempt) {
    return result(await getConnectionView());
  }
  const now = Date.now();
  if (now >= attempt.expiresAt) {
    await updateIfCurrent(
      isSameAuthorizationAttempt(current),
      (latest) => authorizationEndedRecord(latest, 'GitHub authorization expired.'),
    );
    return result(await getConnectionView());
  }
  if (now < attempt.nextPollAt) return result(await getConnectionView());

  const polled = await pollDeviceToken(clientId, attempt.deviceCode);
  if (polled.status === 'success') {
    if (!polled.scopes.includes('gist')) {
      await updateIfCurrent(
        isSameAuthorizationAttempt(current),
        (latest) =>
          authorizationEndedRecord(
            latest,
            'GitHub did not grant the required gist scope.',
          ),
      );
      return result(await getConnectionView());
    }
    return finishAuthorization(current, polled.accessToken);
  }
  if (polled.status === 'pending' || polled.status === 'slow-down') {
    await updateIfCurrent(
      isSameAuthorizationAttempt(current),
      (latest) => {
        const latestAttempt = latest.oauthAttempt!;
        const intervalSeconds = Math.max(
          latestAttempt.intervalSeconds,
          attempt.intervalSeconds + (polled.status === 'slow-down' ? 5 : 0),
        );
        return {
          ...latest,
          oauthAttempt: {
            ...latestAttempt,
            intervalSeconds,
            nextPollAt: Math.max(
              latestAttempt.nextPollAt,
              now + intervalSeconds * 1_000,
            ),
          },
        };
      },
    );
    return result(await getConnectionView());
  }
  const message =
    polled.status === 'denied'
      ? 'GitHub authorization was denied.'
      : polled.status === 'expired'
        ? 'GitHub authorization expired.'
        : 'GitHub Device Flow is disabled for this OAuth App.';
  await updateIfCurrent(
    isSameAuthorizationAttempt(current),
    (latest) => authorizationEndedRecord(latest, message),
  );
  return result(await getConnectionView());
}

export async function cancelGitHubOAuth(): Promise<ConnectionView> {
  await updateConnectionRecord((current) => ({
    ...authorizationEndedRecord(current, 'GitHub authorization was cancelled.'),
    generation: current.generation + 1,
  }));
  return getConnectionView();
}

export async function rescanGists(): Promise<ConnectionView> {
  const scanning = await updateConnectionRecord((current) => {
    if (!current.token || !current.account) {
      throw new Error('GitHub is not authorized.');
    }
    return {
      ...current,
      generation: current.generation + 1,
      phase: 'needs-target',
      binding: undefined,
      pendingBinding: undefined,
      candidates: undefined,
      initializationAllowed: undefined,
      initialReconciliationPending: undefined,
      sync: {
        state: 'needs-target',
        message: 'Looking for existing Tabstow Gists.',
      },
    };
  });
  const client = new GistClient(scanning.token!);
  const candidates = await discoverGistCandidates(
    client,
    scanning.account!,
    await getReplicaId(),
  );
  await requireCurrent(
    (latest) =>
      latest.generation === scanning.generation &&
      latest.phase === 'needs-target' &&
      latest.token === scanning.token &&
      latest.account?.id === scanning.account?.id,
    (latest) => ({
      ...latest,
      candidates,
      sync: { state: 'needs-target' },
    }),
    'GitHub connection changed during Gist discovery.',
  );
  return getConnectionView();
}

export async function selectGistTarget(input: {
  gistId: string;
  fileName?: string;
}): Promise<ConnectionView> {
  const current = await getConnectionRecord();
  if (!current.token || !current.account) throw new Error('GitHub is not authorized.');
  if (current.phase !== 'needs-target') {
    throw new Error('Choose another Gist before selecting a new target.');
  }
  const fileName = input.fileName?.trim() || CANONICAL_SYNC_FILE_NAME;
  const inspected = await inspectGistTarget(
    new GistClient(current.token),
    current.account,
    input.gistId.trim(),
    fileName,
    await getReplicaId(),
  );
  await getQuickLinks();
  const pendingBinding: PendingGistBinding = {
    ...inspected,
    targetKey: crypto.randomUUID(),
    localCounts: await getLocalSyncCounts(),
  };
  await requireCurrent(
    (latest) =>
      latest.generation === current.generation &&
      latest.phase === 'needs-target' &&
      latest.token === current.token &&
      latest.account?.id === current.account?.id,
    (latest) => ({
      ...latest,
      generation: latest.generation + 1,
      phase: 'needs-confirmation',
      binding: undefined,
      pendingBinding,
      sync: { state: 'needs-confirmation' },
    }),
    'GitHub connection changed while inspecting the Gist.',
  );
  return getConnectionView();
}

export async function confirmGistTarget(
  targetKey: string,
): Promise<ConnectionServiceResult> {
  let allowInitialize = false;
  await requireCurrent(
    (current) =>
      Boolean(current.token) &&
      Boolean(current.account) &&
      current.phase === 'needs-confirmation' &&
      current.pendingBinding?.targetKey === targetKey,
    (current) => {
      const pending = current.pendingBinding!;
      allowInitialize = pending.fileState === 'missing' || pending.fileState === 'empty';
      const {
        targetKey: _targetKey,
        fileState: _fileState,
        localCounts: _localCounts,
        ...binding
      } = pending;
      return {
        ...current,
        generation: current.generation + 1,
        phase: 'connected',
        binding,
        pendingBinding: undefined,
        candidates: undefined,
        initializationAllowed: allowInitialize,
        initialReconciliationPending: true,
        sync: { state: 'pending', message: 'Initial synchronization is pending.' },
      };
    },
    'The Gist confirmation is stale. Please choose the Gist again.',
  );
  return result(await getConnectionView(), true, allowInitialize);
}

export async function chooseAnotherGist(): Promise<ConnectionView> {
  await updateConnectionRecord((current) => {
    if (!current.token || !current.account) {
      throw new Error('GitHub is not authorized.');
    }
    return {
      ...current,
      generation: current.generation + 1,
      phase: 'needs-target',
      binding: undefined,
      pendingBinding: undefined,
      initializationAllowed: undefined,
      initialReconciliationPending: undefined,
      sync: { state: 'needs-target' },
    };
  });
  return getConnectionView();
}

export async function disconnectGitHub(): Promise<ConnectionView> {
  await disconnectConnection();
  return getConnectionView();
}
