import { storage } from '#imports';
import { isThemeBackgroundToken } from './theme-background-cache';

const THEME_KEY = 'local:tabstow-theme-preferences';
const VALID_MODES = new Set(['system', 'light', 'dark']);
const VALID_PALETTES = new Set(['paper', 'sage', 'mist', 'blush']);
const MIN_SURFACE_OPACITY = 35;
const MAX_SURFACE_OPACITY = 100;
const DEFAULT_SURFACE_OPACITY = 92;

export type ThemeMode = 'system' | 'light' | 'dark';
export type ThemePaletteId = 'paper' | 'sage' | 'mist' | 'blush';

export type ThemePreferences = {
  mode: ThemeMode;
  paletteId: ThemePaletteId;
  surfaceOpacity: number;
  customBackground: string | null;
};

function normalizeMode(value: unknown): ThemeMode {
  return typeof value === 'string' && VALID_MODES.has(value) ? (value as ThemeMode) : 'system';
}

function normalizePaletteId(value: unknown): ThemePaletteId {
  return typeof value === 'string' && VALID_PALETTES.has(value) ? (value as ThemePaletteId) : 'paper';
}

function normalizeSurfaceOpacity(value: unknown): number {
  const candidate = Number(value ?? DEFAULT_SURFACE_OPACITY);
  if (!Number.isFinite(candidate)) return DEFAULT_SURFACE_OPACITY;
  return Math.min(MAX_SURFACE_OPACITY, Math.max(MIN_SURFACE_OPACITY, candidate));
}

function normalizeCustomBackground(value: unknown): string | null {
  return isThemeBackgroundToken(value) ? value : null;
}

export function normalizeThemePreferences(input: Partial<ThemePreferences> | null | undefined): ThemePreferences {
  return {
    mode: normalizeMode(input?.mode),
    paletteId: normalizePaletteId(input?.paletteId),
    surfaceOpacity: normalizeSurfaceOpacity(input?.surfaceOpacity),
    customBackground: normalizeCustomBackground(input?.customBackground),
  };
}

export async function getThemePreferences(): Promise<ThemePreferences> {
  return normalizeThemePreferences(await storage.getItem<Partial<ThemePreferences>>(THEME_KEY));
}

export async function saveThemePreferences(
  preferences: Partial<ThemePreferences> | null | undefined,
): Promise<ThemePreferences> {
  const normalized = normalizeThemePreferences(preferences);
  await storage.setItem(THEME_KEY, normalized);
  return normalized;
}
