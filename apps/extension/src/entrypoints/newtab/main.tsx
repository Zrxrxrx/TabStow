import React from 'react';
import { createRoot } from 'react-dom/client';
import { getThemePreferences, type ThemeMode } from '@/features/theme/theme-preferences';
import { App } from './App';
import './styles.css';

async function mount() {
  let initialThemeError: string | null = null;
  let initialThemeMode: ThemeMode = 'light';

  try {
    initialThemeMode = (await getThemePreferences()).mode;
  } catch (error) {
    initialThemeError =
      error instanceof Error ? error.message : 'Could not migrate theme preferences.';
  }

  document.documentElement.dataset.themeMode = initialThemeMode;
  createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App initialThemeError={initialThemeError} initialThemeMode={initialThemeMode} />
    </React.StrictMode>,
  );
}

void mount();
