import { beforeEach, describe, expect, it, vi } from 'vitest';

const storageMocks = vi.hoisted(() => ({
  getItem: vi.fn(),
  setItem: vi.fn(),
}));
const cacheMocks = vi.hoisted(() => ({
  clearThemeBackgroundCache: vi.fn(),
}));

vi.mock('#imports', () => ({ storage: storageMocks }));
vi.mock('./theme-background-cache', () => cacheMocks);

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  cacheMocks.clearThemeBackgroundCache.mockResolvedValue(undefined);
});

describe('theme preferences', () => {
  it('migrates legacy personalization to its fixed dark mode', async () => {
    storageMocks.getItem.mockResolvedValue({
      mode: 'dark',
      paletteId: 'sage',
      surfaceOpacity: 84,
      customBackground: 'theme-bg:123',
    });
    const { getThemePreferences } = await import('./theme-preferences');

    await expect(getThemePreferences()).resolves.toEqual({ mode: 'dark' });
    expect(cacheMocks.clearThemeBackgroundCache).toHaveBeenCalledTimes(1);
    expect(storageMocks.setItem).toHaveBeenCalledWith(
      'local:tabstow-theme-preferences',
      { mode: 'dark' },
    );
  });

  it('keeps a current fixed mode without repeating migration', async () => {
    storageMocks.getItem.mockResolvedValue({ mode: 'light' });
    const { getThemePreferences } = await import('./theme-preferences');

    await expect(getThemePreferences()).resolves.toEqual({ mode: 'light' });
    expect(cacheMocks.clearThemeBackgroundCache).not.toHaveBeenCalled();
    expect(storageMocks.setItem).not.toHaveBeenCalled();
  });

  it('normalizes invalid and legacy system modes to light', async () => {
    const { normalizeThemePreferences } = await import('./theme-preferences');

    expect(normalizeThemePreferences({ mode: 'system' })).toEqual({ mode: 'light' });
    expect(normalizeThemePreferences({ mode: 'twilight' })).toEqual({ mode: 'light' });
  });

  it('does not erase legacy storage when cache cleanup fails', async () => {
    storageMocks.getItem.mockResolvedValue({
      mode: 'dark',
      customBackground: 'theme-bg:123',
    });
    cacheMocks.clearThemeBackgroundCache.mockRejectedValue(new Error('cache unavailable'));
    const { getThemePreferences } = await import('./theme-preferences');

    await expect(getThemePreferences()).rejects.toThrow('cache unavailable');
    expect(storageMocks.setItem).not.toHaveBeenCalled();
  });

  it('saves only the normalized fixed mode', async () => {
    const { saveThemePreferences } = await import('./theme-preferences');

    await expect(
      saveThemePreferences({
        mode: 'dark',
        paletteId: 'blush',
        surfaceOpacity: 70,
        customBackground: 'theme-bg:old',
      }),
    ).resolves.toEqual({ mode: 'dark' });
    expect(storageMocks.setItem).toHaveBeenCalledWith(
      'local:tabstow-theme-preferences',
      { mode: 'dark' },
    );
  });
});
