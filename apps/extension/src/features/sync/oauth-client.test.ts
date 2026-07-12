import { describe, expect, it, vi } from 'vitest';
import { pollDeviceToken, requestDeviceCode } from './oauth-client';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('GitHub OAuth Device Flow client', () => {
  it('starts Device Flow with only the public client id and gist scope', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      jsonResponse({
        device_code: 'device-secret',
        user_code: 'ABCD-EFGH',
        verification_uri: 'https://github.com/login/device',
        expires_in: 900,
        interval: 5,
      }),
    );

    const attempt = await requestDeviceCode('client-id', fetcher);

    expect(attempt).toMatchObject({
      deviceCode: 'device-secret',
      userCode: 'ABCD-EFGH',
      verificationUri: 'https://github.com/login/device',
      expiresInSeconds: 900,
      intervalSeconds: 5,
    });
    const body = String(fetcher.mock.calls[0]?.[1]?.body);
    expect(body).toContain('client_id=client-id');
    expect(body).toContain('scope=gist');
    expect(body).not.toContain('client_secret');
  });

  it.each([
    ['authorization_pending', 'pending'],
    ['slow_down', 'slow-down'],
    ['access_denied', 'denied'],
    ['expired_token', 'expired'],
    ['device_flow_disabled', 'disabled'],
  ] as const)('maps %s to %s', async (error, expected) => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({ error }));

    await expect(pollDeviceToken('client-id', 'device-secret', fetcher)).resolves.toEqual({
      status: expected,
    });
  });

  it('returns a successful token and granted scopes', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      jsonResponse({
        access_token: 'oauth-token',
        token_type: 'bearer',
        scope: 'gist,read:user',
      }),
    );

    await expect(
      pollDeviceToken('client-id', 'device-secret', fetcher),
    ).resolves.toEqual({
      status: 'success',
      accessToken: 'oauth-token',
      scopes: ['gist', 'read:user'],
    });
  });

  it('rejects malformed and non-success HTTP responses', async () => {
    await expect(
      requestDeviceCode('client-id', vi.fn().mockResolvedValue(jsonResponse({}, 500))),
    ).rejects.toThrow('500');
    await expect(
      requestDeviceCode('client-id', vi.fn().mockResolvedValue(jsonResponse({}))),
    ).rejects.toThrow('invalid Device Flow');
  });
});
