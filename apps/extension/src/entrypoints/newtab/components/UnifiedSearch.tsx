import { Search, X } from 'lucide-react';
import { useEffect, useMemo, useRef, type FormEvent } from 'react';
import type { TabSession } from '@tabstow/core';
import { TabFavicon } from '@/components/TabFavicon';
import type { ActiveTabsSnapshot } from '@/features/active-tabs/types';
import { t, type Locale } from '@/features/i18n/i18n';
import {
  buildUnifiedSearchSuggestions,
  type UnifiedSearchSuggestion,
} from '@/features/tab-search/tab-search';
import {
  presentActiveTabContext,
  presentSavedTabContext,
} from '@/features/tab-search/tab-search-presentation';
import type { AppResult } from '@/lib/errors';
import { sendExtensionMessage } from '@/lib/messages';
import type { RunSavedDataMutation } from '@/features/saved-for-later';

type Props = {
  activeSnapshot: ActiveTabsSnapshot;
  disabled?: boolean;
  locale: Locale;
  onChange: (value: string) => void;
  onStatus: (tone: 'success' | 'error', message: string) => void;
  runSavedDataMutation: RunSavedDataMutation;
  sessions: TabSession[];
  value: string;
};

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

export function UnifiedSearch({
  activeSnapshot,
  disabled = false,
  locale,
  onChange,
  onStatus,
  runSavedDataMutation,
  sessions,
  value,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestions = useMemo(
    () => buildUnifiedSearchSuggestions(activeSnapshot, sessions, value),
    [activeSnapshot, sessions, value],
  );
  const activeSuggestions = suggestions.filter(
    (suggestion): suggestion is Extract<UnifiedSearchSuggestion, { source: 'active' }> =>
      suggestion.source === 'active',
  );
  const savedSuggestions = suggestions.filter(
    (suggestion): suggestion is Extract<UnifiedSearchSuggestion, { source: 'saved' }> =>
      suggestion.source === 'saved',
  );
  const query = value.trim();

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === '/' && !isEditableTarget(event.target)) {
        event.preventDefault();
        inputRef.current?.focus();
      } else if (event.key === 'Escape' && value) {
        event.preventDefault();
        onChange('');
        inputRef.current?.focus();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onChange, value]);

  async function searchWeb() {
    const response = await sendExtensionMessage<AppResult<{ searched: true }>>({
      type: 'active-tabs:search',
      query: value,
    });
    if (response.ok) onStatus('success', t(locale, 'searchOpened'));
    else onStatus('error', response.error.message);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void searchWeb();
  }

  async function openSuggestion(suggestion: (typeof suggestions)[number]) {
    if (disabled) return;
    if (suggestion.source === 'active') {
      const response = await sendExtensionMessage<AppResult<{ focused: true }>>({
        type: 'active-tabs:focus',
        tabId: suggestion.tabId,
        windowId: suggestion.windowId,
      });
      if (!response.ok) onStatus('error', response.error.message);
      return;
    }

    await runSavedDataMutation(
      async () => {
        const response = await sendExtensionMessage<AppResult<{ opened: true; consumed: boolean }>>({
          type: 'sessions:open-tab',
          sessionId: suggestion.sessionId,
          tabId: suggestion.tabId,
          consume: true,
        });
        if (response.ok) onStatus('success', t(locale, 'openedSavedTab'));
        else onStatus('error', response.error.message);
        return response;
      },
      (result) => result.ok && result.data.consumed,
    );
  }

  function renderSuggestion(suggestion: UnifiedSearchSuggestion) {
    const context =
      suggestion.source === 'active'
        ? presentActiveTabContext(locale, suggestion.context)
        : presentSavedTabContext(locale, suggestion.context);

    return (
      <button
        className="unified-search-suggestion"
        disabled={disabled}
        key={suggestion.key}
        onClick={() => void openSuggestion(suggestion)}
        type="button"
      >
        <TabFavicon
          favIconUrl={suggestion.favIconUrl}
          pageUrl={suggestion.url}
          title={suggestion.title}
        />
        <span className="tab-copy">
          <strong className="tab-title">{suggestion.title}</strong>
          {suggestion.url ? <span className="tab-url">{suggestion.url}</span> : null}
          <span className="suggestion-context">{context}</span>
        </span>
      </button>
    );
  }

  return (
    <div className="unified-search-wrap">
      <form className="dashboard-search unified-search" onSubmit={submit}>
        <Search aria-hidden="true" size={16} />
        <input
          aria-label={t(locale, 'searchTabsAndWeb')}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          placeholder={t(locale, 'searchTabsAndWeb')}
          ref={inputRef}
          type="search"
          value={value}
        />
        {value ? (
          <button
            aria-label={t(locale, 'clearTabSearch')}
            className="icon-button unified-search-clear"
            onClick={() => onChange('')}
            type="button"
          >
            <X aria-hidden="true" size={14} />
          </button>
        ) : <span className="kbd" aria-hidden="true">/</span>}
      </form>
      {query ? (
        <div className="unified-search-suggestions" aria-label={t(locale, 'searchSuggestions')}>
          {activeSuggestions.length > 0 ? (
            <div
              aria-label={t(locale, 'activeSource')}
              className="unified-search-group"
              role="group"
            >
              <p className="unified-search-group-label">{t(locale, 'activeSource')}</p>
              {activeSuggestions.map(renderSuggestion)}
            </div>
          ) : null}
          {savedSuggestions.length > 0 ? (
            <div
              aria-label={t(locale, 'savedSource')}
              className="unified-search-group"
              role="group"
            >
              <p className="unified-search-group-label">{t(locale, 'savedSource')}</p>
              {savedSuggestions.map(renderSuggestion)}
            </div>
          ) : null}
          <div
            aria-label={t(locale, 'searchTheWeb')}
            className="unified-search-group unified-search-group--web"
            role="group"
          >
            <p className="unified-search-group-label">{t(locale, 'searchTheWeb')}</p>
            <button
              className="unified-search-suggestion unified-search-web"
              disabled={disabled}
              onClick={() => void searchWeb()}
              type="button"
            >
              <Search aria-hidden="true" size={18} />
              <span className="tab-copy">
                <strong className="tab-title">{query}</strong>
                <span className="suggestion-context">{t(locale, 'searchWithDefaultEngine')}</span>
              </span>
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
