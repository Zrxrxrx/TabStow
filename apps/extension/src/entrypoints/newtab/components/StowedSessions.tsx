import { RefreshCcw, RotateCcw, Trash2, UploadCloud } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { TabSession } from '@tabstow/core';
import { StatusMessage } from '@/components/StatusMessage';
import { t, type Locale } from '@/features/i18n/i18n';
import type { AppResult } from '@/lib/errors';
import { sendExtensionMessage, type SyncResult } from '@/lib/messages';

type StatusState = {
  tone: 'info' | 'success' | 'error';
  message: string | null;
};

type Props = {
  busyAction: string | null;
  locale: Locale;
  sessions: TabSession[];
  status: StatusState;
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

function faviconUrlForSavedTab(tab: TabSession['tabs'][number]): string | null {
  if (tab.favIconUrl) return tab.favIconUrl;

  try {
    const url = new URL(tab.url);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (typeof chrome === 'undefined' || typeof chrome.runtime?.getURL !== 'function') return null;
    return chrome.runtime.getURL(`/_favicon/?pageUrl=${encodeURIComponent(url.toString())}&size=32`);
  } catch {
    return null;
  }
}

function savedTabFallbackLabel(tab: TabSession['tabs'][number]): string {
  return (tab.title.match(/[A-Za-z0-9]/)?.[0] ?? 'T').slice(0, 2).toUpperCase();
}

function SavedTabFavicon({ tab }: { tab: TabSession['tabs'][number] }) {
  const [failed, setFailed] = useState(false);
  const src = failed ? null : faviconUrlForSavedTab(tab);

  useEffect(() => {
    setFailed(false);
  }, [tab.favIconUrl, tab.url]);

  if (!src) {
    return (
      <span className="favicon tone-blue saved-tab-fallback" aria-hidden="true">
        {savedTabFallbackLabel(tab)}
      </span>
    );
  }

  return <img alt="" aria-hidden="true" className="saved-tab-favicon" onError={() => setFailed(true)} src={src} />;
}

export function StowedSessions({
  busyAction,
  locale,
  onRunAction,
  sessions,
  status,
}: Props) {
  const totalTabs = useMemo(
    () => sessions.reduce((count, session) => count + session.tabs.length, 0),
    [sessions],
  );

  return (
    <section className="panel column saved-sessions" aria-labelledby="saved-title" data-od-id="saved-tabs-column">
      <header className="section-header">
        <div>
          <h2 id="saved-title" data-od-id="saved-tabs-title">
            {t(locale, 'savedForLater')}
          </h2>
          <p className="subtle">{t(locale, 'savedSessionsSubtitle')}</p>
        </div>
        <span className="meta-row" id="saved-count" aria-label="Saved sessions and tabs count">
          <span className="meta-pill">{sessions.length} sessions</span>
          <span className="meta-pill">{totalTabs} tabs</span>
        </span>
      </header>

      <section className="session-toolbar" aria-label="Session controls" data-od-id="saved-actions">
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
          {t(locale, 'pull')}
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
          {t(locale, 'push')}
        </button>
      </section>

      <StatusMessage message={status.message} tone={status.tone} />

      <section className="session-list" aria-label="Saved sessions">
        {sessions.length === 0 ? (
          <div className="empty-state">{t(locale, 'noSavedSessions')}</div>
        ) : (
          sessions.map((session) => (
            <article className="session-card" key={session.id}>
              <header>
                <div className="tab-copy">
                  <span className="session-title">
                    {session.tabs.length} {session.tabs.length === 1 ? 'tab' : 'tabs'}
                  </span>
                  <span className="session-preview">{formatDate(session.createdAt)}</span>
                </div>
                <div className="row-actions">
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
                    {t(locale, 'restoreAll')}
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
                    {t(locale, 'delete')}
                  </button>
                </div>
              </header>
              <div className="saved-tab-list">
                {session.tabs.map((tab) => (
                  <a
                    className="saved-tab-row"
                    href={tab.url}
                    key={tab.id}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={t(locale, 'openSavedTab', { label: tab.title || tab.url })}
                  >
                    <SavedTabFavicon tab={tab} />
                    <span className="tab-copy">
                      <span className="tab-title">{tab.title || tab.url}</span>
                      <span className="tab-url">{tab.url}</span>
                    </span>
                  </a>
                ))}
              </div>
            </article>
          ))
        )}
      </section>
    </section>
  );
}
