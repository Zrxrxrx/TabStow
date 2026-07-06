import { useEffect, useMemo, useRef, useState } from 'react';
import type { TabSession } from '@tabstow/core';
import {
  getLanguagePreference,
  resolveLocale,
  type LanguagePreference,
} from '@/features/i18n/i18n';
import type { AppResult } from '@/lib/errors';
import { sendExtensionMessage, type StowResult } from '@/lib/messages';
import { ActiveWorkspace } from './components/ActiveWorkspace';
import { QuickLinks } from './components/QuickLinks';
import { SearchBox } from './components/SearchBox';
import { StowedSessions } from './components/StowedSessions';
import { ThemeControls } from './components/ThemeControls';
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
  }, []);

  useEffect(() => {
    void getLanguagePreference().then(setLanguage);
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

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

  return (
    <main className="newtab-shell dashboard-shell">
      <section className="dashboard-topbar">
        <div>
          <h1 id="tabstow-title">Tabstow</h1>
          <p>Stow, organize, and restore your browser tabs.</p>
        </div>
        <SearchBox
          disabled={busyAction !== null}
          locale={locale}
          onStatus={(tone, message) => setStatus({ tone, message })}
        />
      </section>

      <ActiveWorkspace
        busy={busyAction !== null}
        locale={locale}
        onStatus={(tone, message) => setStatus({ tone, message })}
        refreshKey={activeWorkspaceRefreshKey}
        onStowCurrentWindow={() =>
          runAction(
            'stow',
            () =>
              sendExtensionMessage<AppResult<StowResult>>({
                type: 'sessions:stow-current-window',
              }),
            (result) => `Stowed ${result.savedTabCount} tabs and closed ${result.closedTabCount}.`,
          )
        }
      />

      <section className="utility-grid" aria-label="Utilities">
        <QuickLinks locale={locale} />
        <TodosPanel locale={locale} />
        <ThemeControls language={language} locale={locale} onLanguageChange={setLanguage} />
      </section>

      <section className="stowed-sessions">
        <StowedSessions
          busyAction={busyAction}
          locale={locale}
          onOpenOptions={openOptions}
          onRunAction={runAction}
          sessions={sessions}
          status={status}
        />
      </section>
    </main>
  );
}
