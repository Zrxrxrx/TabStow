import { History, Search, X } from 'lucide-react';
import { t, type Locale } from '@/features/i18n/i18n';

type Props = {
  locale: Locale;
  value: string;
  onChange: (value: string) => void;
};

export function WorkspaceSearch({ locale, onChange, value }: Props) {
  return (
    <header className="workspace-header">
      <div className="workspace-search">
        <Search size={16} aria-hidden="true" />
        <input
          aria-label={t(locale, 'searchTabs')}
          onChange={(event) => onChange(event.target.value)}
          placeholder={t(locale, 'searchTabs')}
          type="search"
          value={value}
        />
        {value ? (
          <button
            type="button"
            className="icon-button workspace-search-clear"
            aria-label={t(locale, 'clearTabSearch')}
            onClick={() => onChange('')}
          >
            <X size={14} aria-hidden="true" />
          </button>
        ) : null}
      </div>
      <a
        className="secondary-button workspace-history-link"
        href={chrome.runtime.getURL('/history.html')}
      >
        <History size={16} aria-hidden="true" />
        {t(locale, 'history')}
      </a>
    </header>
  );
}
