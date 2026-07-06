import { describe, expect, it } from 'vitest';
import { normalizeThemePreferences } from './theme-preferences';

describe('theme preferences', () => {
  it('normalizes theme preferences', () => {
    expect(normalizeThemePreferences({ mode: 'dark', paletteId: 'sage', surfaceOpacity: 84 })).toEqual({
      mode: 'dark',
      paletteId: 'sage',
      surfaceOpacity: 84,
      customBackground: null,
    });
  });

  it('clamps surface opacity', () => {
    expect(normalizeThemePreferences({ surfaceOpacity: 1 }).surfaceOpacity).toBe(35);
    expect(normalizeThemePreferences({ surfaceOpacity: 101 }).surfaceOpacity).toBe(100);
  });
});
