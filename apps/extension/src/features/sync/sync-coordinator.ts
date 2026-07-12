import { getSyncSnapshot, reschedulePendingSync } from '@/db/db';
import { deleteQuickLinkIcon } from '@/features/quick-links/quick-link-icons-cache';
import { getQuickLinks } from '@/features/quick-links/quick-links-storage';
import { getSettings } from '@/features/settings/settings-storage';
import { browser } from '@/lib/browser';
import { err, ok, toErrorMessage, type AppResult } from '@/lib/errors';
import {
  getConnectionRecord,
  getConnectionView,
  updateConnectionRecord,
} from './connection-store';
import {
  confirmGistTarget,
  disconnectGitHub,
  pollGitHubOAuth,
  type ConnectionServiceResult,
} from './connection-service';
import {
  GitHubApiError,
  GistFileNotFoundError,
} from './gist-client';
import {
  reconcileGist,
  SyncConnectionError,
  SyncTargetError,
  SyncVerificationError,
} from './sync-service';
import type { ConnectionView, SyncResult, SyncStatusView } from './sync-types';

export const SYNC_ALARM_NAME = 'tabstow-sync-v2';
export const OAUTH_ALARM_NAME = 'tabstow-oauth-device-flow-v2';
const READ_COOLDOWN_MS = 60_000;
const MIN_ALARM_DELAY_MS = 30_000;
const RETRY_DELAYS_MS = [60_000, 120_000, 300_000, 900_000, 3_600_000] as const;

let reconciliationQueue: Promise<unknown> = Promise.resolve();
let oauthPollInFlight: Promise<ConnectionView> | null = null;

function serialize<T>(operation: () => Promise<T>): Promise<T> {
  const next = reconciliationQueue.then(operation, operation);
  reconciliationQueue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

async function safeBroadcast(message: unknown): Promise<void> {
  try {
    await browser.runtime.sendMessage(message);
  } catch {
    // No extension page may currently be open.
  }
}

async function broadcastStatus(status: SyncStatusView): Promise<void> {
  await safeBroadcast({ type: 'sync:status-changed', status });
}

async function setSyncStatus(
  expectedGeneration: number,
  status: SyncStatusView,
): Promise<boolean> {
  let stored = false;
  await updateConnectionRecord((current) => {
    if (current.phase !== 'connected' || current.generation !== expectedGeneration) {
      return current;
    }
    stored = true;
    return { ...current, sync: status };
  });
  if (stored) await broadcastStatus(status);
  return stored;
}

async function scheduleNamedAlarm(name: string, requestedAt: number): Promise<void> {
  await browser.alarms.create(name, {
    when: Math.max(requestedAt, Date.now() + MIN_ALARM_DELAY_MS),
  });
}

async function scheduleBestEffort(schedule: () => Promise<unknown>): Promise<void> {
  try {
    await schedule();
  } catch {
    // Pending state is durable; a later trigger or worker bootstrap can recreate the alarm.
  }
}

export async function scheduleOAuthAlarm(): Promise<void> {
  const attempt = (await getConnectionRecord()).oauthAttempt;
  if (!attempt) {
    await browser.alarms.clear(OAUTH_ALARM_NAME);
    return;
  }
  await scheduleNamedAlarm(OAUTH_ALARM_NAME, attempt.nextPollAt);
}

export async function schedulePendingSync(): Promise<void> {
  const [connection, snapshot] = await Promise.all([
    getConnectionRecord(),
    getSyncSnapshot(),
  ]);
  if (connection.phase === 'connected' && connection.sync.state === 'paused') {
    await browser.alarms.clear(SYNC_ALARM_NAME);
    return;
  }
  if (
    connection.phase === 'connected' &&
    connection.sync.state === 'retrying' &&
    connection.sync.retryAt !== undefined
  ) {
    await scheduleNamedAlarm(SYNC_ALARM_NAME, connection.sync.retryAt);
    return;
  }
  if (
    connection.phase === 'connected' &&
    connection.token &&
    connection.binding &&
    connection.initialReconciliationPending === true
  ) {
    await scheduleNamedAlarm(SYNC_ALARM_NAME, Date.now());
    return;
  }
  if (
    connection.phase !== 'connected' ||
    !connection.token ||
    !connection.binding ||
    snapshot.pendingGeneration <= snapshot.syncedGeneration ||
    snapshot.dueAt === undefined
  ) {
    await browser.alarms.clear(SYNC_ALARM_NAME);
    return;
  }
  await scheduleNamedAlarm(SYNC_ALARM_NAME, snapshot.dueAt);
}

export async function noteSynchronizedMutation(): Promise<void> {
  const [connection, snapshot] = await Promise.all([
    getConnectionRecord(),
    getSyncSnapshot(),
  ]);
  if (
    connection.phase === 'connected' &&
    connection.token &&
    connection.binding &&
    snapshot.pendingGeneration > snapshot.syncedGeneration
  ) {
    let pendingStatus: SyncStatusView | undefined;
    let retryAt: number | undefined;
    await updateConnectionRecord((latest) => {
      if (
        latest.phase !== 'connected' ||
        latest.generation !== connection.generation ||
        !latest.token ||
        !latest.binding
      ) {
        return latest;
      }
      if (latest.sync.state === 'paused') return latest;
      if (latest.sync.state === 'retrying') {
        retryAt = latest.sync.retryAt;
        return latest;
      }
      pendingStatus = {
        state: 'pending',
        message: 'Changes are saved locally.',
        ...(latest.sync.lastSuccessAt
          ? { lastSuccessAt: latest.sync.lastSuccessAt }
          : {}),
      };
      return { ...latest, sync: pendingStatus };
    });
    const scheduledRetryAt = retryAt;
    if (scheduledRetryAt !== undefined) {
      await scheduleBestEffort(() =>
        scheduleNamedAlarm(SYNC_ALARM_NAME, scheduledRetryAt),
      );
      return;
    }
    if (!pendingStatus) return;
    await broadcastStatus(pendingStatus);
    await scheduleBestEffort(schedulePendingSync);
  }
}

function transientRetryAt(error: unknown, retryAttempt: number): number {
  const base = RETRY_DELAYS_MS[Math.min(retryAttempt, RETRY_DELAYS_MS.length - 1)]!;
  const jittered = Math.round(base * (0.85 + Math.random() * 0.3));
  if (error instanceof GitHubApiError) {
    if (error.retryAfterMs !== undefined) return Date.now() + error.retryAfterMs;
    if (error.rateLimitResetAt !== undefined) return error.rateLimitResetAt;
  }
  return Date.now() + jittered;
}

function hasGitHubRetryEvidence(error: GitHubApiError): boolean {
  return error.retryAfterMs !== undefined || error.rateLimitResetAt !== undefined;
}

function isTransient(error: unknown): boolean {
  if (error instanceof SyncVerificationError) return true;
  if (error instanceof GitHubApiError) {
    return (
      (error.status === 403 && hasGitHubRetryEvidence(error)) ||
      error.status === 408 ||
      error.status === 429 ||
      error.status >= 500
    );
  }
  return error instanceof TypeError || (error instanceof DOMException && error.name === 'AbortError');
}

async function handleReconcileFailure(
  error: unknown,
  write: boolean,
  expectedGeneration: number,
): Promise<void> {
  const current = await getConnectionRecord();
  if (current.phase !== 'connected' || current.generation !== expectedGeneration) return;
  if (error instanceof GitHubApiError && error.status === 401) {
    await setSyncStatus(expectedGeneration, {
      state: 'paused',
      message: 'GitHub authorization expired. Reconnect to resume synchronization.',
      action: 'reconnect',
      ...(current.sync.lastSuccessAt ? { lastSuccessAt: current.sync.lastSuccessAt } : {}),
    });
    return;
  }
  if (
    error instanceof GitHubApiError &&
    (error.status === 404 ||
      (error.status === 403 && !hasGitHubRetryEvidence(error)))
  ) {
    await setSyncStatus(expectedGeneration, {
      state: 'paused',
      message:
        error.status === 404
          ? 'The configured Gist is unavailable. Choose the sync target again.'
          : 'GitHub can no longer access the configured Gist. Choose the sync target again.',
      action: 'rebind',
      ...(current.sync.lastSuccessAt ? { lastSuccessAt: current.sync.lastSuccessAt } : {}),
    });
    return;
  }
  if (error instanceof GistFileNotFoundError || error instanceof SyncTargetError) {
    await setSyncStatus(expectedGeneration, {
      state: 'paused',
      message: error.message,
      action: error instanceof SyncTargetError ? error.action : 'rebind',
      ...(current.sync.lastSuccessAt ? { lastSuccessAt: current.sync.lastSuccessAt } : {}),
    });
    return;
  }
  if (error instanceof SyntaxError) {
    await setSyncStatus(expectedGeneration, {
      state: 'paused',
      message: 'The Gist sync file contains invalid JSON and was not overwritten.',
      action: 'inspect-file',
      ...(current.sync.lastSuccessAt ? { lastSuccessAt: current.sync.lastSuccessAt } : {}),
    });
    return;
  }
  if (error instanceof SyncConnectionError) {
    if (error.message.includes('changed during synchronization')) return;
    await setSyncStatus(expectedGeneration, {
      state: 'paused',
      message: error.message,
      action: 'reconnect',
      ...(current.sync.lastSuccessAt ? { lastSuccessAt: current.sync.lastSuccessAt } : {}),
    });
    return;
  }
  if (isTransient(error)) {
    let retryAt: number | undefined;
    let retryStatus: SyncStatusView | undefined;
    await updateConnectionRecord((latest) => {
      if (latest.phase !== 'connected' || latest.generation !== expectedGeneration) {
        return latest;
      }
      const retryAttempt = latest.retryAttempt ?? 0;
      retryAt = transientRetryAt(error, retryAttempt);
      retryStatus = {
        state: 'retrying',
        message: 'Changes are saved locally. Synchronization will retry.',
        retryAt,
        ...(latest.sync.lastSuccessAt ? { lastSuccessAt: latest.sync.lastSuccessAt } : {}),
      };
      return {
        ...latest,
        retryAttempt: retryAttempt + 1,
        retryMode: write ? 'push' : 'pull',
        sync: retryStatus,
      };
    });
    if (retryAt === undefined || retryStatus === undefined) return;
    await reschedulePendingSync(retryAt);
    await scheduleNamedAlarm(SYNC_ALARM_NAME, retryAt);
    await broadcastStatus(retryStatus);
    return;
  }
  await setSyncStatus(expectedGeneration, {
    state: 'paused',
    message: toErrorMessage(error),
    action: 'inspect-file',
    ...(current.sync.lastSuccessAt ? { lastSuccessAt: current.sync.lastSuccessAt } : {}),
  });
}

async function reconcileSerialized(
  write: boolean,
  allowInitialize = false,
): Promise<AppResult<SyncResult>> {
  const current = await getConnectionRecord();
  if (current.phase !== 'connected') {
    return err('missing-sync-settings', 'Connect GitHub and confirm a Gist first.');
  }
  const syncingStatus: SyncStatusView = {
    state: 'syncing',
    ...(current.sync.lastSuccessAt ? { lastSuccessAt: current.sync.lastSuccessAt } : {}),
  };
  let syncingStarted = false;
  await updateConnectionRecord((latest) => {
    if (latest.phase !== 'connected' || latest.generation !== current.generation) {
      return latest;
    }
    syncingStarted = true;
    return {
      ...latest,
      retryMode: write ? 'push' : 'pull',
      sync: syncingStatus,
    };
  });
  if (!syncingStarted) {
    return err('missing-sync-settings', 'Connect GitHub and confirm a Gist first.');
  }
  await broadcastStatus(syncingStatus);
  try {
    await getQuickLinks();
    const reconciled = await reconcileGist({
      write,
      allowInitialize:
        write && (allowInitialize || current.initializationAllowed === true),
    });
    for (const token of reconciled.removedImageTokens) {
      await deleteQuickLinkIcon(token).catch(() => undefined);
    }
    const snapshot = await getSyncSnapshot();
    if (reconciled.connectionGeneration !== current.generation) {
      return ok({
        sessionCount: reconciled.sessionCount,
        quickLinkCount: reconciled.quickLinkCount,
        ...(reconciled.exportedAt ? { exportedAt: reconciled.exportedAt } : {}),
        importedAt: reconciled.importedAt,
      });
    }
    const pending =
      snapshot.pendingGeneration > snapshot.syncedGeneration ||
      (!write && current.initialReconciliationPending === true);
    const successfulAt = new Date().toISOString();
    const status: SyncStatusView = pending
      ? {
          state: 'pending',
          message: 'Changes are saved locally.',
          lastSuccessAt: successfulAt,
        }
      : { state: 'synced', lastSuccessAt: successfulAt };
    let successStored = false;
    await updateConnectionRecord((latest) => {
      if (latest.phase !== 'connected' || latest.generation !== current.generation) {
        return latest;
      }
      successStored = true;
      return {
        ...latest,
        retryAttempt: 0,
        retryMode: undefined,
        ...(write
          ? {
              initializationAllowed: undefined,
              initialReconciliationPending: undefined,
            }
          : {}),
        sync: status,
      };
    });
    if (!successStored) {
      return ok({
        sessionCount: reconciled.sessionCount,
        quickLinkCount: reconciled.quickLinkCount,
        ...(reconciled.exportedAt ? { exportedAt: reconciled.exportedAt } : {}),
        importedAt: reconciled.importedAt,
      });
    }
    await broadcastStatus(status);
    if (reconciled.dataChanged) {
      await safeBroadcast({ type: 'sync:data-changed' });
    }
    await schedulePendingSync();
    return ok({
      sessionCount: reconciled.sessionCount,
      quickLinkCount: reconciled.quickLinkCount,
      ...(reconciled.exportedAt ? { exportedAt: reconciled.exportedAt } : {}),
      importedAt: reconciled.importedAt,
    });
  } catch (error) {
    await handleReconcileFailure(error, write, current.generation);
    return err('github-api-error', toErrorMessage(error));
  }
}

export function manualPull(): Promise<AppResult<SyncResult>> {
  return serialize(() => reconcileSerialized(false));
}

export function manualPush(allowInitialize = false): Promise<AppResult<SyncResult>> {
  return serialize(() => reconcileSerialized(true, allowInitialize));
}

export function retrySync(): Promise<AppResult<SyncResult>> {
  return manualPush(false);
}

export async function observeSync(reason: 'open' | 'focus'): Promise<ConnectionView> {
  let shouldRead = false;
  await updateConnectionRecord((current) => {
    const now = Date.now();
    if (
      current.phase !== 'connected' ||
      !current.token ||
      !current.binding ||
      current.sync.state === 'paused' ||
      (current.sync.state === 'retrying' &&
        current.sync.retryAt !== undefined &&
        current.sync.retryAt > now)
    ) {
      return current;
    }
    if (
      reason === 'focus' &&
      current.lastReadAt &&
      now - current.lastReadAt < READ_COOLDOWN_MS
    ) {
      return current;
    }
    shouldRead = true;
    return { ...current, lastReadAt: now };
  });
  if (!shouldRead) {
    return getConnectionView();
  }
  void manualPull();
  return getConnectionView();
}

async function handleConnectionResult(
  connectionResult: ConnectionServiceResult,
): Promise<void> {
  if (connectionResult.shouldReconcile) {
    await manualPush(connectionResult.allowInitialize);
  }
  await safeBroadcast({ type: 'connection:state-changed' });
}

export async function handleOAuthAlarm(): Promise<void> {
  try {
    await pollOAuthNow();
  } catch {
    // Persisted authorization state and the replacement alarm keep polling recoverable.
  }
}

async function runOAuthPoll(): Promise<ConnectionView> {
  try {
    const connectionResult = await pollGitHubOAuth();
    await handleConnectionResult(connectionResult);
    return getConnectionView();
  } finally {
    await scheduleBestEffort(scheduleOAuthAlarm);
  }
}

export function pollOAuthNow(): Promise<ConnectionView> {
  if (oauthPollInFlight) return oauthPollInFlight;
  const poll = runOAuthPoll().finally(() => {
    if (oauthPollInFlight === poll) oauthPollInFlight = null;
  });
  oauthPollInFlight = poll;
  return poll;
}

export async function confirmAndSync(targetKey: string): Promise<ConnectionView> {
  const connectionResult = await confirmGistTarget(targetKey);
  await handleConnectionResult(connectionResult);
  return getConnectionView();
}

export async function handleSyncAlarm(): Promise<void> {
  const connection = await getConnectionRecord();
  if (connection.phase !== 'connected' || connection.sync.state === 'paused') {
    await browser.alarms.clear(SYNC_ALARM_NAME);
    return;
  }
  if (connection.sync.state === 'retrying' && connection.sync.retryAt !== undefined) {
    if (connection.sync.retryAt > Date.now()) {
      await scheduleNamedAlarm(SYNC_ALARM_NAME, connection.sync.retryAt);
      return;
    }
    if (connection.retryMode === 'pull') await manualPull();
    else await manualPush();
    return;
  }
  if (connection.initialReconciliationPending === true) {
    await manualPush();
    return;
  }
  const snapshot = await getSyncSnapshot();
  if (snapshot.pendingGeneration <= snapshot.syncedGeneration) {
    await browser.alarms.clear(SYNC_ALARM_NAME);
    return;
  }
  if (snapshot.dueAt !== undefined && snapshot.dueAt > Date.now()) {
    await scheduleNamedAlarm(SYNC_ALARM_NAME, snapshot.dueAt);
    return;
  }
  await manualPush();
}

export async function bootstrapSyncCoordinator(): Promise<void> {
  await Promise.all([getSettings(), getQuickLinks()]);
  try {
    await browser.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  } catch {
    // Older Chromium builds may not expose setAccessLevel.
  }
  const snapshot = await getSyncSnapshot();
  const connection = await getConnectionRecord();
  if (connection.phase === 'connected' && connection.sync.state === 'syncing') {
    if (snapshot.pendingGeneration > snapshot.syncedGeneration) {
      await updateConnectionRecord((current) => {
        if (
          current.phase !== 'connected' ||
          current.generation !== connection.generation ||
          current.sync.state !== 'syncing'
        ) {
          return current;
        }
        return {
          ...current,
          retryMode: 'push',
          sync: {
            state: 'pending',
            message: 'Changes are saved locally.',
            ...(current.sync.lastSuccessAt
              ? { lastSuccessAt: current.sync.lastSuccessAt }
              : {}),
          },
        };
      });
    } else {
      const retryAt = Date.now() + RETRY_DELAYS_MS[0];
      await updateConnectionRecord((current) => {
        if (
          current.phase !== 'connected' ||
          current.generation !== connection.generation ||
          current.sync.state !== 'syncing'
        ) {
          return current;
        }
        return {
          ...current,
          retryMode: current.retryMode ?? 'pull',
          sync: {
            state: 'retrying',
            message: 'Synchronization was interrupted and will retry.',
            retryAt,
            ...(current.sync.lastSuccessAt
              ? { lastSuccessAt: current.sync.lastSuccessAt }
              : {}),
          },
        };
      });
    }
  }
  const latestConnection = await getConnectionRecord();
  const canStartReconciliation =
    latestConnection.phase === 'connected' &&
    latestConnection.sync.state !== 'paused' &&
    latestConnection.sync.state !== 'retrying' &&
    latestConnection.sync.state !== 'syncing';
  const initialReconciliationPending =
    latestConnection.initialReconciliationPending === true;
  const overduePendingChanges =
    snapshot.pendingGeneration > snapshot.syncedGeneration &&
    snapshot.dueAt !== undefined &&
    snapshot.dueAt <= Date.now();
  if (
    canStartReconciliation &&
    (initialReconciliationPending || overduePendingChanges)
  ) {
    void scheduleBestEffort(() => manualPush());
  }
  await Promise.all([schedulePendingSync(), scheduleOAuthAlarm()]);
}

export async function clearSyncAlarms(): Promise<void> {
  await Promise.all([
    browser.alarms.clear(SYNC_ALARM_NAME),
    browser.alarms.clear(OAUTH_ALARM_NAME),
  ]);
}

export async function disconnectSync(): Promise<ConnectionView> {
  const view = await disconnectGitHub();
  await clearSyncAlarms().catch(() => undefined);
  await serialize(async () => undefined);
  await clearSyncAlarms().catch(() => undefined);
  await safeBroadcast({ type: 'connection:state-changed' });
  return view;
}
