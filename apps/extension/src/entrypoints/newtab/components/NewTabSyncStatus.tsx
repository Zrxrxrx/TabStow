import { Cloud, CloudOff, LoaderCircle, TriangleAlert } from 'lucide-react';
import type { ConnectionView, SyncState } from '@/features/sync/sync-types';
import { t, type Locale } from '@/features/i18n/i18n';

type Props = {
  connection: ConnectionView;
  locale: Locale;
  onOpenDetails: () => void;
};

function effectiveState(connection: ConnectionView): SyncState {
  if (connection.phase === 'disconnected') return 'disconnected';
  if (connection.phase === 'authorizing') return 'authorizing';
  if (connection.phase === 'needs-target') return 'needs-target';
  if (connection.phase === 'needs-confirmation') return 'needs-confirmation';
  return connection.sync.state;
}

function label(locale: Locale, state: SyncState): string {
  switch (state) {
    case 'synced':
      return t(locale, 'syncSynced');
    case 'pending':
      return t(locale, 'syncPending');
    case 'syncing':
      return t(locale, 'syncSyncing');
    case 'retrying':
      return t(locale, 'syncRetrying');
    case 'paused':
      return t(locale, 'syncPaused');
    case 'authorizing':
    case 'needs-target':
    case 'needs-confirmation':
      return t(locale, 'syncNeedsSetup');
    default:
      return t(locale, 'syncNotConnected');
  }
}

function pausedDetail(locale: Locale, connection: ConnectionView): string {
  switch (connection.sync.action) {
    case 'reconnect':
      return t(locale, 'syncReconnectNeeded');
    case 'rebind':
      return t(locale, 'syncTargetUnavailable');
    case 'inspect-file':
      return t(locale, 'syncFileNeedsAttention');
    default:
      return t(locale, 'syncUnable');
  }
}

export function NewTabSyncStatus({ connection, locale, onOpenDetails }: Props) {
  const state = effectiveState(connection);
  const localSafety = state === 'pending' || state === 'retrying';
  const Icon =
    state === 'paused'
      ? TriangleAlert
      : state === 'syncing'
        ? LoaderCircle
        : state === 'disconnected' || state === 'needs-target' || state === 'needs-confirmation'
          ? CloudOff
          : Cloud;
  const retryTime = connection.sync.retryAt
    ? new Intl.DateTimeFormat(locale === 'zh-CN' ? 'zh-CN' : 'en', {
        timeStyle: 'short',
      }).format(new Date(connection.sync.retryAt))
    : null;

  return (
    <button
      type="button"
      className={`newtab-sync-status newtab-sync-status--${state}`}
      aria-label={t(locale, 'syncStatus')}
      aria-live={state === 'paused' ? 'assertive' : 'polite'}
      onClick={onOpenDetails}
    >
      <div className="newtab-sync-status__summary">
        <Icon size={15} aria-hidden="true" />
        <span>{label(locale, state)}</span>
        {localSafety ? <span>· {t(locale, 'syncChangesSavedLocally')}</span> : null}
        {state === 'retrying' && retryTime ? (
          <span>· {t(locale, 'syncRetryScheduled', { time: retryTime })}</span>
        ) : null}
      </div>
      {state === 'paused' ? <span className="newtab-sync-status__detail">{pausedDetail(locale, connection)}</span> : null}
    </button>
  );
}
