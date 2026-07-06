const THEME_BACKGROUND_CACHE = 'tabstow-theme-backgrounds';
const THEME_BACKGROUND_TOKEN_PREFIX = 'theme-bg:';
const THEME_BACKGROUND_URL_PREFIX = 'https://tabstow.local/theme-background/';

function isCacheStorageAvailable() {
  return typeof globalThis.caches !== 'undefined';
}

export function isThemeBackgroundToken(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(THEME_BACKGROUND_TOKEN_PREFIX) && value.length > THEME_BACKGROUND_TOKEN_PREFIX.length;
}

function getCacheRequest(token: string) {
  return new Request(`${THEME_BACKGROUND_URL_PREFIX}${encodeURIComponent(token)}`);
}

export async function saveCustomBackgroundFile(file: Blob): Promise<string> {
  if (!isCacheStorageAvailable()) {
    throw new Error('Custom background cache is unavailable.');
  }

  const token = `${THEME_BACKGROUND_TOKEN_PREFIX}${crypto.randomUUID()}`;
  const cache = await caches.open(THEME_BACKGROUND_CACHE);
  await cache.put(
    getCacheRequest(token),
    new Response(file, {
      headers: {
        'content-type': file.type || 'application/octet-stream',
      },
    }),
  );
  return token;
}

export async function resolveCustomBackgroundUrl(token: string | null | undefined): Promise<string | null> {
  if (!isThemeBackgroundToken(token) || !isCacheStorageAvailable()) return null;

  const cache = await caches.open(THEME_BACKGROUND_CACHE);
  const response = await cache.match(getCacheRequest(token));
  if (!response) return null;

  const blob = await response.blob();
  return URL.createObjectURL(blob);
}

export async function deleteCustomBackground(token: string | null | undefined): Promise<void> {
  if (!isThemeBackgroundToken(token) || !isCacheStorageAvailable()) return;

  const cache = await caches.open(THEME_BACKGROUND_CACHE);
  await cache.delete(getCacheRequest(token));
}
