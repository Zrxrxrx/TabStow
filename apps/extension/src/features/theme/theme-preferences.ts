import { storage } from '#imports';
import { clearThemeBackgroundCache } from './theme-background-cache';

const THEME_KEY = 'local:tabstow-theme-preferences';

export type ThemeMode = 'light' | 'dark';

export type ThemePreferences = {
  mode: ThemeMode;
};

function normalizeMode(value: unknown): ThemeMode {
  return value === 'dark' ? 'dark' : 'light';
}

function isCurrentThemePreferences(value: unknown): value is ThemePreferences {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return Object.keys(record).length === 1 && (record.mode === 'light' || record.mode === 'dark');
}

export function normalizeThemePreferences(input: unknown): ThemePreferences {
  const mode =
    input && typeof input === 'object'
      ? normalizeMode((input as { mode?: unknown }).mode)
      : 'light';
  return { mode };
}

export async function getThemePreferences(): Promise<ThemePreferences> {
  const stored = await storage.getItem<unknown>(THEME_KEY);
  const normalized = normalizeThemePreferences(stored);
  if (isCurrentThemePreferences(stored)) return normalized;

  await clearThemeBackgroundCache();
  await storage.setItem(THEME_KEY, normalized);
  return normalized;
}

export async function saveThemePreferences(preferences: unknown): Promise<ThemePreferences> {
  const normalized = normalizeThemePreferences(preferences);
  await storage.setItem(THEME_KEY, normalized);
  return normalized;
}
