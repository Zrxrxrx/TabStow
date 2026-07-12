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
import {
  getThemePreferences,
  saveThemePreferences,
  type ThemeMode,
} from '@/features/theme/theme-preferences';
import type { AppResult } from '@/lib/errors';
import { sendExtensionMessage, type StowResult } from '@/lib/messages';
import type { ConnectionView, SyncStatusView } from '@/features/sync/sync-types';
import { ActiveWorkspace } from './components/ActiveWorkspace';
import { QuickLinks } from './components/QuickLinks';
import { SearchBox } from './components/SearchBox';
import { NewTabFeedback } from './components/NewTabFeedback';
import { NewTabSyncStatus } from './components/NewTabSyncStatus';
import { StowedSessions } from './components/StowedSessions';
import { TodosPanel } from './components/TodosPanel';
import { WorkspaceSearch } from './components/WorkspaceSearch';

type StatusState = {
  tone: 'info' | 'success' | 'error';
  message: string | null;
};

const DISCONNECTED_SYNC: ConnectionView = {
  phase: 'disconnected',
  sync: { state: 'disconnected' },
};

type AppProps = {
  initialThemeError?: string | null;
  initialThemeMode?: ThemeMode;
};

export function App({ initialThemeError = null, initialThemeMode }: AppProps = {}) {
  const [sessions, setSessions] = useState<TabSession[]>([]);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusState>(
    initialThemeError
      ? { tone: 'error', message: initialThemeError }
      : { tone: 'info', message: null },
  );
  const [activeWorkspaceRefreshKey, setActiveWorkspaceRefreshKey] = useState(0);
  const [quickLinksRefreshKey, setQuickLinksRefreshKey] = useState(0);
  const [connection, setConnection] = useState<ConnectionView>(DISCONNECTED_SYNC);
  const [language, setLanguage] = useState<LanguagePreference>('auto');
  const [themeMode, setThemeMode] = useState<ThemeMode>(initialThemeMode ?? 'light');
  const [extraOpen, setExtraOpen] = useState(false);
  const [tabQuery, setTabQuery] = useState('');
  const busyActionRef = useRef<string | null>(null);
  const locale = useMemo(() => resolveLocale(language, navigator.language), [language]);

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
    void observeSync('open');
  }, []);

  async function observeSync(reason: 'open' | 'focus') {
    try {
      const response = await sendExtensionMessage<AppResult<ConnectionView>>({
        type: 'sync:observe',
        reason,
      });
      if (response.ok) setConnection(response.data);
    } catch {
      // Local features remain available when the background worker is restarting.
    }
  }

  useEffect(() => {
    function handleFocus() {
      void observeSync('focus');
    }

    function handleVisibility() {
      if (document.visibilityState === 'visible') void observeSync('focus');
    }

    function handleRuntimeMessage(message: unknown) {
      if (!message || typeof message !== 'object' || !('type' in message)) return;
      const event = message as { type?: unknown; status?: SyncStatusView };
      if (event.type === 'sync:data-changed') {
        void loadSessions();
        setQuickLinksRefreshKey((value) => value + 1);
      } else if (event.type === 'sync:status-changed' && event.status) {
        setConnection((current) => ({ ...current, sync: event.status! }));
      } else if (event.type === 'connection:state-changed') {
        void observeSync('focus');
      }
    }

    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibility);
    chrome.runtime.onMessage?.addListener(handleRuntimeMessage);
    return () => {
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibility);
      chrome.runtime.onMessage?.removeListener(handleRuntimeMessage);
    };
  }, []);

  useEffect(() => {
    void getLanguagePreference().then(setLanguage);
  }, []);

  useEffect(() => {
    if (initialThemeMode) return;
    void getThemePreferences().then(
      (theme) => setThemeMode(theme.mode),
      (error) =>
        setStatus({
          tone: 'error',
          message: error instanceof Error ? error.message : 'Could not load theme preferences.',
        }),
    );
  }, [initialThemeMode]);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  useEffect(() => {
    document.documentElement.dataset.themeMode = themeMode;
  }, [themeMode]);

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
    options: { reloadOnFailure?: boolean } = {},
  ) {
    if (busyActionRef.current !== null) return;
    busyActionRef.current = actionId;
    setBusyAction(actionId);
    setStatus({ tone: 'info', message: null });
    let reloadSessions = options.reloadOnFailure ?? false;
    let refreshActiveWorkspace = false;

    try {
      const response = await action();

      if (response.ok) {
        setStatus({ tone: 'success', message: success(response.data) });
        reloadSessions = true;
        refreshActiveWorkspace = true;
      } else {
        setStatus({ tone: 'error', message: response.error.message });
      }
    } finally {
      try {
        if (reloadSessions) await loadSessions();
        if (refreshActiveWorkspace) {
          setActiveWorkspaceRefreshKey((value) => value + 1);
        }
      } finally {
        busyActionRef.current = null;
        setBusyAction(null);
      }
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
    const saved = await saveThemePreferences({ mode: themeMode === 'dark' ? 'light' : 'dark' });
    setThemeMode(saved.mode);
  }

  const currentThemeMode = themeMode;
  const currentLanguageLabel = locale === 'zh-CN' ? '简体中文' : 'English';
  const currentThemeLabel = currentThemeMode === 'dark' ? t(locale, 'dark') : t(locale, 'light');

  return (
    <>
      <main className="newtab-shell" data-od-id="newtab-shell">
        <aside className="quick-links-rail" aria-label={t(locale, 'quickLinks')}>
          <div className="rail-brand brand-lockup" data-od-id="brand-lockup">
            <div className="mark" aria-hidden="true">TS</div>
            <div>
              <h1 id="tabstow-title" data-od-id="page-title">Tabstow</h1>
              <p>{t(locale, 'tabstowSubtitle')}</p>
            </div>
          </div>
          <div className="rail-links-scroll">
            <QuickLinks
              disabled={busyAction !== null}
              locale={locale}
              refreshKey={quickLinksRefreshKey}
            />
          </div>
          <div className="rail-utilities">
            <button
              type="button"
              className="rail-utility-button"
              onClick={() => setExtraOpen(true)}
              aria-expanded={extraOpen}
              aria-controls="extra-drawer"
            >
              <SlidersHorizontal size={16} aria-hidden="true" />
              <span>{t(locale, 'extra')}</span>
            </button>
            <button
              type="button"
              className="rail-utility-button"
              onClick={openOptions}
              aria-label={t(locale, 'openSettings')}
            >
              <Settings size={16} aria-hidden="true" />
              <span>{t(locale, 'settings')}</span>
            </button>
          </div>
        </aside>

        <section className="newtab-stage">
          <header className="top-strip" data-od-id="top-strip">
            <SearchBox
              disabled={busyAction !== null}
              locale={locale}
              onStatus={(tone, message) => setStatus({ tone, message })}
            />
            <div className="top-strip-controls" data-od-id="topbar-actions">
            <button
              type="button"
              className="preference-switch top-strip-control"
              onClick={() => void toggleLanguage()}
              aria-label={t(locale, 'switchLanguage')}
            >
              <Languages size={16} aria-hidden="true" />
              <span>{currentLanguageLabel}</span>
            </button>
            <button
              type="button"
              className="preference-switch top-strip-control"
              onClick={() => void toggleTheme()}
              aria-label={t(locale, 'switchTheme')}
            >
              {currentThemeMode === 'dark' ? (
                <Moon size={16} aria-hidden="true" />
              ) : (
                <Sun size={16} aria-hidden="true" />
              )}
              <span>{currentThemeLabel}</span>
            </button>
            <NewTabSyncStatus
              connection={connection}
              locale={locale}
              onOpenSettings={openOptions}
            />
            <button
              type="button"
              className="primary-button stow-current-button"
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

          <NewTabFeedback message={status.message} tone={status.tone} />

          <section className="workspace-container v2-workspace" aria-label="Tab workspace">
            <WorkspaceSearch locale={locale} value={tabQuery} onChange={setTabQuery} />
            <div className="v2-workspace-columns" data-od-id="workspace-grid">
              <div className="active-region">
                <ActiveWorkspace
                  busy={busyAction !== null}
                  locale={locale}
                  onStatus={(tone, message) => setStatus({ tone, message })}
                  query={tabQuery}
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
              </div>
              <div className="saved-region">
                <StowedSessions
                  busyAction={busyAction}
                  locale={locale}
                  onRunAction={runAction}
                  query={tabQuery}
                  sessions={sessions}
                />
              </div>
            </div>
          </section>
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
                <h2 id="extra-drawer-title">{t(locale, 'extra')}</h2>
                <p className="subtle">{t(locale, 'extraDescription')}</p>
              </div>
              <button
                type="button"
                className="icon-button"
                aria-label={t(locale, 'closeExtra')}
                onClick={() => setExtraOpen(false)}
              >
                <X size={16} aria-hidden="true" />
              </button>
            </header>
            <TodosPanel locale={locale} />
          </section>
        </aside>
      ) : null}
    </>
  );
}
