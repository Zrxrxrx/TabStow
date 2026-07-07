import { useEffect, useRef, useState } from 'react';
import {
  saveLanguagePreference,
  t,
  type LanguagePreference,
  type Locale,
} from '@/features/i18n/i18n';
import {
  getThemePreferences,
  saveThemePreferences,
  type ThemeMode,
  type ThemePaletteId,
  type ThemePreferences,
} from '@/features/theme/theme-preferences';
import {
  deleteCustomBackground,
  resolveCustomBackgroundUrl,
  saveCustomBackgroundFile,
} from '@/features/theme/theme-background-cache';

const MAX_CUSTOM_BACKGROUND_BYTES = 128 * 1024;

function applyTheme(theme: ThemePreferences, backgroundUrl: string | null) {
  document.documentElement.dataset.themeMode = theme.mode;
  document.documentElement.dataset.themePalette = theme.paletteId;
  document.documentElement.style.setProperty('--surface-opacity', `${theme.surfaceOpacity / 100}`);
  document.documentElement.style.setProperty(
    '--dashboard-background-image',
    backgroundUrl ? `url("${backgroundUrl}")` : 'none',
  );
}

type Props = {
  controls: ReturnType<typeof useThemePreferencesController>;
  language: LanguagePreference;
  locale: Locale;
  onLanguageChange: (language: LanguagePreference) => void;
};

export function useThemePreferencesController() {
  const [theme, setTheme] = useState<ThemePreferences | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const backgroundUrlRef = useRef<string | null>(null);

  function replaceBackgroundUrl(nextUrl: string | null) {
    if (backgroundUrlRef.current && backgroundUrlRef.current.startsWith('blob:')) {
      URL.revokeObjectURL(backgroundUrlRef.current);
    }
    backgroundUrlRef.current = nextUrl;
  }

  async function getResolvedBackgroundUrl(token: string | null | undefined) {
    try {
      return await resolveCustomBackgroundUrl(token);
    } catch {
      return null;
    }
  }

  useEffect(() => {
    void getThemePreferences().then(
      async (themePreferences) => {
        const backgroundUrl = await getResolvedBackgroundUrl(themePreferences.customBackground);
        replaceBackgroundUrl(backgroundUrl);
        setTheme(themePreferences);
        applyTheme(themePreferences, backgroundUrl);
      },
    );
    return () => {
      replaceBackgroundUrl(null);
    };
  }, []);

  async function updateTheme(partial: Partial<ThemePreferences>, resolvedBackgroundUrl?: string | null) {
    const previousToken = theme?.customBackground ?? null;
    const next = await saveThemePreferences({ ...(theme ?? {}), ...partial });
    const backgroundUrl =
      resolvedBackgroundUrl !== undefined
        ? resolvedBackgroundUrl
        : next.customBackground === previousToken
          ? backgroundUrlRef.current
          : await getResolvedBackgroundUrl(next.customBackground);

    replaceBackgroundUrl(backgroundUrl ?? null);
    setTheme(next);
    applyTheme(next, backgroundUrl ?? null);
    if (previousToken && previousToken !== next.customBackground) {
      void deleteCustomBackground(previousToken).catch(() => undefined);
    }
    setErrorMessage(null);
  }

  async function updateBackground(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_CUSTOM_BACKGROUND_BYTES) {
      setErrorMessage('Custom background image is too large to save.');
      return;
    }

    let token: string | null = null;
    let backgroundUrl: string | null = null;

    try {
      token = await saveCustomBackgroundFile(file);
      backgroundUrl = await getResolvedBackgroundUrl(token);
      await updateTheme({ customBackground: token }, backgroundUrl);
    } catch (error) {
      await deleteCustomBackground(token);
      if (backgroundUrl && backgroundUrl.startsWith('blob:')) URL.revokeObjectURL(backgroundUrl);
      setErrorMessage(error instanceof Error ? error.message : 'Could not save background image.');
    }
  }

  return {
    errorMessage,
    theme,
    updateBackground,
    updateTheme,
  };
}

export function ThemeControls({ controls, language, locale, onLanguageChange }: Props) {
  const { errorMessage, theme, updateBackground, updateTheme } = controls;

  async function updateLanguage(nextLanguage: LanguagePreference) {
    const saved = await saveLanguagePreference(nextLanguage);
    onLanguageChange(saved);
  }

  if (!theme) return null;

  return (
    <section className="utility-panel" aria-labelledby="appearance-title">
      <header>
        <h2 id="appearance-title">{t(locale, 'appearance')}</h2>
      </header>

      <div className="compact-controls">
        <label className="utility-field">
          <span>{t(locale, 'themeMode')}</span>
          <select
            aria-label={t(locale, 'themeMode')}
            value={theme.mode}
            onChange={(event) => void updateTheme({ mode: event.target.value as ThemeMode })}
          >
            <option value="system">{t(locale, 'system')}</option>
            <option value="light">{t(locale, 'light')}</option>
            <option value="dark">{t(locale, 'dark')}</option>
          </select>
        </label>

        <label className="utility-field">
          <span>{t(locale, 'palette')}</span>
          <select
            aria-label={t(locale, 'palette')}
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
          <span>{t(locale, 'surfaceTransparency')}</span>
          <input
            aria-label={t(locale, 'surfaceTransparency')}
            max={100}
            min={35}
            onChange={(event) => void updateTheme({ surfaceOpacity: Number(event.target.value) })}
            type="range"
            value={theme.surfaceOpacity}
          />
        </label>

        <label className="utility-field">
          <span>{t(locale, 'language')}</span>
          <select
            aria-label={t(locale, 'language')}
            value={language}
            onChange={(event) => void updateLanguage(event.target.value as LanguagePreference)}
          >
            <option value="auto">{t(locale, 'auto')}</option>
            <option value="en">English</option>
            <option value="zh-CN">Simplified Chinese</option>
          </select>
        </label>

        <label className="utility-field">
          <span>{t(locale, 'customBackground')}</span>
          <input
            accept="image/*"
            aria-label={t(locale, 'customBackground')}
            onChange={(event) => void updateBackground(event.target.files?.[0])}
            type="file"
          />
        </label>
      </div>

      {errorMessage ? (
        <p className="status-message status-message--error utility-status" role="alert">
          {errorMessage}
        </p>
      ) : null}
    </section>
  );
}
