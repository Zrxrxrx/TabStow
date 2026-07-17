import { ExternalLink, RotateCcw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TabSession } from '@tabstow/core';
import { TabFavicon } from '@/components/TabFavicon';
import type { HistoryEntry } from '@/features/history/types';
import { t, type Locale, type MessageKey } from '@/features/i18n/i18n';
import {
  formatLocalizedDateTime,
  presentSessionTitle,
} from '@/features/tabs/session-presentation';
import type { AppResult } from '@/lib/errors';
import { sendExtensionMessage } from '@/lib/messages';
import { ModalDialog } from '@/components/ModalDialog';
import { useSavedDataRefreshGate } from './useSavedDataInvalidation';
import type { RunSavedDataMutation } from './useSavedForLaterController';

type Props = {
  locale: Locale;
  onClose: () => void;
  runSavedDataMutation: RunSavedDataMutation;
};

function recentEntries(entries: HistoryEntry[]) {
  return [...entries]
    .sort((left, right) => right.movedAt.localeCompare(left.movedAt) || left.id.localeCompare(right.id))
    .slice(0, 5);
}

const RECOVERY_REASON_KEYS = {
  deleted: 'historyReasonDeleted',
  opened: 'historyReasonOpened',
  restored: 'historyReasonRestored',
} satisfies Record<HistoryEntry['reason'], MessageKey>;

export function RecoveryBinDialog({ locale, onClose, runSavedDataMutation }: Props) {
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const loadGenerationRef = useRef(0);
  const visibleEntries = useMemo(() => recentEntries(entries ?? []), [entries]);

  const load = useCallback(async () => {
    const generation = ++loadGenerationRef.current;
    const response = await sendExtensionMessage<AppResult<HistoryEntry[]>>({ type: 'history:list' });
    if (generation !== loadGenerationRef.current) return;

    if (response.ok) {
      setEntries(response.data);
      setError(null);
    } else {
      setEntries([]);
      setError(response.error.message);
    }
  }, []);

  const refreshGate = useSavedDataRefreshGate(load);

  useEffect(() => {
    void load();
    return () => { ++loadGenerationRef.current; };
  }, [load]);

  async function restore(historyId: string) {
    if (busyId) return;
    refreshGate.beginMutation();
    setBusyId(historyId);
    const response = await runSavedDataMutation(
      () => sendExtensionMessage<AppResult<TabSession>>({ type: 'history:restore', historyId }),
    );
    if (!response.ok) {
      setError(response.error.message);
    }
    await refreshGate.finishMutation(response.ok);
    setBusyId(null);
  }

  return (
    <ModalDialog closeLabel={t(locale, 'cancel')} onClose={onClose} title={t(locale, 'recoveryBin')}>
      {entries === null ? <p className="subtle">{t(locale, 'historyLoading')}</p> : null}
      {error ? <p className="status-message status-message--error" role="alert">{error}</p> : null}
      {entries !== null && !error && visibleEntries.length === 0 ? <p className="empty-state">{t(locale, 'historyEmpty')}</p> : null}
      <div className="recovery-list">
        {visibleEntries.map((entry) => {
          const sourceTitle = presentSessionTitle(locale, entry.sourceTitle, entry.tabs.length);
          const tabCountLabel = t(
            locale,
            entry.tabs.length === 1 ? 'savedTabCount' : 'savedTabsCount',
            { count: entry.tabs.length },
          );
          return (
            <article className="recovery-entry" key={entry.id}>
              <TabFavicon
                className="saved-tab-favicon"
                pageUrl={entry.tabs[0]?.url ?? ''}
                title={sourceTitle}
              />
              <div className="tab-copy">
                <strong>{sourceTitle}</strong>
                <span className="tab-url">{t(locale, 'recoveryEntryMeta', {
                  tabs: tabCountLabel,
                  reason: t(locale, RECOVERY_REASON_KEYS[entry.reason]),
                  time: formatLocalizedDateTime(locale, entry.movedAt),
                })}</span>
              </div>
              <button className="secondary-button" disabled={busyId !== null} onClick={() => void restore(entry.id)} type="button">
                <RotateCcw aria-hidden="true" size={14} />
                {t(locale, 'restore')}
              </button>
            </article>
          );
        })}
      </div>
      <a className="secondary-button recovery-history-link" href={chrome.runtime.getURL('/saved-history.html')}>
        <ExternalLink aria-hidden="true" size={14} />
        {t(locale, 'viewFullHistory')}
      </a>
    </ModalDialog>
  );
}
