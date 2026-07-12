import { beforeEach, describe, expect, it, vi } from 'vitest';

const storageMocks = vi.hoisted(() => ({
  getItem: vi.fn(),
  setItem: vi.fn(),
}));

vi.mock('#imports', () => ({ storage: storageMocks }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  storageMocks.getItem.mockResolvedValue(undefined);
});

describe('connection store', () => {
  it('defaults to a disconnected safe view', async () => {
    const { getConnectionView } = await import('./connection-store');

    await expect(getConnectionView()).resolves.toMatchObject({
      phase: 'disconnected',
      sync: { state: 'disconnected' },
    });
  });

  it('never exposes the access token or device code in a connection view', async () => {
    storageMocks.getItem.mockResolvedValue({
      generation: 2,
      phase: 'authorizing',
      token: 'oauth-secret',
      oauthAttempt: {
        attemptId: 'attempt-1',
        deviceCode: 'device-secret',
        userCode: 'ABCD-EFGH',
        verificationUri: 'https://github.com/login/device',
        expiresAt: 1_800_000,
        intervalSeconds: 5,
        nextPollAt: 1_000,
      },
      sync: { state: 'authorizing' },
    });
    const { getConnectionView } = await import('./connection-store');

    const view = await getConnectionView();
    const serialized = JSON.stringify(view);

    expect(view.deviceFlow).toMatchObject({ userCode: 'ABCD-EFGH' });
    expect(serialized).not.toContain('oauth-secret');
    expect(serialized).not.toContain('device-secret');
    expect(serialized).not.toContain('deviceCode');
  });

  it('increments the generation and removes credentials on disconnect', async () => {
    storageMocks.getItem.mockResolvedValue({
      generation: 4,
      phase: 'connected',
      token: 'oauth-secret',
      account: { id: 1, login: 'octocat' },
      binding: {
        gistId: 'gist-1',
        fileName: 'tabstow.sync.json',
        public: false,
        htmlUrl: 'https://gist.github.com/octocat/gist-1',
        ownerId: 1,
      },
      sync: { state: 'synced' },
    });
    const { disconnectConnection } = await import('./connection-store');

    await disconnectConnection();

    expect(storageMocks.setItem).toHaveBeenCalledWith(
      'local:tabstow-github-connection-v2',
      expect.objectContaining({ generation: 5, phase: 'disconnected' }),
    );
    expect(JSON.stringify(storageMocks.setItem.mock.calls[0]?.[1])).not.toContain(
      'oauth-secret',
    );
  });
});
