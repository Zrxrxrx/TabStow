const QUICK_LINK_ICON_CACHE = 'tabstow-quick-link-icons';
const QUICK_LINK_ICON_TOKEN_PREFIX = 'quick-link-icon:';
const QUICK_LINK_ICON_URL_PREFIX = 'https://tabstow.local/quick-link-icon/';

function isCacheStorageAvailable() {
  return typeof globalThis.caches !== 'undefined';
}

export function isQuickLinkIconToken(value: unknown): value is string {
  return (
    typeof value === 'string'
    && value.startsWith(QUICK_LINK_ICON_TOKEN_PREFIX)
    && value.length > QUICK_LINK_ICON_TOKEN_PREFIX.length
  );
}

function getCacheRequest(token: string) {
  return new Request(`${QUICK_LINK_ICON_URL_PREFIX}${encodeURIComponent(token)}`);
}

export async function saveQuickLinkIcon(file: Blob): Promise<string> {
  if (!isCacheStorageAvailable()) {
    throw new Error('Quick link icon cache is unavailable.');
  }

  const token = `${QUICK_LINK_ICON_TOKEN_PREFIX}${crypto.randomUUID()}`;
  const cache = await caches.open(QUICK_LINK_ICON_CACHE);
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

export async function resolveQuickLinkIconUrl(token: string | null | undefined): Promise<string | null> {
  if (!isQuickLinkIconToken(token) || !isCacheStorageAvailable()) return null;

  const cache = await caches.open(QUICK_LINK_ICON_CACHE);
  const response = await cache.match(getCacheRequest(token));
  if (!response) return null;

  return URL.createObjectURL(await response.blob());
}

export async function deleteQuickLinkIcon(token: string | null | undefined): Promise<void> {
  if (!isQuickLinkIconToken(token) || !isCacheStorageAvailable()) return;

  const cache = await caches.open(QUICK_LINK_ICON_CACHE);
  await cache.delete(getCacheRequest(token));
}
