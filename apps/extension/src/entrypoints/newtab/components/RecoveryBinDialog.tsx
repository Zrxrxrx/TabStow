import { ExternalLink, RotateCcw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { TabSession } from '@tabstow/core';
import type { HistoryEntry } from '@/features/history/types';
import { t, type Locale } from '@/features/i18n/i18n';
import type { AppResult } from '@/lib/errors';
import { sendExtensionMessage } from '@/lib/messages';
import { ModalDialog } from './ModalDialog';
import { TabFavicon } from '@/components/TabFavicon';

type Props = {
  locale: Locale;
  onClose: () => void;
  onRestored: () => void | Promise<void>;
};

function recentEntries(entries: HistoryEntry[]) {
  return [...entries]
    .sort((left, right) => right.movedAt.localeCompare(left.movedAt) || left.id.localeCompare(right.id))
    .slice(0, 5);
}

export function RecoveryBinDialog({ locale, onClose, onRestored }: Props) {
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const visibleEntries = useMemo(() => recentEntries(entries ?? []), [entries]);

  async function load() {
    const response = await sendExtensionMessage<AppResult<HistoryEntry[]>>({ type: 'history:list' });
    if (response.ok) {
      setEntries(response.data);
      setError(null);
    } else {
      setEntries([]);
      setError(response.error.message);
    }
  }

  useEffect(() => { void load(); }, []);

  async function restore(historyId: string) {
    if (busyId) return;
    setBusyId(historyId);
    const response = await sendExtensionMessage<AppResult<TabSession>>({ type: 'history:restore', historyId });
    if (response.ok) {
      await onRestored();
      await load();
    } else {
      setError(response.error.message);
    }
    setBusyId(null);
  }

  return (
    <ModalDialog closeLabel={t(locale, 'cancel')} onClose={onClose} title={t(locale, 'recoveryBin')}>
      {entries === null ? <p className="subtle">{t(locale, 'historyLoading')}</p> : null}
      {error ? <p className="status-message status-message--error" role="alert">{error}</p> : null}
      {entries !== null && !error && visibleEntries.length === 0 ? <p className="empty-state">{t(locale, 'historyEmpty')}</p> : null}
      <div className="recovery-list">
        {visibleEntries.map((entry) => (
          <article className="recovery-entry" key={entry.id}>
            <TabFavicon
              className="saved-tab-favicon"
              pageUrl={entry.tabs[0]?.url ?? ''}
              title={entry.sourceTitle}
            />
            <div className="tab-copy">
              <strong>{entry.sourceTitle}</strong>
              <span className="tab-url">{t(locale, 'recoveryEntryMeta', { count: entry.tabs.length, reason: entry.reason, time: new Date(entry.movedAt).toLocaleString() })}</span>
            </div>
            <button className="secondary-button" disabled={busyId !== null} onClick={() => void restore(entry.id)} type="button">
              <RotateCcw aria-hidden="true" size={14} />
              {t(locale, 'restore')}
            </button>
          </article>
        ))}
      </div>
      <a className="secondary-button recovery-history-link" href={chrome.runtime.getURL('/saved-history.html')}>
        <ExternalLink aria-hidden="true" size={14} />
        {t(locale, 'viewFullHistory')}
      </a>
    </ModalDialog>
  );
}
