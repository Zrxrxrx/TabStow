import { beforeEach, describe, expect, it, vi } from 'vitest';

const storageMocks = vi.hoisted(() => ({
  getItem: vi.fn(),
  setItem: vi.fn(),
}));

vi.mock('#imports', () => ({
  storage: storageMocks,
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});

describe('theme preferences', () => {
  it('normalizes theme preferences', async () => {
    const { normalizeThemePreferences } = await import('./theme-preferences');

    expect(
      normalizeThemePreferences({
        mode: 'dark',
        paletteId: 'sage',
        surfaceOpacity: 84,
        customBackground: 'theme-bg:123',
      }),
    ).toEqual({
      mode: 'dark',
      paletteId: 'sage',
      surfaceOpacity: 84,
      customBackground: 'theme-bg:123',
    });
  });

  it('clamps surface opacity', async () => {
    const { normalizeThemePreferences } = await import('./theme-preferences');

    expect(normalizeThemePreferences({ surfaceOpacity: 1 }).surfaceOpacity).toBe(35);
    expect(normalizeThemePreferences({ surfaceOpacity: 101 }).surfaceOpacity).toBe(100);
  });

  it('loads normalized theme preferences from storage', async () => {
    storageMocks.getItem.mockResolvedValue({
      mode: 'twilight',
      paletteId: 'dawn',
      surfaceOpacity: '12',
      customBackground: 'data:image/png;base64,abc',
    });

    const { getThemePreferences } = await import('./theme-preferences');

    await expect(getThemePreferences()).resolves.toEqual({
      mode: 'light',
      paletteId: 'paper',
      surfaceOpacity: 35,
      customBackground: null,
    });
  });

  it('normalizes legacy system theme mode to light', async () => {
    const { normalizeThemePreferences } = await import('./theme-preferences');

    expect(normalizeThemePreferences({ mode: 'system' as never }).mode).toBe('light');
  });

  it('normalizes before saving and returns normalized theme preferences', async () => {
    const preferences = {
      mode: 'light',
      paletteId: 'dawn',
      surfaceOpacity: 99,
      customBackground: 'theme-bg:wallpaper-1',
    } as unknown as Parameters<typeof import('./theme-preferences').saveThemePreferences>[0];

    const { saveThemePreferences } = await import('./theme-preferences');

    await expect(saveThemePreferences(preferences)).resolves.toEqual({
      mode: 'light',
      paletteId: 'paper',
      surfaceOpacity: 99,
      customBackground: 'theme-bg:wallpaper-1',
    });
    expect(storageMocks.setItem).toHaveBeenCalledWith('local:tabstow-theme-preferences', {
      mode: 'light',
      paletteId: 'paper',
      surfaceOpacity: 99,
      customBackground: 'theme-bg:wallpaper-1',
    });
  });

  it('rejects persisted raw data urls for custom backgrounds', async () => {
    const { normalizeThemePreferences } = await import('./theme-preferences');

    expect(
      normalizeThemePreferences({
        customBackground: 'data:image/png;base64,abc',
      }),
    ).toEqual({
      mode: 'light',
      paletteId: 'paper',
      surfaceOpacity: 92,
      customBackground: null,
    });
  });
});
