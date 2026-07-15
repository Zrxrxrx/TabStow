import { useId, useMemo, useRef, useState } from 'react';
import { TabFavicon } from '@/components/TabFavicon';
import type {
  StowSuggestionCandidate,
  StowSuggestionMutationResult,
  SuggestedStowResult,
} from '@/features/tab-lifecycle/types';
import { t, type Locale } from '@/features/i18n/i18n';
import type { AppResult } from '@/lib/errors';
import { sendExtensionMessage } from '@/lib/messages';
import { ModalDialog } from './ModalDialog';

type Props = {
  initialCandidates: StowSuggestionCandidate[];
  locale: Locale;
  onCandidatesRemoved: (observationIds: string[]) => void;
  onClose: () => void;
  onStowed: () => void | Promise<void>;
};

type CandidateGroup = {
  windowId: number;
  candidates: StowSuggestionCandidate[];
};

function groupCandidates(candidates: StowSuggestionCandidate[]): CandidateGroup[] {
  const groups = new Map<number, StowSuggestionCandidate[]>();
  for (const candidate of candidates) {
    const group = groups.get(candidate.windowId);
    if (group) group.push(candidate);
    else groups.set(candidate.windowId, [candidate]);
  }
  return [...groups].map(([windowId, group]) => ({
    windowId,
    candidates: [...group].sort(
      (left, right) => left.index - right.index || left.observationId.localeCompare(right.observationId),
    ),
  }));
}

function domainForUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export function TabLifecycleReviewDialog({
  initialCandidates,
  locale,
  onCandidatesRemoved,
  onClose,
  onStowed,
}: Props) {
  const [candidates, setCandidates] = useState(() => [...initialCandidates]);
  const [selectedIds, setSelectedIds] = useState(
    () => new Set(initialCandidates.map(({ observationId }) => observationId)),
  );
  const [pendingObservationId, setPendingObservationId] = useState<string | null>(null);
  const [stowing, setStowing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<{ message: string; partial: boolean } | null>(null);
  const feedbackId = useId();
  const fallbackFocusRef = useRef<HTMLDivElement>(null);
  const groups = useMemo(() => groupCandidates(candidates), [candidates]);
  const selectedCandidates = candidates.filter(({ observationId }) =>
    selectedIds.has(observationId),
  );
  const selectedWindowCount = new Set(
    selectedCandidates.map(({ windowId }) => windowId),
  ).size;
  const selectedTabCount = t(
    locale,
    selectedCandidates.length === 1 ? 'savedTabCount' : 'savedTabsCount',
    { count: selectedCandidates.length },
  );
  const selectedSessionCount = t(
    locale,
    selectedWindowCount === 1 ? 'savedSessionCount' : 'savedSessionsCount',
    { count: selectedWindowCount },
  );
  const busy = stowing || pendingObservationId !== null;

  function removeCandidates(observationIds: string[]) {
    const removedIds = new Set(observationIds);
    setCandidates((current) => current.filter(({ observationId }) => !removedIds.has(observationId)));
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const observationId of observationIds) next.delete(observationId);
      return next;
    });
    onCandidatesRemoved(observationIds);
  }

  async function openCandidate(candidate: StowSuggestionCandidate) {
    if (busy) return;
    setPendingObservationId(candidate.observationId);
    setError(null);
    const response = await sendExtensionMessage<AppResult<{ focused: true }>>({
      type: 'active-tabs:focus',
      tabId: candidate.tabId,
      windowId: candidate.windowId,
    });
    setPendingObservationId(null);
    if (!response.ok) {
      setError(t(locale, 'lifecycleOpenError', { message: response.error.message }));
      return;
    }
    fallbackFocusRef.current?.focus();
    removeCandidates([candidate.observationId]);
  }

  async function keepSleeping(candidate: StowSuggestionCandidate) {
    if (busy) return;
    setPendingObservationId(candidate.observationId);
    setError(null);
    const response = await sendExtensionMessage<AppResult<StowSuggestionMutationResult>>({
      type: 'tab-lifecycle:suppress-suggestions',
      observationIds: [candidate.observationId],
    });
    setPendingObservationId(null);
    if (!response.ok) {
      setError(t(locale, 'lifecycleSuppressError', { message: response.error.message }));
      return;
    }
    fallbackFocusRef.current?.focus();
    removeCandidates([candidate.observationId]);
  }

  async function stowSelected() {
    if (busy || selectedCandidates.length === 0) return;
    const observationIds = selectedCandidates.map(({ observationId }) => observationId);
    setStowing(true);
    setError(null);
    setSummary(null);
    const response = await sendExtensionMessage<AppResult<SuggestedStowResult>>({
      type: 'tab-lifecycle:stow-suggestions',
      observationIds,
    });
    if (!response.ok) {
      setStowing(false);
      setError(t(locale, 'lifecycleStowError', { message: response.error.message }));
      return;
    }

    const skipped = response.data.skipped.length;
    const failed = response.data.closeFailures.length;
    const partial = skipped > 0 || failed > 0;
    const savedLabel = t(
      locale,
      response.data.savedTabCount === 1 ? 'savedTabCount' : 'savedTabsCount',
      { count: response.data.savedTabCount },
    );
    const sessionLabel = t(
      locale,
      response.data.createdSessionCount === 1 ? 'savedSessionCount' : 'savedSessionsCount',
      { count: response.data.createdSessionCount },
    );
    const closedLabel = t(
      locale,
      response.data.closedTabCount === 1
        ? 'lifecycleOriginalTabCount'
        : 'lifecycleOriginalTabsCount',
      { count: response.data.closedTabCount },
    );
    const skippedLabel = t(
      locale,
      skipped === 1 ? 'savedTabCount' : 'savedTabsCount',
      { count: skipped },
    );
    const failedLabel = t(
      locale,
      failed === 1 ? 'lifecycleOriginalTabCount' : 'lifecycleOriginalTabsCount',
      { count: failed },
    );
    setSummary({
      partial,
      message: t(locale, partial ? 'lifecycleStowPartial' : 'lifecycleStowSuccess', {
        saved: savedLabel,
        sessions: sessionLabel,
        closed: closedLabel,
        skipped: skippedLabel,
        failed: failedLabel,
      }),
    });
    removeCandidates(observationIds);
    try {
      await onStowed();
    } catch {
      // The stow already succeeded; a later focus or tab event will retry UI refreshes.
    } finally {
      setStowing(false);
    }
  }

  return (
    <ModalDialog
      actions={
        <>
          <button className="secondary-button" disabled={busy} onClick={onClose} type="button">
            {t(locale, 'cancel')}
          </button>
          <button
            className="primary-button"
            disabled={busy || selectedCandidates.length === 0}
            onClick={() => void stowSelected()}
            type="button"
          >
            {stowing
              ? t(locale, 'lifecycleSavingSafely')
              : t(locale, 'lifecycleConfirmStow', { count: selectedCandidates.length })}
          </button>
        </>
      }
      busy={busy}
      closeLabel={t(locale, 'cancel')}
      describedBy={error || summary ? feedbackId : undefined}
      description={t(locale, 'lifecycleReviewDescription')}
      onClose={onClose}
      surfaceClassName="lifecycle-review-dialog"
      title={t(locale, 'lifecycleReviewTitle')}
    >
      <div className="lifecycle-review-toolbar" ref={fallbackFocusRef} tabIndex={-1}>
        <button
          className="secondary-button"
          disabled={busy || candidates.length === 0}
          onClick={() => setSelectedIds(new Set(candidates.map(({ observationId }) => observationId)))}
          type="button"
        >
          {t(locale, 'lifecycleSelectAll')}
        </button>
        <button
          className="secondary-button"
          disabled={busy || selectedCandidates.length === 0}
          onClick={() => setSelectedIds(new Set())}
          type="button"
        >
          {t(locale, 'lifecycleClearAll')}
        </button>
        <span className="subtle lifecycle-review-count">
          {t(locale, 'lifecycleSelectionSummary', {
            tabs: selectedTabCount,
            sessions: selectedSessionCount,
          })}
        </span>
      </div>

      {error ? (
        <p className="status-message status-message--error" id={feedbackId} role="alert">
          {error}
        </p>
      ) : summary ? (
        <p
          aria-live="polite"
          className={`status-message status-message--${summary.partial ? 'info' : 'success'}`}
          id={feedbackId}
        >
          {summary.message}
        </p>
      ) : null}

      {groups.length === 0 ? (
        <p className="empty-state lifecycle-review-empty">{t(locale, 'lifecycleReviewEmpty')}</p>
      ) : (
        <div className="lifecycle-review-groups">
          {groups.map((group, groupIndex) => (
            <section
              aria-labelledby={`lifecycle-review-window-${group.windowId}`}
              className="lifecycle-review-group"
              key={group.windowId}
            >
              <h3 id={`lifecycle-review-window-${group.windowId}`}>
                {t(locale, 'windowNumber', { number: groupIndex + 1 })}
              </h3>
              <div className="lifecycle-review-list">
                {group.candidates.map((candidate) => {
                  const selected = selectedIds.has(candidate.observationId);
                  const rowBusy = pendingObservationId === candidate.observationId;
                  return (
                    <article className="lifecycle-review-row" key={candidate.observationId}>
                      <label className="lifecycle-review-selection">
                        <input
                          aria-label={t(locale, 'lifecycleSelectTab', { title: candidate.title })}
                          checked={selected}
                          disabled={busy}
                          onChange={(event) => setSelectedIds((current) => {
                            const next = new Set(current);
                            if (event.target.checked) next.add(candidate.observationId);
                            else next.delete(candidate.observationId);
                            return next;
                          })}
                          type="checkbox"
                        />
                        <TabFavicon
                          className="saved-tab-favicon"
                          favIconUrl={candidate.favIconUrl}
                          pageUrl={candidate.url}
                          title={candidate.title}
                        />
                        <span className="tab-copy">
                          <strong className="tab-title">{candidate.title}</strong>
                          <span className="tab-url">{domainForUrl(candidate.url)}</span>
                          <span className="subtle lifecycle-review-age">
                            {t(locale, 'lifecycleObservedSleeping', {
                              count: candidate.observedSleepingDays,
                            })}
                          </span>
                        </span>
                      </label>
                      <div className="lifecycle-review-row-actions">
                        <button
                          aria-label={t(locale, 'lifecycleOpenTabLabel', { title: candidate.title })}
                          className="secondary-button"
                          disabled={busy}
                          onClick={() => void openCandidate(candidate)}
                          type="button"
                        >
                          {rowBusy ? '…' : t(locale, 'lifecycleOpenTab')}
                        </button>
                        <button
                          aria-label={t(locale, 'lifecycleKeepSleepingLabel', { title: candidate.title })}
                          className="secondary-button"
                          disabled={busy}
                          onClick={() => void keepSleeping(candidate)}
                          type="button"
                        >
                          {rowBusy ? '…' : t(locale, 'lifecycleKeepSleeping')}
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </ModalDialog>
  );
}
