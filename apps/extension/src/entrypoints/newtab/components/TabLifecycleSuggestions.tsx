import { useEffect, useRef, useState } from 'react';
import type {
  StowSuggestionCandidate,
  StowSuggestionList,
  StowSuggestionMutationResult,
} from '@/features/tab-lifecycle/types';
import { t, type Locale } from '@/features/i18n/i18n';
import type { AppResult } from '@/lib/errors';
import { sendExtensionMessage } from '@/lib/messages';
import { TabLifecycleReviewDialog } from './TabLifecycleReviewDialog';

type Props = {
  disabled: boolean;
  locale: Locale;
  onStowed: () => void | Promise<void>;
  refreshKey: number;
};

export function TabLifecycleSuggestions({
  disabled,
  locale,
  onStowed,
  refreshKey,
}: Props) {
  const [suggestions, setSuggestions] = useState<StowSuggestionList | null>(null);
  const [reviewSnapshot, setReviewSnapshot] = useState<StowSuggestionCandidate[] | null>(null);
  const [snoozing, setSnoozing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeRef = useRef(true);
  const requestRef = useRef(0);

  useEffect(() => {
    activeRef.current = true;
    const requestId = ++requestRef.current;
    void sendExtensionMessage<AppResult<StowSuggestionList>>({
      type: 'tab-lifecycle:list-suggestions',
    }).then((response) => {
      if (!activeRef.current || requestId !== requestRef.current) return;
      if (response.ok) {
        setSuggestions(response.data);
        setError(null);
      }
    }).catch(() => {
      // Suggestions are opportunistic; the next focus or tab refresh retries them.
    });

    return () => {
      activeRef.current = false;
      requestRef.current += 1;
    };
  }, [refreshKey]);

  function removeCandidates(observationIds: string[]) {
    requestRef.current += 1;
    const removedIds = new Set(observationIds);
    setSuggestions((current) => current ? {
      ...current,
      candidates: current.candidates.filter(({ observationId }) => !removedIds.has(observationId)),
    } : current);
  }

  async function snooze() {
    const observationIds = suggestions?.candidates.map(({ observationId }) => observationId) ?? [];
    if (disabled || snoozing || observationIds.length === 0) return;
    setSnoozing(true);
    setError(null);
    const response = await sendExtensionMessage<AppResult<StowSuggestionMutationResult>>({
      type: 'tab-lifecycle:snooze-suggestions',
      observationIds,
    });
    setSnoozing(false);
    if (!response.ok) {
      setError(t(locale, 'lifecycleSnoozeError', { message: response.error.message }));
      return;
    }
    removeCandidates(observationIds);
  }

  const candidates = suggestions?.candidates ?? [];
  const count = candidates.length;

  return (
    <>
      {suggestions && count > 0 ? (
        <aside
          aria-label={t(locale, 'lifecycleSuggestionsLabel')}
          className="lifecycle-suggestion-banner"
        >
          <div className="lifecycle-suggestion-copy">
            <strong>
              {t(
                locale,
                count === 1 ? 'lifecycleSuggestionBannerOne' : 'lifecycleSuggestionBanner',
                { count, days: suggestions.afterDays },
              )}
            </strong>
            {error ? (
              <span className="lifecycle-suggestion-error" role="alert">{error}</span>
            ) : null}
          </div>
          <div className="lifecycle-suggestion-actions">
            <button
              className="primary-button"
              disabled={disabled || snoozing}
              onClick={() => setReviewSnapshot([...candidates])}
              type="button"
            >
              {t(locale, 'lifecycleReview')}
            </button>
            <button
              className="secondary-button"
              disabled={disabled || snoozing}
              onClick={() => void snooze()}
              type="button"
            >
              {t(locale, 'lifecycleRemindLater')}
            </button>
          </div>
        </aside>
      ) : null}

      {reviewSnapshot ? (
        <TabLifecycleReviewDialog
          initialCandidates={reviewSnapshot}
          locale={locale}
          onCandidatesRemoved={removeCandidates}
          onClose={() => setReviewSnapshot(null)}
          onStowed={onStowed}
        />
      ) : null}
    </>
  );
}
