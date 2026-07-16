import {
  getThemePreferences,
  watchThemePreferences,
  type ThemeMode,
} from './theme-preferences';

type ThemeListener = (mode: ThemeMode) => void;

export type ThemeRuntime = {
  initialError: string | null;
  initialMode: ThemeMode;
  subscribe: (listener: ThemeListener) => () => void;
  dispose: () => void;
};

function applyThemeMode(mode: ThemeMode): void {
  document.documentElement.dataset.themeMode = mode;
}

export async function bootstrapThemePreferences(): Promise<ThemeRuntime> {
  let currentMode: ThemeMode = 'light';
  let initialError: string | null = null;
  const listeners = new Set<ThemeListener>();
  let watchGeneration = 0;

  applyThemeMode(currentMode);

  /*
   * storage.watch ──> normalize/apply/notify
   *        │
   * initial get ──(unless a newer watch wins)──> apply before render
   *        └── pagehide dispose ──> exact per-key unwatch
   */
  const unwatch = watchThemePreferences((preferences) => {
    watchGeneration += 1;
    currentMode = preferences.mode;
    applyThemeMode(currentMode);
    for (const listener of listeners) listener(currentMode);
  });
  const generationAtReadStart = watchGeneration;

  try {
    const loadedMode = (await getThemePreferences()).mode;
    if (watchGeneration === generationAtReadStart) currentMode = loadedMode;
  } catch (error) {
    initialError =
      error instanceof Error ? error.message : 'Could not load theme preferences.';
  }

  applyThemeMode(currentMode);
  let disposed = false;

  return {
    initialError,
    initialMode: currentMode,
    subscribe(listener) {
      listeners.add(listener);
      listener(currentMode);
      return () => listeners.delete(listener);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      listeners.clear();
      unwatch();
    },
  };
}
