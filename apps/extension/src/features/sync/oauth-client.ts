type Fetcher = typeof fetch;

const DEVICE_CODE_URL = 'https://github.com/login/device/code';
const ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token';

export type DeviceCodeGrant = {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresInSeconds: number;
  intervalSeconds: number;
};

export type DeviceTokenPollResult =
  | { status: 'pending' | 'slow-down' | 'denied' | 'expired' | 'disabled' }
  | { status: 'success'; accessToken: string; scopes: string[] };

async function postForm(
  url: string,
  body: URLSearchParams,
  fetcher: Fetcher,
): Promise<unknown> {
  const response = await fetcher(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  if (!response.ok) throw new Error(`GitHub OAuth returned ${response.status}.`);
  return response.json();
}

export async function requestDeviceCode(
  clientId: string,
  fetcher: Fetcher = globalThis.fetch.bind(globalThis),
): Promise<DeviceCodeGrant> {
  const value = (await postForm(
    DEVICE_CODE_URL,
    new URLSearchParams({ client_id: clientId, scope: 'gist' }),
    fetcher,
  )) as {
    device_code?: unknown;
    user_code?: unknown;
    verification_uri?: unknown;
    expires_in?: unknown;
    interval?: unknown;
  };
  if (
    typeof value.device_code !== 'string' ||
    typeof value.user_code !== 'string' ||
    typeof value.verification_uri !== 'string' ||
    typeof value.expires_in !== 'number' ||
    typeof value.interval !== 'number'
  ) {
    throw new Error('GitHub returned an invalid Device Flow response.');
  }
  const verificationUrl = new URL(value.verification_uri);
  if (verificationUrl.protocol !== 'https:' || verificationUrl.hostname !== 'github.com') {
    throw new Error('GitHub returned an invalid Device Flow verification URL.');
  }
  return {
    deviceCode: value.device_code,
    userCode: value.user_code,
    verificationUri: verificationUrl.toString(),
    expiresInSeconds: value.expires_in,
    intervalSeconds: Math.max(1, value.interval),
  };
}

export async function pollDeviceToken(
  clientId: string,
  deviceCode: string,
  fetcher: Fetcher = globalThis.fetch.bind(globalThis),
): Promise<DeviceTokenPollResult> {
  const value = (await postForm(
    ACCESS_TOKEN_URL,
    new URLSearchParams({
      client_id: clientId,
      device_code: deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    }),
    fetcher,
  )) as {
    access_token?: unknown;
    scope?: unknown;
    error?: unknown;
  };

  if (typeof value.error === 'string') {
    const statuses: Record<
      string,
      Exclude<DeviceTokenPollResult, { status: 'success' }>['status']
    > = {
      authorization_pending: 'pending',
      slow_down: 'slow-down',
      access_denied: 'denied',
      expired_token: 'expired',
      device_flow_disabled: 'disabled',
    };
    const status = statuses[value.error];
    if (status) return { status };
    throw new Error(`GitHub OAuth returned ${value.error}.`);
  }

  if (typeof value.access_token !== 'string' || typeof value.scope !== 'string') {
    throw new Error('GitHub returned an invalid OAuth token response.');
  }
  return {
    status: 'success',
    accessToken: value.access_token,
    scopes: value.scope
      .split(',')
      .map((scope) => scope.trim())
      .filter(Boolean),
  };
}
