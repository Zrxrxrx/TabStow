import { Search } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { t, type Locale } from '@/features/i18n/i18n';
import type { AppResult } from '@/lib/errors';
import { sendExtensionMessage } from '@/lib/messages';

type Props = {
  disabled?: boolean;
  locale: Locale;
  onStatus: (tone: 'success' | 'error', message: string) => void;
};

export function SearchBox({ disabled = false, locale, onStatus }: Props) {
  const [query, setQuery] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const response = await sendExtensionMessage<AppResult<{ searched: true }>>({
      type: 'active-tabs:search',
      query,
    });
    if (response.ok) {
      setQuery('');
      onStatus('success', 'Search opened.');
      return;
    }
    onStatus('error', response.error.message);
  }

  return (
    <form className="dashboard-search" onSubmit={(event) => void submit(event)}>
      <Search size={16} aria-hidden="true" />
      <input
        aria-label={t(locale, 'searchTheWeb')}
        disabled={disabled}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={t(locale, 'searchWithDefaultEngine')}
        type="search"
        value={query}
      />
      <span className="kbd" aria-hidden="true">
        /
      </span>
    </form>
  );
}
