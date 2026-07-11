import { RefreshCcw, RotateCcw, Trash2, UploadCloud } from 'lucide-react';
import { useMemo } from 'react';
import type { TabSession } from '@tabstow/core';
import { StatusMessage } from '@/components/StatusMessage';
import { TabFavicon } from '@/components/TabFavicon';
import { t, type Locale } from '@/features/i18n/i18n';
import { filterSavedSessions } from '@/features/tab-search/tab-search';
import type { AppResult } from '@/lib/errors';
import { sendExtensionMessage, type SyncResult } from '@/lib/messages';

type StatusState = {
  tone: 'info' | 'success' | 'error';
  message: string | null;
};

type Props = {
  busyAction: string | null;
  locale: Locale;
  query: string;
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

function isSafeSavedTabUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function SavedTabRow({ locale, tab }: { locale: Locale; tab: TabSession['tabs'][number] }) {
  const content = (
    <>
      <TabFavicon
        className="saved-tab-favicon"
        pageUrl={tab.url}
        title={tab.title || tab.url}
      />
      <span className="tab-copy">
        <span className="tab-title">{tab.title || tab.url}</span>
        <span className="tab-url">{tab.url}</span>
      </span>
    </>
  );

  if (!isSafeSavedTabUrl(tab.url)) {
    return (
      <div className="saved-tab-row" key={tab.id}>
        {content}
      </div>
    );
  }

  return (
    <a
      className="saved-tab-row"
      href={tab.url}
      key={tab.id}
      target="_blank"
      rel="noreferrer"
      aria-label={t(locale, 'openSavedTab', { label: tab.title || tab.url })}
    >
      {content}
    </a>
  );
}

export function StowedSessions({
  busyAction,
  locale,
  onRunAction,
  query,
  sessions,
  status,
}: Props) {
  const filteredSessions = useMemo(
    () => filterSavedSessions(sessions, query),
    [query, sessions],
  );
  const totalTabs = useMemo(
    () => filteredSessions.reduce((count, session) => count + session.tabs.length, 0),
    [filteredSessions],
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
          <span className="meta-pill">{filteredSessions.length} sessions</span>
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
              (result) => `Pulled ${result.sessionCount} sessions and ${result.quickLinkCount} quick links from Gist.`,
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
              (result) => `Pushed ${result.sessionCount} sessions and ${result.quickLinkCount} quick links to Gist.`,
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
        {filteredSessions.length === 0 ? (
          <div className="empty-state">{t(locale, 'noSavedSessions')}</div>
        ) : (
          filteredSessions.map((session) => (
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
                  <SavedTabRow key={tab.id} locale={locale} tab={tab} />
                ))}
              </div>
            </article>
          ))
        )}
      </section>
    </section>
  );
}
