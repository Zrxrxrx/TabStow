const THEME_BACKGROUND_CACHE = 'tabstow-theme-backgrounds';

export async function clearThemeBackgroundCache(): Promise<void> {
  if (typeof globalThis.caches === 'undefined') return;
  await caches.delete(THEME_BACKGROUND_CACHE);
}
