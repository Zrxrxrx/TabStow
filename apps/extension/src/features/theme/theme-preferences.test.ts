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

    expect(normalizeThemePreferences({ mode: 'dark', paletteId: 'sage', surfaceOpacity: 84 })).toEqual({
      mode: 'dark',
      paletteId: 'sage',
      surfaceOpacity: 84,
      customBackground: null,
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
      customBackground: 'https://example.com/background.png',
    });

    const { getThemePreferences } = await import('./theme-preferences');

    await expect(getThemePreferences()).resolves.toEqual({
      mode: 'system',
      paletteId: 'paper',
      surfaceOpacity: 35,
      customBackground: null,
    });
  });

  it('normalizes before saving and returns normalized theme preferences', async () => {
    const preferences = {
      mode: 'light',
      paletteId: 'dawn',
      surfaceOpacity: 99,
      customBackground: 'https://example.com/background.png',
    } as unknown as Parameters<typeof import('./theme-preferences').saveThemePreferences>[0];

    const { saveThemePreferences } = await import('./theme-preferences');

    await expect(saveThemePreferences(preferences)).resolves.toEqual({
      mode: 'light',
      paletteId: 'paper',
      surfaceOpacity: 99,
      customBackground: null,
    });
    expect(storageMocks.setItem).toHaveBeenCalledWith('local:tabstow-theme-preferences', {
      mode: 'light',
      paletteId: 'paper',
      surfaceOpacity: 99,
      customBackground: null,
    });
  });
});
