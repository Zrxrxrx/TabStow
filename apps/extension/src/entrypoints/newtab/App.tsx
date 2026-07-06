import { useEffect, useState } from 'react';
import type { TabSession } from '@tabstow/core';
import type { AppResult } from '@/lib/errors';
import { sendExtensionMessage, type StowResult } from '@/lib/messages';
import { ActiveWorkspace } from './components/ActiveWorkspace';
import { SearchBox } from './components/SearchBox';
import { StowedSessions } from './components/StowedSessions';

type StatusState = {
  tone: 'info' | 'success' | 'error';
  message: string | null;
};

export function App() {
  const [sessions, setSessions] = useState<TabSession[]>([]);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusState>({ tone: 'info', message: null });
  const [activeWorkspaceRefreshKey, setActiveWorkspaceRefreshKey] = useState(0);

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

  async function runAction<T>(
    actionId: string,
    action: () => Promise<AppResult<T>>,
    success: (data: T) => string,
  ) {
    if (busyAction !== null) return;
    setBusyAction(actionId);
    setStatus({ tone: 'info', message: null });
    const response = await action();
    setBusyAction(null);

    if (response.ok) {
      setStatus({ tone: 'success', message: success(response.data) });
      await loadSessions();
      setActiveWorkspaceRefreshKey((value) => value + 1);
      return;
    }

    setStatus({ tone: 'error', message: response.error.message });
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
          onStatus={(tone, message) => setStatus({ tone, message })}
        />
      </section>

      <ActiveWorkspace
        busy={busyAction !== null}
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

      <section className="stowed-sessions">
        <StowedSessions
          busyAction={busyAction}
          onOpenOptions={openOptions}
          onRunAction={runAction}
          sessions={sessions}
          status={status}
        />
      </section>
    </main>
  );
}
