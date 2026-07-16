import { beforeEach, describe, expect, it, vi } from 'vitest';

const themeMocks = vi.hoisted(() => ({
  getThemePreferences: vi.fn(),
  watchThemePreferences: vi.fn(),
  unwatch: vi.fn(),
}));

vi.mock('./theme-preferences', () => ({
  getThemePreferences: themeMocks.getThemePreferences,
  watchThemePreferences: themeMocks.watchThemePreferences,
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  document.documentElement.removeAttribute('data-theme-mode');
  themeMocks.getThemePreferences.mockResolvedValue({ mode: 'light' });
  themeMocks.watchThemePreferences.mockReturnValue(themeMocks.unwatch);
});

describe('theme bootstrap', () => {
  it('uses visible light while loading and applies stored mode before returning', async () => {
    let resolveTheme: ((value: { mode: 'dark' }) => void) | undefined;
    themeMocks.getThemePreferences.mockReturnValue(
      new Promise<{ mode: 'dark' }>((resolve) => {
        resolveTheme = resolve;
      }),
    );
    const { bootstrapThemePreferences } = await import('./theme-bootstrap');

    const pending = bootstrapThemePreferences();

    expect(document.documentElement.dataset.themeMode).toBe('light');
    resolveTheme?.({ mode: 'dark' });
    const runtime = await pending;

    expect(runtime.initialMode).toBe('dark');
    expect(runtime.initialError).toBeNull();
    expect(document.documentElement.dataset.themeMode).toBe('dark');
    expect(themeMocks.watchThemePreferences).toHaveBeenCalledTimes(1);
  });

  it('falls back visibly to light and reports an initial read failure', async () => {
    themeMocks.getThemePreferences.mockRejectedValue(new Error('Theme storage unavailable'));
    const { bootstrapThemePreferences } = await import('./theme-bootstrap');

    const runtime = await bootstrapThemePreferences();

    expect(runtime.initialMode).toBe('light');
    expect(runtime.initialError).toBe('Theme storage unavailable');
    expect(document.documentElement.dataset.themeMode).toBe('light');
    expect(themeMocks.watchThemePreferences).toHaveBeenCalledTimes(1);
  });

  it('does not let an in-flight initial read overwrite a newer watched value', async () => {
    let resolveTheme: ((value: { mode: 'light' }) => void) | undefined;
    themeMocks.getThemePreferences.mockReturnValue(
      new Promise<{ mode: 'light' }>((resolve) => {
        resolveTheme = resolve;
      }),
    );
    const { bootstrapThemePreferences } = await import('./theme-bootstrap');

    const pending = bootstrapThemePreferences();
    const watchedListener = themeMocks.watchThemePreferences.mock.calls[0]?.[0] as
      | ((preferences: { mode: 'light' | 'dark' }) => void)
      | undefined;
    watchedListener?.({ mode: 'dark' });
    resolveTheme?.({ mode: 'light' });
    const runtime = await pending;

    expect(runtime.initialMode).toBe('dark');
    expect(document.documentElement.dataset.themeMode).toBe('dark');
  });

  it('shares one storage watcher across subscribers and disposes it once', async () => {
    themeMocks.getThemePreferences.mockResolvedValue({ mode: 'light' });
    const { bootstrapThemePreferences } = await import('./theme-bootstrap');
    const runtime = await bootstrapThemePreferences();
    const firstListener = vi.fn();
    const secondListener = vi.fn();

    const stopFirst = runtime.subscribe(firstListener);
    runtime.subscribe(secondListener);
    const watchedListener = themeMocks.watchThemePreferences.mock.calls[0]?.[0] as
      | ((preferences: { mode: 'light' | 'dark' }) => void)
      | undefined;
    watchedListener?.({ mode: 'dark' });
    stopFirst();
    watchedListener?.({ mode: 'light' });
    runtime.dispose();
    runtime.dispose();

    expect(themeMocks.watchThemePreferences).toHaveBeenCalledTimes(1);
    expect(firstListener.mock.calls).toEqual([['light'], ['dark']]);
    expect(secondListener.mock.calls).toEqual([['light'], ['dark'], ['light']]);
    expect(document.documentElement.dataset.themeMode).toBe('light');
    expect(themeMocks.unwatch).toHaveBeenCalledTimes(1);
  });

  it('replays a watch update that arrives before a page subscribes', async () => {
    const { bootstrapThemePreferences } = await import('./theme-bootstrap');
    const runtime = await bootstrapThemePreferences();
    const watchedListener = themeMocks.watchThemePreferences.mock.calls[0]?.[0] as
      | ((preferences: { mode: 'light' | 'dark' }) => void)
      | undefined;
    const lateListener = vi.fn();

    watchedListener?.({ mode: 'dark' });
    runtime.subscribe(lateListener);

    expect(document.documentElement.dataset.themeMode).toBe('dark');
    expect(lateListener).toHaveBeenCalledOnce();
    expect(lateListener).toHaveBeenCalledWith('dark');
  });
});
