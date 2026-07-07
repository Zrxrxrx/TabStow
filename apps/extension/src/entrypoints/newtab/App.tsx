import { useEffect, useMemo, useRef, useState } from 'react';
import type { TabSession } from '@tabstow/core';
import { Archive, Languages, Moon, Settings, SlidersHorizontal, Sun, X } from 'lucide-react';
import {
  getLanguagePreference,
  resolveLocale,
  saveLanguagePreference,
  t,
  type LanguagePreference,
} from '@/features/i18n/i18n';
import type { AppResult } from '@/lib/errors';
import { sendExtensionMessage, type StowResult } from '@/lib/messages';
import { ActiveWorkspace } from './components/ActiveWorkspace';
import { QuickLinks } from './components/QuickLinks';
import { SearchBox } from './components/SearchBox';
import { StowedSessions } from './components/StowedSessions';
import { ThemeControls, useThemePreferencesController } from './components/ThemeControls';
import { TodosPanel } from './components/TodosPanel';

type StatusState = {
  tone: 'info' | 'success' | 'error';
  message: string | null;
};

export function App() {
  const [sessions, setSessions] = useState<TabSession[]>([]);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusState>({ tone: 'info', message: null });
  const [activeWorkspaceRefreshKey, setActiveWorkspaceRefreshKey] = useState(0);
  const [language, setLanguage] = useState<LanguagePreference>('auto');
  const [extraOpen, setExtraOpen] = useState(false);
  const busyActionRef = useRef<string | null>(null);
  const locale = useMemo(() => resolveLocale(language, navigator.language), [language]);
  const themeControls = useThemePreferencesController();

  async function loadSessions() {
    const response = await sendExtensionMessage<AppResult<TabSession[]>>({ type: 'sessions:list' });
    if (response.ok) {
      setSessions(response.data);
      return;
    }
    if (!response.ok) {
      setStatus({ tone: 'error', message: response.error.message });
    }
  }

  useEffect(() => {
    void loadSessions();
  }, []);

  useEffect(() => {
    void getLanguagePreference().then(setLanguage);
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  useEffect(() => {
    if (!extraOpen) return;

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setExtraOpen(false);
    }

    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [extraOpen]);

  async function runAction<T>(
    actionId: string,
    action: () => Promise<AppResult<T>>,
    success: (data: T) => string,
  ) {
    if (busyActionRef.current !== null) return;
    busyActionRef.current = actionId;
    setBusyAction(actionId);
    setStatus({ tone: 'info', message: null });

    try {
      const response = await action();

      if (response.ok) {
        setStatus({ tone: 'success', message: success(response.data) });
        await loadSessions();
        setActiveWorkspaceRefreshKey((value) => value + 1);
        return;
      }

      setStatus({ tone: 'error', message: response.error.message });
    } finally {
      busyActionRef.current = null;
      setBusyAction(null);
    }
  }

  function openOptions() {
    chrome.runtime.openOptionsPage();
  }

  async function updateLanguage(nextLanguage: Exclude<LanguagePreference, 'auto'>) {
    const saved = await saveLanguagePreference(nextLanguage);
    setLanguage(saved);
  }

  async function toggleLanguage() {
    await updateLanguage(locale === 'en' ? 'zh-CN' : 'en');
  }

  async function toggleTheme() {
    const currentMode = themeControls.theme?.mode ?? 'light';
    await themeControls.updateTheme({ mode: currentMode === 'dark' ? 'light' : 'dark' });
  }

  const currentThemeMode = themeControls.theme?.mode ?? 'light';
  const currentLanguageLabel = locale === 'zh-CN' ? '简体中文' : 'English';
  const currentThemeLabel = currentThemeMode === 'dark' ? t(locale, 'dark') : t(locale, 'light');

  return (
    <>
      <main className="page-shell" data-od-id="newtab-shell">
        <header className="topbar" data-od-id="topbar">
          <div className="brand-lockup" data-od-id="brand-lockup">
            <div className="mark" aria-hidden="true">
              T
            </div>
            <div>
              <h1 id="tabstow-title" data-od-id="page-title">
                Tabstow
              </h1>
              <p className="subtle">Stow, organize, and restore your browser tabs.</p>
            </div>
          </div>

          <SearchBox
            disabled={busyAction !== null}
            locale={locale}
            onStatus={(tone, message) => setStatus({ tone, message })}
          />

          <div className="header-actions" data-od-id="topbar-actions">
            <button
              type="button"
              className="preference-switch"
              onClick={() => void toggleLanguage()}
              aria-label={t(locale, 'switchLanguage')}
            >
              <Languages size={16} aria-hidden="true" />
              <span>{currentLanguageLabel}</span>
            </button>
            <button
              type="button"
              className="preference-switch"
              onClick={() => void toggleTheme()}
              aria-label={t(locale, 'switchTheme')}
              disabled={!themeControls.theme}
            >
              {currentThemeMode === 'dark' ? (
                <Moon size={16} aria-hidden="true" />
              ) : (
                <Sun size={16} aria-hidden="true" />
              )}
              <span>{currentThemeLabel}</span>
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => setExtraOpen(true)}
              aria-expanded={extraOpen}
              aria-controls="extra-drawer"
            >
              <SlidersHorizontal size={16} aria-hidden="true" />
              Extra
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={openOptions}
              aria-label="Open settings"
            >
              <Settings size={16} aria-hidden="true" />
              Settings
            </button>
            <button
              type="button"
              className="primary-button"
              onClick={() =>
                void runAction<StowResult>(
                  'stow',
                  () =>
                    sendExtensionMessage<AppResult<StowResult>>({
                      type: 'sessions:stow-current-window',
                    }),
                  (result) => `Stowed ${result.savedTabCount} tabs and closed ${result.closedTabCount}.`,
                )
              }
              disabled={busyAction !== null}
            >
              <Archive size={16} aria-hidden="true" />
              {t(locale, 'stowCurrentWindow')}
            </button>
          </div>
        </header>

        <QuickLinks locale={locale} />

        <section className="workspace-grid" aria-label="Tab workspace" data-od-id="workspace-grid">
          <ActiveWorkspace
            busy={busyAction !== null}
            locale={locale}
            onStatus={(tone, message) => setStatus({ tone, message })}
            refreshKey={activeWorkspaceRefreshKey}
            onStowTab={(tab) => {
              const tabId = tab.id;
              if (typeof tabId !== 'number') return Promise.resolve();

              return runAction<StowResult>(
                `stow-tab-${tabId}`,
                () =>
                  sendExtensionMessage<AppResult<StowResult>>({
                    type: 'sessions:stow-tab',
                    tabId,
                  }),
                (result) =>
                  `Saved ${result.savedTabCount} tab for later and closed ${result.closedTabCount}.`,
              );
            }}
          />

          <StowedSessions
            busyAction={busyAction}
            locale={locale}
            onRunAction={runAction}
            sessions={sessions}
            status={status}
          />
        </section>
      </main>

      {extraOpen ? (
        <aside
          className="extra-drawer-backdrop is-open"
          id="extra-drawer"
          aria-hidden="false"
          onClick={(event) => {
            if (event.target === event.currentTarget) setExtraOpen(false);
          }}
        >
          <section
            className="extra-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="extra-drawer-title"
          >
            <header>
              <div>
                <h2 id="extra-drawer-title">Extra</h2>
                <p className="subtle">
                  Secondary tools stay here while the main workspace follows the v1 layout.
                </p>
              </div>
              <button
                type="button"
                className="icon-button"
                aria-label="Close extra drawer"
                onClick={() => setExtraOpen(false)}
              >
                <X size={16} aria-hidden="true" />
              </button>
            </header>
            <TodosPanel locale={locale} />
            <ThemeControls
              controls={themeControls}
              language={language}
              locale={locale}
              onLanguageChange={setLanguage}
            />
          </section>
        </aside>
      ) : null}
    </>
  );
}
