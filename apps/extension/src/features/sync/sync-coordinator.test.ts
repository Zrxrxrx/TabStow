import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionRecord } from './connection-store';

const dbMocks = vi.hoisted(() => ({
  getSyncSnapshot: vi.fn(),
  reschedulePendingSync: vi.fn(),
}));

const browserMocks = vi.hoisted(() => ({
  alarms: {
    create: vi.fn(),
    clear: vi.fn(),
  },
  runtime: {
    sendMessage: vi.fn(),
  },
  storage: {
    local: {
      setAccessLevel: vi.fn(),
    },
  },
}));

const settingsMocks = vi.hoisted(() => ({ getSettings: vi.fn() }));
const iconMocks = vi.hoisted(() => ({ deleteQuickLinkIcon: vi.fn() }));
const quickLinkStorageMocks = vi.hoisted(() => ({ getQuickLinks: vi.fn() }));
const reconcileMocks = vi.hoisted(() => ({ reconcileGist: vi.fn() }));
const connectionServiceMocks = vi.hoisted(() => ({
  confirmGistTarget: vi.fn(),
  disconnectGitHub: vi.fn(),
  pollGitHubOAuth: vi.fn(),
}));

let connection: ConnectionRecord;

const connectionStoreMocks = vi.hoisted(() => ({
  getConnectionRecord: vi.fn(),
  getConnectionView: vi.fn(),
  saveConnectionRecord: vi.fn(),
  updateConnectionRecord: vi.fn(),
}));

vi.mock('@/db/db', () => dbMocks);
vi.mock('@/lib/browser', () => ({ browser: browserMocks }));
vi.mock('@/features/settings/settings-storage', () => settingsMocks);
vi.mock('@/features/quick-links/quick-link-icons-cache', () => iconMocks);
vi.mock('@/features/quick-links/quick-links-storage', () => quickLinkStorageMocks);
vi.mock('./sync-service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./sync-service')>()),
  reconcileGist: reconcileMocks.reconcileGist,
}));
vi.mock('./connection-service', () => connectionServiceMocks);
vi.mock('./connection-store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./connection-store')>()),
  ...connectionStoreMocks,
}));

function connectedRecord(): ConnectionRecord {
  return {
    generation: 1,
    phase: 'connected',
    token: 'oauth-token',
    account: { id: 1, login: 'octocat' },
    binding: {
      gistId: 'gist-1',
      fileName: 'tabstow.sync.json',
      public: false,
      htmlUrl: 'https://gist.github.com/octocat/gist-1',
      ownerId: 1,
    },
    sync: { state: 'pending' },
  };
}

describe('sync coordinator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-12T00:00:00.000Z'));
    connection = connectedRecord();
    connectionStoreMocks.getConnectionRecord.mockImplementation(async () => connection);
    connectionStoreMocks.getConnectionView.mockImplementation(async () => ({
      phase: connection.phase,
      sync: connection.sync,
      account: connection.account,
      binding: connection.binding,
    }));
    connectionStoreMocks.saveConnectionRecord.mockImplementation(async (next) => {
      connection = next;
      return next;
    });
    connectionStoreMocks.updateConnectionRecord.mockImplementation(async (update) => {
      connection = update(connection);
      return connection;
    });
    dbMocks.getSyncSnapshot.mockResolvedValue({
      document: {},
      replicaId: 'replica-local',
      pendingGeneration: 2,
      syncedGeneration: 1,
      dueAt: Date.now() + 60_000,
    });
    dbMocks.reschedulePendingSync.mockResolvedValue(undefined);
    browserMocks.alarms.create.mockResolvedValue(undefined);
    browserMocks.alarms.clear.mockResolvedValue(true);
    browserMocks.runtime.sendMessage.mockResolvedValue(undefined);
    iconMocks.deleteQuickLinkIcon.mockResolvedValue(undefined);
    quickLinkStorageMocks.getQuickLinks.mockResolvedValue([]);
    reconcileMocks.reconcileGist.mockResolvedValue({
      connectionGeneration: 1,
      sessionCount: 1,
      quickLinkCount: 0,
      importedAt: '2026-07-12T00:00:01.000Z',
      wrote: true,
      dataChanged: false,
      removedImageTokens: [],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('replaces one named 60-second alarm across a burst of mutations', async () => {
    const { noteSynchronizedMutation, SYNC_ALARM_NAME } = await import('./sync-coordinator');

    await noteSynchronizedMutation();
    await noteSynchronizedMutation();

    expect(browserMocks.alarms.create).toHaveBeenCalledTimes(2);
    for (const call of browserMocks.alarms.create.mock.calls) {
      expect(call[0]).toBe(SYNC_ALARM_NAME);
      expect(call[1]).toEqual({ when: Date.now() + 60_000 });
    }
  });

  it('keeps synchronization paused when another local mutation succeeds', async () => {
    connection.sync = {
      state: 'paused',
      message: 'Reconnect GitHub to resume synchronization.',
      action: 'reconnect',
      lastSuccessAt: '2026-07-11T23:00:00.000Z',
    };
    const pausedStatus = connection.sync;
    const { noteSynchronizedMutation } = await import('./sync-coordinator');

    await noteSynchronizedMutation();

    expect(connection.sync).toEqual(pausedStatus);
    expect(browserMocks.alarms.create).not.toHaveBeenCalled();
  });

  it('does not schedule or run automatic synchronization while paused', async () => {
    connection.sync = {
      state: 'paused',
      message: 'Reconnect GitHub to resume synchronization.',
      action: 'reconnect',
    };
    const { handleSyncAlarm, observeSync, schedulePendingSync, SYNC_ALARM_NAME } =
      await import('./sync-coordinator');

    await schedulePendingSync();
    await handleSyncAlarm();
    await observeSync('focus');

    expect(browserMocks.alarms.clear).toHaveBeenCalledWith(SYNC_ALARM_NAME);
    expect(browserMocks.alarms.create).not.toHaveBeenCalled();
    expect(reconcileMocks.reconcileGist).not.toHaveBeenCalled();
  });

  it('keeps a provider retry deadline when another local mutation succeeds', async () => {
    const retryAt = Date.now() + 15 * 60_000;
    connection.sync = {
      state: 'retrying',
      message: 'GitHub asked Tabstow to retry later.',
      retryAt,
      lastSuccessAt: '2026-07-11T23:00:00.000Z',
    };
    const retryingStatus = connection.sync;
    const { noteSynchronizedMutation, observeSync, SYNC_ALARM_NAME } =
      await import('./sync-coordinator');

    await noteSynchronizedMutation();
    await observeSync('focus');

    expect(connection.sync).toEqual(retryingStatus);
    expect(browserMocks.alarms.create).toHaveBeenCalledWith(SYNC_ALARM_NAME, {
      when: retryAt,
    });
    expect(reconcileMocks.reconcileGist).not.toHaveBeenCalled();
    expect(connection.lastReadAt).toBeUndefined();
  });

  it('allows an observe read after the retry deadline has passed', async () => {
    connection.sync = {
      state: 'retrying',
      message: 'Synchronization will retry.',
      retryAt: Date.now() - 1,
    };
    const { observeSync } = await import('./sync-coordinator');
    const observedAt = Date.now();

    await observeSync('focus');
    await vi.waitFor(() => expect(reconcileMocks.reconcileGist).toHaveBeenCalledTimes(1));

    expect(connection.lastReadAt).toBe(observedAt);
  });

  it('does not overwrite retrying when it starts after the mutation snapshot is read', async () => {
    const retryAt = Date.now() + 15 * 60_000;
    connectionStoreMocks.updateConnectionRecord.mockImplementationOnce(async (update) => {
      connection.sync = {
        state: 'retrying',
        message: 'GitHub asked Tabstow to retry later.',
        retryAt,
      };
      connection = update(connection);
      return connection;
    });
    const { noteSynchronizedMutation, SYNC_ALARM_NAME } = await import('./sync-coordinator');

    await noteSynchronizedMutation();

    expect(connection.sync).toMatchObject({ state: 'retrying', retryAt });
    expect(browserMocks.alarms.create).toHaveBeenCalledWith(SYNC_ALARM_NAME, {
      when: retryAt,
    });
  });

  it('treats alarm scheduling as best-effort after a local mutation succeeds', async () => {
    browserMocks.alarms.create.mockRejectedValueOnce(new Error('alarms unavailable'));
    const { noteSynchronizedMutation } = await import('./sync-coordinator');

    await expect(noteSynchronizedMutation()).resolves.toBeUndefined();

    expect(connection.sync).toMatchObject({
      state: 'pending',
      message: 'Changes are saved locally.',
    });
  });

  it('coalesces focus reads behind the persisted cooldown after opening', async () => {
    const { observeSync } = await import('./sync-coordinator');

    await observeSync('open');
    await observeSync('focus');
    await vi.waitFor(() => expect(reconcileMocks.reconcileGist).toHaveBeenCalledTimes(1));

    expect(connection.lastReadAt).toBe(
      new Date('2026-07-12T00:00:00.000Z').getTime(),
    );
    expect(reconcileMocks.reconcileGist).toHaveBeenCalledWith({
      write: false,
      allowInitialize: false,
    });
  });

  it('reads immediately for each newly opened New Tab', async () => {
    const { observeSync } = await import('./sync-coordinator');

    await observeSync('open');
    await observeSync('open');
    await vi.waitFor(() =>
      expect(reconcileMocks.reconcileGist).toHaveBeenCalledTimes(2),
    );

    expect(reconcileMocks.reconcileGist).toHaveBeenNthCalledWith(1, {
      write: false,
      allowInitialize: false,
    });
    expect(reconcileMocks.reconcileGist).toHaveBeenNthCalledWith(2, {
      write: false,
      allowInitialize: false,
    });
  });

  it('shares one in-flight OAuth poll between the Settings timer and alarm', async () => {
    let finishOAuthPoll!: (result: unknown) => void;
    connectionServiceMocks.pollGitHubOAuth.mockReturnValue(
      new Promise((resolve) => {
        finishOAuthPoll = resolve;
      }),
    );
    const { pollOAuthNow } = await import('./sync-coordinator');

    const settingsPoll = pollOAuthNow();
    const alarmPoll = pollOAuthNow();
    await Promise.resolve();
    const pollsStartedBeforeCompletion =
      connectionServiceMocks.pollGitHubOAuth.mock.calls.length;
    finishOAuthPoll({
      view: { phase: 'connected', sync: { state: 'pending' } },
      shouldReconcile: false,
      allowInitialize: false,
    });
    await Promise.all([settingsPoll, alarmPoll]);

    expect(pollsStartedBeforeCompletion).toBe(1);
    expect(connectionServiceMocks.pollGitHubOAuth).toHaveBeenCalledTimes(1);
  });

  it('uses persisted initialization permission after a worker restart', async () => {
    connection.initializationAllowed = true;
    const { manualPush } = await import('./sync-coordinator');

    await manualPush();

    expect(reconcileMocks.reconcileGist).toHaveBeenCalledWith({
      write: true,
      allowInitialize: true,
    });
  });

  it('does not consume initialization permission during Manual Pull', async () => {
    connection.initializationAllowed = true;
    connection.initialReconciliationPending = true;
    const { manualPull } = await import('./sync-coordinator');

    await manualPull();

    expect(reconcileMocks.reconcileGist).toHaveBeenCalledWith({
      write: false,
      allowInitialize: false,
    });
    expect(connection.initializationAllowed).toBe(true);
    expect(connection.initialReconciliationPending).toBe(true);
    expect(connection.sync.state).toBe('pending');
    expect(browserMocks.alarms.create).toHaveBeenCalledWith(
      'tabstow-sync-v2',
      { when: Date.now() + 30_000 },
    );
  });

  it('resumes a persisted initial reconciliation after a worker restart', async () => {
    connection.initialReconciliationPending = true;
    dbMocks.getSyncSnapshot.mockResolvedValue({
      document: {},
      replicaId: 'replica-local',
      pendingGeneration: 0,
      syncedGeneration: 0,
    });
    settingsMocks.getSettings.mockResolvedValue({});
    browserMocks.storage.local.setAccessLevel.mockResolvedValue(undefined);
    const { bootstrapSyncCoordinator } = await import('./sync-coordinator');

    await bootstrapSyncCoordinator();
    await vi.waitFor(() => expect(reconcileMocks.reconcileGist).toHaveBeenCalledTimes(1));
    await vi.waitFor(() =>
      expect(connection.initialReconciliationPending).toBeUndefined(),
    );

    expect(reconcileMocks.reconcileGist).toHaveBeenCalledWith({
      write: true,
      allowInitialize: false,
    });
  });

  it('waits for legacy Quick Links migration before reconciling', async () => {
    let finishQuickLinkMigration!: (links: unknown[]) => void;
    quickLinkStorageMocks.getQuickLinks.mockReturnValueOnce(
      new Promise((resolve) => {
        finishQuickLinkMigration = resolve;
      }),
    );
    const { manualPush } = await import('./sync-coordinator');

    const push = manualPush();
    await Promise.resolve();
    await Promise.resolve();
    const reconciledBeforeMigration = reconcileMocks.reconcileGist.mock.calls.length > 0;
    finishQuickLinkMigration([]);
    await push;

    expect(quickLinkStorageMocks.getQuickLinks).toHaveBeenCalledTimes(1);
    expect(reconciledBeforeMigration).toBe(false);
    expect(reconcileMocks.reconcileGist).toHaveBeenCalledTimes(1);
  });

  it('does not start reconciliation when the connection changes before syncing status is stored', async () => {
    connectionStoreMocks.getConnectionRecord.mockImplementationOnce(async () => {
      const staleConnectedRecord = connection;
      connection = {
        generation: 2,
        phase: 'disconnected',
        sync: { state: 'disconnected' },
      };
      return staleConnectedRecord;
    });
    const { manualPush } = await import('./sync-coordinator');

    const response = await manualPush();

    expect(response).toMatchObject({
      ok: false,
      error: { code: 'missing-sync-settings' },
    });
    expect(connection.sync).toEqual({ state: 'disconnected' });
    expect(reconcileMocks.reconcileGist).not.toHaveBeenCalled();
  });

  it('does not write a stale non-transient error after disconnect', async () => {
    const { GitHubApiError } = await import('./gist-client');
    reconcileMocks.reconcileGist.mockRejectedValueOnce(
      new GitHubApiError('GitHub returned 404.', 404),
    );
    let connectionUpdateCount = 0;
    connectionStoreMocks.updateConnectionRecord.mockImplementation(async (update) => {
      connectionUpdateCount += 1;
      if (connectionUpdateCount === 2) {
        connection = {
          generation: 2,
          phase: 'disconnected',
          sync: { state: 'disconnected' },
        };
      }
      connection = update(connection);
      return connection;
    });
    const { manualPull } = await import('./sync-coordinator');

    await manualPull();

    expect(connection.sync).toEqual({ state: 'disconnected' });
  });

  it('does not write stale success status after disconnect', async () => {
    let connectionUpdateCount = 0;
    connectionStoreMocks.updateConnectionRecord.mockImplementation(async (update) => {
      connectionUpdateCount += 1;
      if (connectionUpdateCount === 2) {
        connection = {
          generation: 2,
          phase: 'disconnected',
          sync: { state: 'disconnected' },
        };
      }
      connection = update(connection);
      return connection;
    });
    const { manualPush } = await import('./sync-coordinator');

    await manualPush();

    expect(connection.sync).toEqual({ state: 'disconnected' });
  });

  it('invalidates the connection before waiting for active and queued synchronization', async () => {
    let finishReconcile!: (value: unknown) => void;
    reconcileMocks.reconcileGist.mockReturnValueOnce(
      new Promise((resolve) => {
        finishReconcile = resolve;
      }),
    );
    connectionServiceMocks.disconnectGitHub.mockImplementation(async () => {
      connection = {
        generation: 2,
        phase: 'disconnected',
        sync: { state: 'disconnected' },
      };
      return { phase: 'disconnected', sync: { state: 'disconnected' } };
    });
    const { disconnectSync, manualPush, OAUTH_ALARM_NAME, SYNC_ALARM_NAME } =
      await import('./sync-coordinator');

    const activePush = manualPush();
    await vi.waitFor(() => expect(reconcileMocks.reconcileGist).toHaveBeenCalledTimes(1));
    const queuedPush = manualPush();
    const disconnect = disconnectSync();
    await Promise.resolve();
    await Promise.resolve();
    const invalidatedBeforeNetworkSettled =
      connectionServiceMocks.disconnectGitHub.mock.calls.length === 1;
    const alarmsClearedBeforeNetworkSettled =
      browserMocks.alarms.clear.mock.calls.some(([name]) => name === SYNC_ALARM_NAME) &&
      browserMocks.alarms.clear.mock.calls.some(([name]) => name === OAUTH_ALARM_NAME);

    finishReconcile({
      connectionGeneration: 1,
      sessionCount: 1,
      quickLinkCount: 0,
      importedAt: '2026-07-12T00:00:01.000Z',
      wrote: true,
      dataChanged: false,
      removedImageTokens: [],
    });
    await Promise.all([activePush, queuedPush, disconnect]);

    expect(invalidatedBeforeNetworkSettled).toBe(true);
    expect(alarmsClearedBeforeNetworkSettled).toBe(true);
    expect(reconcileMocks.reconcileGist).toHaveBeenCalledTimes(1);
    expect(
      browserMocks.alarms.clear.mock.calls.filter(([name]) => name === SYNC_ALARM_NAME),
    ).toHaveLength(2);
    expect(
      browserMocks.alarms.clear.mock.calls.filter(([name]) => name === OAUTH_ALARM_NAME),
    ).toHaveLength(2);
  });

  it('persists and schedules transient retries without losing local changes', async () => {
    reconcileMocks.reconcileGist.mockRejectedValueOnce(new TypeError('offline'));
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const { manualPush, SYNC_ALARM_NAME } = await import('./sync-coordinator');

    const response = await manualPush();

    expect(response.ok).toBe(false);
    expect(connection.sync).toMatchObject({ state: 'retrying' });
    expect(connection.retryMode).toBe('push');
    expect(dbMocks.reschedulePendingSync).toHaveBeenCalledWith(Date.now() + 60_000);
    expect(browserMocks.alarms.create).toHaveBeenCalledWith(SYNC_ALARM_NAME, {
      when: Date.now() + 60_000,
    });
  });

  it('does not restore stale connection state when disconnect races a transient failure', async () => {
    reconcileMocks.reconcileGist.mockRejectedValueOnce(new TypeError('offline'));
    let connectionReadCount = 0;
    connectionStoreMocks.getConnectionRecord.mockImplementation(async () => {
      connectionReadCount += 1;
      if (connectionReadCount === 2) {
        const staleConnectedRecord = connection;
        connection = {
          generation: 2,
          phase: 'disconnected',
          sync: { state: 'disconnected' },
        };
        return staleConnectedRecord;
      }
      return connection;
    });
    const { manualPush } = await import('./sync-coordinator');

    await manualPush();

    expect(connection).toMatchObject({
      generation: 2,
      phase: 'disconnected',
      sync: { state: 'disconnected' },
    });
    expect(browserMocks.alarms.create).not.toHaveBeenCalled();
  });

  it('pauses for rebinding on a 403 without rate-limit retry evidence', async () => {
    const { GitHubApiError } = await import('./gist-client');
    reconcileMocks.reconcileGist.mockRejectedValueOnce(
      new GitHubApiError('GitHub returned 403.', 403),
    );
    const { manualPush } = await import('./sync-coordinator');

    await manualPush();

    expect(connection.sync).toMatchObject({
      state: 'paused',
      action: 'rebind',
    });
    expect(dbMocks.reschedulePendingSync).not.toHaveBeenCalled();
  });

  it('retries a 403 that includes Retry-After evidence', async () => {
    const { GitHubApiError } = await import('./gist-client');
    reconcileMocks.reconcileGist.mockRejectedValueOnce(
      new GitHubApiError('GitHub rate limit reached.', 403, 5 * 60_000),
    );
    const { manualPush, SYNC_ALARM_NAME } = await import('./sync-coordinator');

    await manualPush();

    expect(connection.sync).toMatchObject({
      state: 'retrying',
      retryAt: Date.now() + 5 * 60_000,
    });
    expect(browserMocks.alarms.create).toHaveBeenCalledWith(SYNC_ALARM_NAME, {
      when: Date.now() + 5 * 60_000,
    });
  });

  it('pauses for rebinding when the configured Gist returns 404', async () => {
    const { GitHubApiError } = await import('./gist-client');
    reconcileMocks.reconcileGist.mockRejectedValueOnce(
      new GitHubApiError('GitHub returned 404.', 404),
    );
    const { manualPull } = await import('./sync-coordinator');

    await manualPull();

    expect(connection.sync).toMatchObject({
      state: 'paused',
      action: 'rebind',
    });
    expect(dbMocks.reschedulePendingSync).not.toHaveBeenCalled();
  });

  it('recovers a stale syncing state after a worker restart', async () => {
    connection.sync = { state: 'syncing' };
    connection.retryMode = 'pull';
    dbMocks.getSyncSnapshot.mockResolvedValue({
      document: {},
      replicaId: 'replica-local',
      pendingGeneration: 0,
      syncedGeneration: 0,
    });
    settingsMocks.getSettings.mockResolvedValue({});
    browserMocks.storage.local.setAccessLevel.mockResolvedValue(undefined);
    const { bootstrapSyncCoordinator, SYNC_ALARM_NAME } = await import('./sync-coordinator');

    await bootstrapSyncCoordinator();

    expect(connection.sync).toMatchObject({
      state: 'retrying',
      retryAt: Date.now() + 60_000,
    });
    expect(browserMocks.alarms.create).toHaveBeenCalledWith(SYNC_ALARM_NAME, {
      when: Date.now() + 60_000,
    });
  });

  it('does not bypass a paused state when overdue work is found at startup', async () => {
    connection.sync = {
      state: 'paused',
      message: 'Reconnect GitHub to resume synchronization.',
      action: 'reconnect',
    };
    dbMocks.getSyncSnapshot.mockResolvedValue({
      document: {},
      replicaId: 'replica-local',
      pendingGeneration: 2,
      syncedGeneration: 1,
      dueAt: Date.now() - 60_000,
    });
    settingsMocks.getSettings.mockResolvedValue({});
    browserMocks.storage.local.setAccessLevel.mockResolvedValue(undefined);
    const { bootstrapSyncCoordinator } = await import('./sync-coordinator');

    await bootstrapSyncCoordinator();
    await Promise.resolve();

    expect(reconcileMocks.reconcileGist).not.toHaveBeenCalled();
    expect(connection.sync).toMatchObject({ state: 'paused' });
  });
});
