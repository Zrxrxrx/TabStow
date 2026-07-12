import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('theme background cache cleanup', () => {
  it('deletes the complete retired theme cache', async () => {
    const deleteCache = vi.fn().mockResolvedValue(true);
    vi.stubGlobal('caches', { delete: deleteCache });
    const { clearThemeBackgroundCache } = await import('./theme-background-cache');

    await clearThemeBackgroundCache();

    expect(deleteCache).toHaveBeenCalledWith('tabstow-theme-backgrounds');
  });

  it('is a no-op when Cache Storage is unavailable', async () => {
    vi.stubGlobal('caches', undefined);
    const { clearThemeBackgroundCache } = await import('./theme-background-cache');

    await expect(clearThemeBackgroundCache()).resolves.toBeUndefined();
  });
});
