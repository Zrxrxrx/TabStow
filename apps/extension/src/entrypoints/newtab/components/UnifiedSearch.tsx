import { Search, X } from 'lucide-react';
import { useEffect, useMemo, useRef, type FormEvent } from 'react';
import type { TabSession } from '@tabstow/core';
import { TabFavicon } from '@/components/TabFavicon';
import type { ActiveTabsSnapshot } from '@/features/active-tabs/types';
import { t, type Locale } from '@/features/i18n/i18n';
import { buildUnifiedSearchSuggestions } from '@/features/tab-search/tab-search';
import type { AppResult } from '@/lib/errors';
import { sendExtensionMessage } from '@/lib/messages';

type Props = {
  activeSnapshot: ActiveTabsSnapshot;
  disabled?: boolean;
  locale: Locale;
  onChange: (value: string) => void;
  onSavedOpened: () => void | Promise<void>;
  onStatus: (tone: 'success' | 'error', message: string) => void;
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
  onSavedOpened,
  onStatus,
  sessions,
  value,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestions = useMemo(
    () => buildUnifiedSearchSuggestions(activeSnapshot, sessions, value),
    [activeSnapshot, sessions, value],
  );

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

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const response = await sendExtensionMessage<AppResult<{ searched: true }>>({
      type: 'active-tabs:search',
      query: value,
    });
    if (response.ok) onStatus('success', t(locale, 'searchOpened'));
    else onStatus('error', response.error.message);
  }

  async function openSuggestion(suggestion: (typeof suggestions)[number]) {
    if (suggestion.source === 'active') {
      const response = await sendExtensionMessage<AppResult<{ focused: true }>>({
        type: 'active-tabs:focus',
        tabId: suggestion.tabId,
        windowId: suggestion.windowId,
      });
      if (!response.ok) onStatus('error', response.error.message);
      return;
    }

    const response = await sendExtensionMessage<AppResult<{ opened: true; consumed: boolean }>>({
      type: 'sessions:open-tab',
      sessionId: suggestion.sessionId,
      tabId: suggestion.tabId,
      consume: true,
    });
    if (!response.ok) {
      onStatus('error', response.error.message);
      return;
    }
    await onSavedOpened();
    onStatus('success', t(locale, 'openedSavedTab'));
  }

  return (
    <div className="unified-search-wrap">
      <form className="dashboard-search unified-search" onSubmit={(event) => void submit(event)}>
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
      {suggestions.length > 0 ? (
        <div className="unified-search-suggestions" role="listbox" aria-label={t(locale, 'searchSuggestions')}>
          {suggestions.map((suggestion) => (
            <button
              className="unified-search-suggestion"
              key={suggestion.key}
              onClick={() => void openSuggestion(suggestion)}
              role="option"
              type="button"
            >
              <span className="suggestion-source">
                {t(locale, suggestion.source === 'active' ? 'activeSource' : 'savedSource')}
              </span>
              <TabFavicon
                favIconUrl={suggestion.favIconUrl}
                pageUrl={suggestion.url}
                title={suggestion.title}
              />
              <span className="tab-copy">
                <strong className="tab-title">{suggestion.title}</strong>
                <span className="tab-url">{suggestion.url}</span>
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
