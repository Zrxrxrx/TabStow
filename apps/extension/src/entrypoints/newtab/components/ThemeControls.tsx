import { useEffect, useState } from 'react';
import {
  getLanguagePreference,
  resolveLocale,
  saveLanguagePreference,
  type LanguagePreference,
} from '@/features/i18n/i18n';
import {
  getThemePreferences,
  saveThemePreferences,
  type ThemeMode,
  type ThemePaletteId,
  type ThemePreferences,
} from '@/features/theme/theme-preferences';

function applyTheme(theme: ThemePreferences) {
  document.documentElement.dataset.themeMode = theme.mode;
  document.documentElement.dataset.themePalette = theme.paletteId;
  document.documentElement.style.setProperty('--surface-opacity', `${theme.surfaceOpacity / 100}`);
  document.documentElement.style.setProperty(
    '--dashboard-background-image',
    theme.customBackground ? `url("${theme.customBackground}")` : 'none',
  );
}

export function ThemeControls() {
  const [language, setLanguage] = useState<LanguagePreference>('auto');
  const [theme, setTheme] = useState<ThemePreferences | null>(null);

  useEffect(() => {
    void Promise.all([getThemePreferences(), getLanguagePreference()]).then(
      ([themePreferences, languagePreference]) => {
        setTheme(themePreferences);
        setLanguage(languagePreference);
        applyTheme(themePreferences);
        document.documentElement.lang = resolveLocale(languagePreference, navigator.language);
      },
    );
  }, []);

  async function updateTheme(partial: Partial<ThemePreferences>) {
    const next = await saveThemePreferences({ ...(theme ?? {}), ...partial });
    setTheme(next);
    applyTheme(next);
  }

  async function updateLanguage(nextLanguage: LanguagePreference) {
    const saved = await saveLanguagePreference(nextLanguage);
    setLanguage(saved);
    document.documentElement.lang = resolveLocale(saved, navigator.language);
  }

  async function updateBackground(file: File | undefined) {
    if (!file) return;

    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener('load', () => resolve(String(reader.result ?? '')));
      reader.addEventListener('error', () => reject(new Error('Could not read background image.')));
      reader.readAsDataURL(file);
    });

    await updateTheme({ customBackground: dataUrl });
  }

  if (!theme) return null;

  return (
    <section className="utility-panel" aria-labelledby="appearance-title">
      <header>
        <h2 id="appearance-title">Appearance</h2>
      </header>

      <div className="compact-controls">
        <label className="utility-field">
          <span>Theme mode</span>
          <select
            aria-label="Theme mode"
            value={theme.mode}
            onChange={(event) => void updateTheme({ mode: event.target.value as ThemeMode })}
          >
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>

        <label className="utility-field">
          <span>Palette</span>
          <select
            aria-label="Palette"
            value={theme.paletteId}
            onChange={(event) => void updateTheme({ paletteId: event.target.value as ThemePaletteId })}
          >
            <option value="paper">Paper</option>
            <option value="sage">Sage</option>
            <option value="mist">Mist</option>
            <option value="blush">Blush</option>
          </select>
        </label>

        <label className="utility-field">
          <span>Surface transparency</span>
          <input
            aria-label="Surface transparency"
            max={100}
            min={35}
            onChange={(event) => void updateTheme({ surfaceOpacity: Number(event.target.value) })}
            type="range"
            value={theme.surfaceOpacity}
          />
        </label>

        <label className="utility-field">
          <span>Language</span>
          <select
            aria-label="Language"
            value={language}
            onChange={(event) => void updateLanguage(event.target.value as LanguagePreference)}
          >
            <option value="auto">Auto</option>
            <option value="en">English</option>
            <option value="zh-CN">Simplified Chinese</option>
          </select>
        </label>

        <label className="utility-field">
          <span>Custom background</span>
          <input
            accept="image/*"
            aria-label="Custom background"
            onChange={(event) => void updateBackground(event.target.files?.[0])}
            type="file"
          />
        </label>
      </div>
    </section>
  );
}
