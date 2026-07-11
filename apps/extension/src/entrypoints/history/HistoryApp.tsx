import { useEffect, useMemo, useState } from 'react';
import { TabFavicon } from '@/components/TabFavicon';
import { StatusMessage } from '@/components/StatusMessage';
import type { HistoryEntry } from '@/features/history/types';
import {
  getLanguagePreference,
  resolveLocale,
  t,
  type LanguagePreference,
} from '@/features/i18n/i18n';
import type { AppResult } from '@/lib/errors';
import { sendExtensionMessage } from '@/lib/messages';

type StatusState = {
  tone: 'info' | 'success' | 'error';
  message: string | null;
};

function reasonMessageKey(reason: HistoryEntry['reason']) {
  if (reason === 'restored') return 'historyRestoredFrom' as const;
  if (reason === 'deleted') return 'historyRemovedFrom' as const;
  return 'historyOpenedFrom' as const;
}

export function HistoryApp() {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusState>({ tone: 'info', message: null });
  const [language, setLanguage] = useState<LanguagePreference>('auto');
  const locale = useMemo(() => resolveLocale(language, navigator.language), [language]);

  async function loadEntries() {
    const response = await sendExtensionMessage<AppResult<HistoryEntry[]>>({
      type: 'history:list',
    });
    if (response.ok) {
      setEntries(response.data);
    } else {
      setStatus({ tone: 'error', message: response.error.message });
    }
    setLoading(false);
  }

  useEffect(() => {
    void loadEntries();
  }, []);

  useEffect(() => {
    void getLanguagePreference().then(setLanguage);
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  async function openTab(historyId: string, tabId: string, title: string) {
    setBusyAction(`open-${historyId}-${tabId}`);
    setStatus({ tone: 'info', message: null });
    const response = await sendExtensionMessage<AppResult<{ opened: true }>>({
      type: 'history:open-tab',
      historyId,
      tabId,
    });
    setBusyAction(null);

    if (response.ok) {
      setStatus({
        tone: 'success',
        message: t(locale, 'historyOpenedInBackground', { title }),
      });
      return;
    }
    setStatus({ tone: 'error', message: response.error.message });
  }

  async function restoreEntry(historyId: string) {
    setBusyAction(`restore-${historyId}`);
    setStatus({ tone: 'info', message: null });
    const response = await sendExtensionMessage({ type: 'history:restore', historyId });

    if (response.ok) {
      setStatus({ tone: 'success', message: t(locale, 'historyRestored') });
      await loadEntries();
    } else {
      setStatus({ tone: 'error', message: response.error.message });
    }
    setBusyAction(null);
  }

  async function deleteEntry(historyId: string) {
    if (!window.confirm(t(locale, 'historyConfirmDelete'))) return;

    setBusyAction(`delete-${historyId}`);
    setStatus({ tone: 'info', message: null });
    const response = await sendExtensionMessage({ type: 'history:delete', historyId });

    if (response.ok) {
      setStatus({ tone: 'success', message: t(locale, 'historyDeleted') });
      await loadEntries();
    } else {
      setStatus({ tone: 'error', message: response.error.message });
    }
    setBusyAction(null);
  }

  return (
    <main className="history-shell">
      <a href={chrome.runtime.getURL('/newtab.html')}>{t(locale, 'historyBackToTabstow')}</a>
      <h1>{t(locale, 'history')}</h1>
      <StatusMessage message={status.message} tone={status.tone} />
      {loading ? <p>{t(locale, 'historyLoading')}</p> : null}
      {!loading && status.tone !== 'error' && entries.length === 0 ? (
        <p>{t(locale, 'historyEmpty')}</p>
      ) : null}
      <div className="history-list">
        {entries.map((entry) => (
          <article className="history-entry" key={entry.id}>
            <header>
              <p>{t(locale, reasonMessageKey(entry.reason), { sourceTitle: entry.sourceTitle })}</p>
              <time dateTime={entry.movedAt}>
                {new Intl.DateTimeFormat(locale, {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                }).format(new Date(entry.movedAt))}
              </time>
            </header>
            <ul>
              {entry.tabs.map((tab) => (
                <li key={tab.id}>
                  <TabFavicon
                    favIconUrl={tab.favIconUrl}
                    pageUrl={tab.url}
                    title={tab.title}
                  />
                  <span>{tab.title}</span>
                  <button
                    aria-label={t(locale, 'historyOpenInBackground', { title: tab.title })}
                    disabled={busyAction !== null}
                    onClick={() => void openTab(entry.id, tab.id, tab.title)}
                    type="button"
                  >
                    {t(locale, 'historyOpen')}
                  </button>
                </li>
              ))}
            </ul>
            <div className="history-entry-actions">
              <button
                disabled={busyAction !== null}
                onClick={() => void restoreEntry(entry.id)}
                type="button"
              >
                {t(locale, 'historyRestore')}
              </button>
              <button
                disabled={busyAction !== null}
                onClick={() => void deleteEntry(entry.id)}
                type="button"
              >
                {t(locale, 'historyDeletePermanently')}
              </button>
            </div>
          </article>
        ))}
      </div>
    </main>
  );
}
