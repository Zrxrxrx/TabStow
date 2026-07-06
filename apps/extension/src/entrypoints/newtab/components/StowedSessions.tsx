import { Archive, RefreshCcw, RotateCcw, Settings, Trash2, UploadCloud } from 'lucide-react';
import { useMemo } from 'react';
import type { TabSession } from '@tabstow/core';
import { StatusMessage } from '@/components/StatusMessage';
import type { AppResult } from '@/lib/errors';
import { sendExtensionMessage, type StowResult, type SyncResult } from '@/lib/messages';

type StatusState = {
  tone: 'info' | 'success' | 'error';
  message: string | null;
};

type Props = {
  busyAction: string | null;
  sessions: TabSession[];
  status: StatusState;
  onOpenOptions: () => void;
  onRunAction: <T>(
    actionId: string,
    action: () => Promise<AppResult<T>>,
    success: (data: T) => string,
  ) => Promise<void>;
};

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function domainFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function sessionPreview(session: TabSession): string {
  return session.tabs
    .slice(0, 4)
    .map((tab) => tab.title || domainFromUrl(tab.url))
    .join(' · ');
}

export function StowedSessions({
  busyAction,
  onOpenOptions,
  onRunAction,
  sessions,
  status,
}: Props) {
  const totalTabs = useMemo(
    () => sessions.reduce((count, session) => count + session.tabs.length, 0),
    [sessions],
  );

  return (
    <>
      <section className="header-actions" aria-label="Session controls">
        <button
          type="button"
          className="secondary-button"
          onClick={() =>
            void onRunAction<SyncResult>(
              'sync-pull',
              () => sendExtensionMessage<AppResult<SyncResult>>({ type: 'sync:pull' }),
              (result) => `Pulled ${result.sessionCount} sessions from Gist.`,
            )
          }
          disabled={busyAction !== null}
        >
          <RefreshCcw size={16} aria-hidden="true" />
          Pull
        </button>
        <button
          type="button"
          className="secondary-button"
          onClick={() =>
            void onRunAction<SyncResult>(
              'sync-push',
              () => sendExtensionMessage<AppResult<SyncResult>>({ type: 'sync:push' }),
              (result) => `Pushed ${result.sessionCount} sessions to Gist.`,
            )
          }
          disabled={busyAction !== null}
        >
          <UploadCloud size={16} aria-hidden="true" />
          Push
        </button>
        <button
          type="button"
          className="icon-button"
          onClick={onOpenOptions}
          aria-label="Open settings"
        >
          <Settings size={18} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="primary-button"
          onClick={() =>
            void onRunAction<StowResult>(
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
          Stow current window
        </button>
      </section>

      <section className="stats-row" aria-label="Session summary">
        <span>{sessions.length} sessions</span>
        <span>{totalTabs} tabs stored</span>
      </section>

      <StatusMessage message={status.message} tone={status.tone} />

      <section className="session-list" aria-label="Saved sessions">
        {sessions.length === 0 ? (
          <div className="empty-state">No saved sessions yet.</div>
        ) : (
          sessions.map((session) => (
            <article className="session-row" key={session.id}>
              <div className="session-main">
                <h2>{session.title}</h2>
                <p>
                  {formatDate(session.createdAt)} · {session.tabs.length}{' '}
                  {session.tabs.length === 1 ? 'tab' : 'tabs'}
                </p>
                <p className="session-preview">{sessionPreview(session)}</p>
              </div>
              <div className="session-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() =>
                    void onRunAction(
                      `restore-${session.id}`,
                      () =>
                        sendExtensionMessage<AppResult<{ restored: true; tabCount: number }>>({
                          type: 'sessions:restore',
                          sessionId: session.id,
                          mode: 'current-window',
                        }),
                      (result) => `Restored ${result.tabCount} tabs.`,
                    )
                  }
                  disabled={busyAction !== null}
                >
                  <RotateCcw size={16} aria-hidden="true" />
                  Restore
                </button>
                <button
                  type="button"
                  className="danger-button"
                  onClick={() =>
                    void onRunAction(
                      `delete-${session.id}`,
                      () =>
                        sendExtensionMessage<AppResult<{ deleted: true }>>({
                          type: 'sessions:delete',
                          sessionId: session.id,
                        }),
                      () => 'Deleted saved session.',
                    )
                  }
                  disabled={busyAction !== null}
                >
                  <Trash2 size={16} aria-hidden="true" />
                  Delete
                </button>
              </div>
            </article>
          ))
        )}
      </section>
    </>
  );
}
