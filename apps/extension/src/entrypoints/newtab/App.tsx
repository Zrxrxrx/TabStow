import { useEffect, useMemo, useRef, useState } from 'react';
import type { TabSession } from '@tabstow/core';
import { Languages, Moon, Settings, SlidersHorizontal, Sun } from 'lucide-react';
import type { ActiveTabsSnapshot } from '@/features/active-tabs/types';
import { RecoveryBinDialog } from '@/features/saved-for-later/RecoveryBinDialog';
import { SavedForLaterView } from '@/features/saved-for-later/SavedForLaterView';
import {
  getLanguagePreference,
  resolveLocale,
  saveLanguagePreference,
  t,
  type LanguagePreference,
} from '@/features/i18n/i18n';
import {
  saveThemePreferences,
  type ThemeMode,
} from '@/features/theme/theme-preferences';
import type { AppResult } from '@/lib/errors';
import { sendExtensionMessage, type StowResult } from '@/lib/messages';
import type { ConnectionView, SyncStatusView } from '@/features/sync/sync-types';
import { ModalDialog } from '@/components/ModalDialog';
import {
  acknowledgeIncident,
  clearAcknowledgement,
  derivePausedIncidentKey,
  getAcknowledgedIncidentKey,
} from '@/features/sync/sync-incident-acknowledgement';
import { ActiveWorkspace } from './components/ActiveWorkspace';
import { QuickLinks } from './components/QuickLinks';
import { NewTabFeedback } from './components/NewTabFeedback';
import { NewTabSyncStatus } from './components/NewTabSyncStatus';
import { StowCurrentWindowButton } from './components/StowCurrentWindowButton';
import { SyncStatusDialog } from './components/SyncStatusDialog';
import { TodosPanel } from './components/TodosPanel';
import { UnifiedSearch } from './components/UnifiedSearch';

type StatusState = {
  tone: 'info' | 'success' | 'error';
  message: string | null;
};

const DISCONNECTED_SYNC: ConnectionView = {
  phase: 'disconnected',
  sync: { state: 'disconnected' },
};

const EMPTY_ACTIVE_SNAPSHOT: ActiveTabsSnapshot = { windows: [], tabs: [], chromeGroups: [] };

export type AppProps = {
  initialThemeError?: string | null;
  initialThemeMode?: ThemeMode;
  subscribeToThemeChanges?: (
    listener: (mode: ThemeMode) => void,
  ) => () => void;
};

export function App({
  initialThemeError = null,
  initialThemeMode = 'light',
  subscribeToThemeChanges,
}: AppProps = {}) {
  const [sessions, setSessions] = useState<TabSession[]>([]);
  const [activeSnapshot, setActiveSnapshot] = useState<ActiveTabsSnapshot>(EMPTY_ACTIVE_SNAPSHOT);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusState>(
    initialThemeError
      ? { tone: 'error', message: initialThemeError }
      : { tone: 'info', message: null },
  );
  const [activeWorkspaceRefreshKey, setActiveWorkspaceRefreshKey] = useState(0);
  const [stowPreviewRefreshKey, setStowPreviewRefreshKey] = useState(0);
  const [suggestionRefreshKey, setSuggestionRefreshKey] = useState(0);
  const [quickLinksRefreshKey, setQuickLinksRefreshKey] = useState(0);
  const [connection, setConnection] = useState<ConnectionView>(DISCONNECTED_SYNC);
  const [language, setLanguage] = useState<LanguagePreference>('auto');
  const [themeMode, setThemeMode] = useState<ThemeMode>(initialThemeMode);
  const [duplicateTabstowCount, setDuplicateTabstowCount] = useState(0);
  const [duplicateTabstowClosePending, setDuplicateTabstowClosePending] = useState(false);
  const [extraOpen, setExtraOpen] = useState(false);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [syncDetailsOpen, setSyncDetailsOpen] = useState(false);
  const [tabQuery, setTabQuery] = useState('');
  const busyActionRef = useRef<string | null>(null);
  const incidentAckWriteRef = useRef<Promise<void>>(Promise.resolve());
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

  useEffect(() => {
    let active = true;

    void sendExtensionMessage<AppResult<{ duplicateCount: number }>>({
      type: 'newtab:get-duplicate-state',
    }).then(
      (response) => {
        if (active && response.ok && response.data.duplicateCount > 0) {
          setDuplicateTabstowCount(response.data.duplicateCount);
        }
      },
      () => undefined,
    );

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    const incidentKey = derivePausedIncidentKey(connection);
    if (incidentKey) {
      void getAcknowledgedIncidentKey().then((acknowledgedKey) => {
        if (active && acknowledgedKey !== incidentKey) setSyncDetailsOpen(true);
      });
    } else if (
      connection.phase === 'connected' &&
      ['synced', 'pending', 'syncing', 'retrying'].includes(connection.sync.state)
    ) {
      incidentAckWriteRef.current = incidentAckWriteRef.current.then(clearAcknowledgement, clearAcknowledgement);
    }
    return () => { active = false; };
  }, [connection]);

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
      setStowPreviewRefreshKey((value) => value + 1);
      setSuggestionRefreshKey((value) => value + 1);
    }

    function handleVisibility() {
      if (document.visibilityState === 'visible') {
        void observeSync('focus');
        setSuggestionRefreshKey((value) => value + 1);
      }
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
    return subscribeToThemeChanges?.(setThemeMode);
  }, [subscribeToThemeChanges]);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

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

  async function closeOtherTabstowPages() {
    setDuplicateTabstowClosePending(true);
    try {
      const response = await sendExtensionMessage<AppResult<{ closedTabCount: number }>>({
        type: 'newtab:close-duplicates',
      });
      if (response.ok) {
        setDuplicateTabstowCount(0);
      } else {
        setStatus({ tone: 'error', message: response.error.message });
      }
    } finally {
      setDuplicateTabstowClosePending(false);
    }
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
        <section className="newtab-stage">
          <header className="top-strip" data-od-id="top-strip">
            <UnifiedSearch
              activeSnapshot={activeSnapshot}
              disabled={busyAction !== null}
              locale={locale}
              onChange={setTabQuery}
              onSavedOpened={loadSessions}
              onStatus={(tone, message) => setStatus({ tone, message })}
              sessions={sessions}
              value={tabQuery}
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
              onOpenDetails={() => setSyncDetailsOpen(true)}
            />
            <StowCurrentWindowButton
              busy={busyAction === 'stow'}
              disabled={busyAction !== null}
              locale={locale}
              onStatus={(tone, message) => setStatus({ tone, message })}
              onStow={() =>
                runAction<StowResult>(
                  'stow',
                  () =>
                    sendExtensionMessage<AppResult<StowResult>>({
                      type: 'sessions:stow-current-window',
                    }),
                  (result) => t(locale, 'stowCompleted', { saved: result.savedTabCount, closed: result.closedTabCount }),
                )
              }
              refreshKey={stowPreviewRefreshKey}
            />
          </div>
          </header>

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
          </aside>

          <NewTabFeedback message={status.message} tone={status.tone} />

          <section className="workspace-container v2-workspace" aria-label="Tab workspace">
            <div className="v2-workspace-columns" data-od-id="workspace-grid">
              <div className="active-region">
                <ActiveWorkspace
                  busy={busyAction !== null}
                  locale={locale}
                  onSnapshot={(snapshot) => {
                    setActiveSnapshot(snapshot);
                    setStowPreviewRefreshKey((value) => value + 1);
                    setSuggestionRefreshKey((value) => value + 1);
                  }}
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
                      (result) => t(locale, 'stowTabCompleted', {
                        saved: result.savedTabCount,
                        closed: result.closedTabCount,
                      }),
                    );
                  }}
                  onSuggestedStow={async () => {
                    await loadSessions();
                    setActiveWorkspaceRefreshKey((value) => value + 1);
                  }}
                  suggestionRefreshKey={suggestionRefreshKey}
                />
              </div>
              <div className="saved-region">
                <SavedForLaterView
                  busyAction={busyAction}
                  locale={locale}
                  onRunAction={runAction}
                  onOpenRecovery={() => setRecoveryOpen(true)}
                  query={tabQuery}
                  sessions={sessions}
                />
              </div>
            </div>
          </section>

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
        </section>
      </main>

      {duplicateTabstowCount > 0 ? (
        <ModalDialog
          actions={(
            <>
              <button
                className="secondary-button"
                disabled={duplicateTabstowClosePending}
                onClick={() => setDuplicateTabstowCount(0)}
                type="button"
              >
                {t(locale, 'duplicateTabstowKeepOpen')}
              </button>
              <button
                className="primary-button"
                disabled={duplicateTabstowClosePending}
                onClick={() => void closeOtherTabstowPages()}
                type="button"
              >
                {t(locale, 'duplicateTabstowCloseOthers')}
              </button>
            </>
          )}
          busy={duplicateTabstowClosePending}
          closeLabel={t(locale, 'duplicateTabstowKeepOpen')}
          onClose={() => setDuplicateTabstowCount(0)}
          title={t(locale, 'duplicateTabstowTitle')}
        >
          <p>{t(locale, 'duplicateTabstowDescription', { count: duplicateTabstowCount })}</p>
        </ModalDialog>
      ) : null}

      {extraOpen ? (
        <ModalDialog
          backdropClassName="extra-drawer-backdrop is-open"
          closeLabel={t(locale, 'closeExtra')}
          description={t(locale, 'extraDescription')}
          id="extra-drawer"
          onClose={() => setExtraOpen(false)}
          surfaceClassName="extra-drawer"
          title={t(locale, 'extra')}
        >
          <TodosPanel locale={locale} />
        </ModalDialog>
      ) : null}
      {recoveryOpen ? (
        <RecoveryBinDialog
          locale={locale}
          onClose={() => setRecoveryOpen(false)}
          onRestored={loadSessions}
        />
      ) : null}
      {syncDetailsOpen && duplicateTabstowCount === 0 ? (
        <SyncStatusDialog
          connection={connection}
          locale={locale}
          onClose={() => {
            const incidentKey = derivePausedIncidentKey(connection);
            if (incidentKey) {
              incidentAckWriteRef.current = incidentAckWriteRef.current.then(
                () => acknowledgeIncident(incidentKey),
                () => acknowledgeIncident(incidentKey),
              );
            }
            setSyncDetailsOpen(false);
          }}
          onOpenSettings={openOptions}
        />
      ) : null}
    </>
  );
}
