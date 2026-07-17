import { useEffect, useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import { StatusMessage } from '@/components/StatusMessage';
import {
  SavedForLater,
  useSavedForLaterController,
  type SavedForLaterStatus,
} from '@/features/saved-for-later';
import {
  getLanguagePreference,
  resolveLocale,
  t,
  type LanguagePreference,
} from '@/features/i18n/i18n';

export type SidePanelAppProps = {
  initialThemeError?: string | null;
};

export function SidePanelApp({
  initialThemeError = null,
}: SidePanelAppProps = {}) {
  const [language, setLanguage] = useState<LanguagePreference>('auto');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<SavedForLaterStatus>(
    initialThemeError
      ? { tone: 'error', message: initialThemeError }
      : { tone: 'info', message: null },
  );
  const locale = useMemo(
    () => resolveLocale(language, navigator.language),
    [language],
  );
  const controller = useSavedForLaterController({ onStatus: setStatus });

  useEffect(() => {
    void getLanguagePreference().then(setLanguage);
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  return (
    <main className="sidepanel-shell" data-od-id="sidepanel-shell">
      <form
        className="dashboard-search sidepanel-search"
        onSubmit={(event) => event.preventDefault()}
        role="search"
      >
        <Search aria-hidden="true" size={16} />
        <input
          aria-label={t(locale, 'searchSavedTabs')}
          disabled={controller.busyAction !== null}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t(locale, 'searchSavedTabs')}
          type="search"
          value={query}
        />
        {query ? (
          <button
            aria-label={t(locale, 'clearTabSearch')}
            className="icon-button sidepanel-search-clear"
            disabled={controller.busyAction !== null}
            onClick={() => setQuery('')}
            type="button"
          >
            <X aria-hidden="true" size={14} />
          </button>
        ) : null}
      </form>
      <StatusMessage message={status.message} tone={status.tone} />
      <SavedForLater
        controller={controller}
        historyLinkTarget="_blank"
        locale={locale}
        query={query}
      />
    </main>
  );
}
