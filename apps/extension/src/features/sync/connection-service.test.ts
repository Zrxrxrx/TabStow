import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionRecord } from './connection-store';

const oauthMocks = vi.hoisted(() => ({
  pollDeviceToken: vi.fn(),
  requestDeviceCode: vi.fn(),
}));
const gistMocks = vi.hoisted(() => ({ getAuthenticatedUser: vi.fn() }));
const discoveryMocks = vi.hoisted(() => ({
  discoverGistCandidates: vi.fn(),
  inspectGistTarget: vi.fn(),
}));
const dbMocks = vi.hoisted(() => ({
  getLocalSyncCounts: vi.fn(),
  getReplicaId: vi.fn(),
  isSyncRepositoryPristine: vi.fn(),
}));
const quickLinkStorageMocks = vi.hoisted(() => ({ getQuickLinks: vi.fn() }));

let record: ConnectionRecord;
const storeMocks = vi.hoisted(() => ({
  disconnectConnection: vi.fn(),
  getConnectionRecord: vi.fn(),
  getConnectionView: vi.fn(),
  saveConnectionRecord: vi.fn(),
  updateConnectionRecord: vi.fn(),
}));

vi.mock('./oauth-client', () => oauthMocks);
vi.mock('./gist-client', () => ({
  GistClient: class {
    getAuthenticatedUser = gistMocks.getAuthenticatedUser;
  },
}));
vi.mock('./gist-discovery', () => ({
  CANONICAL_SYNC_FILE_NAME: 'tabstow.sync.json',
  ...discoveryMocks,
}));
vi.mock('@/db/db', () => dbMocks);
vi.mock('@/features/quick-links/quick-links-storage', () => quickLinkStorageMocks);
vi.mock('./connection-store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./connection-store')>()),
  ...storeMocks,
}));

function safeView(current: ConnectionRecord) {
  return {
    phase: current.phase,
    sync: current.sync,
    ...(current.account ? { account: current.account } : {}),
    ...(current.binding ? { binding: current.binding } : {}),
    ...(current.pendingBinding ? { pendingBinding: current.pendingBinding } : {}),
    ...(current.candidates ? { candidates: current.candidates } : {}),
    ...(current.oauthAttempt
      ? {
          deviceFlow: {
            userCode: current.oauthAttempt.userCode,
            verificationUri: current.oauthAttempt.verificationUri,
            expiresAt: current.oauthAttempt.expiresAt,
            intervalSeconds: current.oauthAttempt.intervalSeconds,
          },
        }
      : {}),
  };
}

describe('connection service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-12T00:00:00.000Z'));
    record = { generation: 0, phase: 'disconnected', sync: { state: 'disconnected' } };
    storeMocks.getConnectionRecord.mockImplementation(async () => record);
    storeMocks.saveConnectionRecord.mockImplementation(async (next) => {
      record = next;
      return next;
    });
    storeMocks.updateConnectionRecord.mockImplementation(async (update) => {
      record = update(record);
      return record;
    });
    storeMocks.getConnectionView.mockImplementation(async () => safeView(record));
    dbMocks.getReplicaId.mockResolvedValue('replica-local');
    dbMocks.isSyncRepositoryPristine.mockResolvedValue(true);
    quickLinkStorageMocks.getQuickLinks.mockResolvedValue([]);
    dbMocks.getLocalSyncCounts.mockResolvedValue({
      sessionCount: 0,
      tabCount: 0,
      quickLinkCount: 0,
    });
    discoveryMocks.discoverGistCandidates.mockResolvedValue([]);
    oauthMocks.requestDeviceCode.mockResolvedValue({
      deviceCode: 'device-secret',
      userCode: 'ABCD-EFGH',
      verificationUri: 'https://github.com/login/device',
      expiresInSeconds: 900,
      intervalSeconds: 5,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('persists Device Flow progress but returns only the user-facing code', async () => {
    const { startGitHubOAuth } = await import('./connection-service');

    const started = await startGitHubOAuth('client-id');

    expect(record.oauthAttempt?.deviceCode).toBe('device-secret');
    expect(started.view.deviceFlow?.userCode).toBe('ABCD-EFGH');
    expect(JSON.stringify(started.view)).not.toContain('device-secret');
  });

  it('preserves a confirmed binding when reauthorizing the same numeric account', async () => {
    record = {
      generation: 2,
      phase: 'authorizing',
      account: { id: 1, login: 'octocat' },
      binding: {
        gistId: 'gist-1',
        fileName: 'tabstow.sync.json',
        public: false,
        htmlUrl: 'https://gist.github.com/octocat/gist-1',
        ownerId: 1,
      },
      oauthAttempt: {
        attemptId: 'attempt-1',
        deviceCode: 'device-secret',
        userCode: 'ABCD-EFGH',
        verificationUri: 'https://github.com/login/device',
        expiresAt: Date.now() + 900_000,
        intervalSeconds: 5,
        nextPollAt: Date.now(),
      },
      sync: { state: 'authorizing' },
    };
    oauthMocks.pollDeviceToken.mockResolvedValue({
      status: 'success',
      accessToken: 'oauth-token',
      scopes: ['gist'],
    });
    gistMocks.getAuthenticatedUser.mockResolvedValue({ id: 1, login: 'octocat' });
    const { pollGitHubOAuth } = await import('./connection-service');

    const completed = await pollGitHubOAuth('client-id');

    expect(completed.shouldReconcile).toBe(true);
    expect(record.phase).toBe('connected');
    expect(record.binding?.gistId).toBe('gist-1');
    expect(record.initialReconciliationPending).toBe(true);
  });

  it('auto-binds one unlisted candidate only when this device has no local data', async () => {
    record = {
      generation: 1,
      phase: 'authorizing',
      oauthAttempt: {
        attemptId: 'attempt-1',
        deviceCode: 'device-secret',
        userCode: 'ABCD-EFGH',
        verificationUri: 'https://github.com/login/device',
        expiresAt: Date.now() + 900_000,
        intervalSeconds: 5,
        nextPollAt: Date.now(),
      },
      sync: { state: 'authorizing' },
    };
    oauthMocks.pollDeviceToken.mockResolvedValue({
      status: 'success',
      accessToken: 'oauth-token',
      scopes: ['gist'],
    });
    gistMocks.getAuthenticatedUser.mockResolvedValue({ id: 2, login: 'mona' });
    discoveryMocks.discoverGistCandidates.mockResolvedValue([
      {
        gistId: 'gist-2',
        fileName: 'tabstow.sync.json',
        public: false,
        htmlUrl: 'https://gist.github.com/mona/gist-2',
        ownerId: 2,
        description: 'Tabstow',
        schemaVersion: 2,
      },
    ]);
    const { pollGitHubOAuth } = await import('./connection-service');

    const completed = await pollGitHubOAuth('client-id');

    expect(completed.shouldReconcile).toBe(true);
    expect(record.phase).toBe('connected');
    expect(record.binding?.gistId).toBe('gist-2');
    expect(record.initialReconciliationPending).toBe(true);
  });

  it('requires confirmation before local data can merge into an account Gist', async () => {
    dbMocks.getLocalSyncCounts.mockResolvedValue({
      sessionCount: 1,
      tabCount: 3,
      quickLinkCount: 2,
    });
    dbMocks.isSyncRepositoryPristine.mockResolvedValue(false);
    record = {
      generation: 1,
      phase: 'authorizing',
      oauthAttempt: {
        attemptId: 'attempt-1',
        deviceCode: 'device-secret',
        userCode: 'ABCD-EFGH',
        verificationUri: 'https://github.com/login/device',
        expiresAt: Date.now() + 900_000,
        intervalSeconds: 5,
        nextPollAt: Date.now(),
      },
      sync: { state: 'authorizing' },
    };
    oauthMocks.pollDeviceToken.mockResolvedValue({
      status: 'success',
      accessToken: 'oauth-token',
      scopes: ['gist'],
    });
    gistMocks.getAuthenticatedUser.mockResolvedValue({ id: 2, login: 'mona' });
    discoveryMocks.discoverGistCandidates.mockResolvedValue([
      {
        gistId: 'gist-2',
        fileName: 'tabstow.sync.json',
        public: false,
        htmlUrl: 'https://gist.github.com/mona/gist-2',
        ownerId: 2,
        description: 'Tabstow',
        schemaVersion: 2,
      },
    ]);
    const { pollGitHubOAuth } = await import('./connection-service');

    const completed = await pollGitHubOAuth('client-id');

    expect(completed.shouldReconcile).toBe(false);
    expect(record.phase).toBe('needs-confirmation');
    expect(record.pendingBinding?.localCounts.tabCount).toBe(3);
  });

  it('does not restore credentials when authorization finishes after cancellation', async () => {
    let resolvePoll!: (value: {
      status: 'success';
      accessToken: string;
      scopes: string[];
    }) => void;
    record = {
      generation: 3,
      phase: 'authorizing',
      oauthAttempt: {
        attemptId: 'attempt-race',
        deviceCode: 'device-secret',
        userCode: 'ABCD-EFGH',
        verificationUri: 'https://github.com/login/device',
        expiresAt: Date.now() + 900_000,
        intervalSeconds: 5,
        nextPollAt: Date.now(),
      },
      sync: { state: 'authorizing' },
    };
    oauthMocks.pollDeviceToken.mockReturnValue(
      new Promise((resolve) => {
        resolvePoll = resolve;
      }),
    );
    gistMocks.getAuthenticatedUser.mockResolvedValue({ id: 1, login: 'octocat' });
    const { cancelGitHubOAuth, pollGitHubOAuth } = await import('./connection-service');

    const polling = pollGitHubOAuth('client-id');
    await vi.waitFor(() => expect(oauthMocks.pollDeviceToken).toHaveBeenCalled());
    await cancelGitHubOAuth();
    resolvePoll({ status: 'success', accessToken: 'stale-token', scopes: ['gist'] });
    await polling;

    expect(record).toMatchObject({ generation: 4, phase: 'disconnected' });
    expect(record.token).toBeUndefined();
  });

  it('keeps the longest polling interval across concurrent slow-down responses', async () => {
    let resolveSlowDown!: (value: { status: 'slow-down' }) => void;
    let resolvePending!: (value: { status: 'pending' }) => void;
    record = {
      generation: 5,
      phase: 'authorizing',
      oauthAttempt: {
        attemptId: 'attempt-concurrent',
        deviceCode: 'device-secret',
        userCode: 'ABCD-EFGH',
        verificationUri: 'https://github.com/login/device',
        expiresAt: Date.now() + 900_000,
        intervalSeconds: 5,
        nextPollAt: Date.now(),
      },
      sync: { state: 'authorizing' },
    };
    oauthMocks.pollDeviceToken
      .mockReturnValueOnce(new Promise((resolve) => { resolveSlowDown = resolve; }))
      .mockReturnValueOnce(new Promise((resolve) => { resolvePending = resolve; }));
    const { pollGitHubOAuth } = await import('./connection-service');

    const pollStartedAt = Date.now();
    const first = pollGitHubOAuth('client-id');
    const second = pollGitHubOAuth('client-id');
    await vi.waitFor(() => expect(oauthMocks.pollDeviceToken).toHaveBeenCalledTimes(2));
    resolveSlowDown({ status: 'slow-down' });
    await first;
    resolvePending({ status: 'pending' });
    await second;

    expect(record.oauthAttempt).toMatchObject({ intervalSeconds: 10 });
    expect(record.oauthAttempt!.nextPollAt).toBeGreaterThanOrEqual(
      pollStartedAt + 10_000,
    );
  });
});
