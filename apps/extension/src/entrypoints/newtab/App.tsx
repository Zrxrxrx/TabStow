import { useEffect, useState } from 'react';
import type { TabSession } from '@tabstow/core';
import type { AppResult } from '@/lib/errors';
import { sendExtensionMessage } from '@/lib/messages';
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
    setBusyAction(actionId);
    setStatus({ tone: 'info', message: null });
    const response = await action();
    setBusyAction(null);

    if (response.ok) {
      setStatus({ tone: 'success', message: success(response.data) });
      await loadSessions();
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

      <StowedSessions
        busyAction={busyAction}
        onOpenOptions={openOptions}
        onRunAction={runAction}
        sessions={sessions}
        status={status}
      />
    </main>
  );
}
