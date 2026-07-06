import { Search } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import type { AppResult } from '@/lib/errors';
import { sendExtensionMessage } from '@/lib/messages';

type Props = {
  disabled?: boolean;
  onStatus: (tone: 'success' | 'error', message: string) => void;
};

export function SearchBox({ disabled = false, onStatus }: Props) {
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
        aria-label="Search the web"
        disabled={disabled}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search with your default engine"
        type="search"
        value={query}
      />
    </form>
  );
}
