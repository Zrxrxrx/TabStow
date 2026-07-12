import { Archive } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { t, type Locale } from '@/features/i18n/i18n';
import type { AppResult } from '@/lib/errors';
import { sendExtensionMessage, type StowPreview } from '@/lib/messages';

type Props = {
  busy: boolean;
  disabled: boolean;
  locale: Locale;
  onStatus: (tone: 'success' | 'error', message: string) => void;
  onStow: () => Promise<void>;
  refreshKey: number;
};

type PreviewState =
  | { kind: 'loading' }
  | { kind: 'ready'; count: number }
  | { kind: 'error' };

export function StowCurrentWindowButton({
  busy,
  disabled,
  locale,
  onStatus,
  onStow,
  refreshKey,
}: Props) {
  const [preview, setPreview] = useState<PreviewState>({ kind: 'loading' });
  const [localRefreshKey, setLocalRefreshKey] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const requestGenerationRef = useRef(0);
  const submittingRef = useRef(false);

  useEffect(() => {
    const generation = ++requestGenerationRef.current;
    setPreview({ kind: 'loading' });

    void sendExtensionMessage<AppResult<StowPreview>>({
      type: 'sessions:stow-current-window-preview',
    })
      .then((response) => {
        if (generation !== requestGenerationRef.current) return;
        if (response.ok) {
          setPreview({ kind: 'ready', count: response.data.eligibleTabCount });
        } else {
          setPreview({ kind: 'error' });
          onStatus('error', response.error.message);
        }
      })
      .catch((error: unknown) => {
        if (generation !== requestGenerationRef.current) return;
        setPreview({ kind: 'error' });
        onStatus('error', error instanceof Error ? error.message : 'Preview unavailable.');
      });

    return () => {
      requestGenerationRef.current += 1;
    };
  }, [localRefreshKey, refreshKey]);

  async function stow() {
    if (
      disabled ||
      busy ||
      submittingRef.current ||
      preview.kind !== 'ready' ||
      preview.count === 0
    ) {
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);
    try {
      await onStow();
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
      setLocalRefreshKey((value) => value + 1);
    }
  }

  const pending = busy || submitting;
  const detail = pending
    ? t(locale, 'stowWorkingSafely')
    : preview.kind === 'loading'
      ? t(locale, 'stowChecking')
      : preview.kind === 'error'
        ? t(locale, 'stowPreviewUnavailable')
        : preview.count === 0
          ? t(locale, 'stowNoTabsReady')
          : t(locale, 'stowTabsReady', { count: preview.count });

  return (
    <button
      aria-label={t(locale, 'stowCurrentWindow')}
      className="primary-button stow-current-button"
      disabled={
        disabled ||
        pending ||
        preview.kind !== 'ready' ||
        preview.count === 0
      }
      onClick={() => void stow()}
      type="button"
    >
      <Archive aria-hidden="true" size={16} />
      <span className="stow-current-copy">
        <strong>{pending ? t(locale, 'stowingWindow') : t(locale, 'stowCurrentWindow')}</strong>
        <small>{detail}</small>
      </span>
    </button>
  );
}
