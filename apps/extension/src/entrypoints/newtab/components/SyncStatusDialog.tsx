import type { ConnectionView } from '@/features/sync/sync-types';
import { t, type Locale } from '@/features/i18n/i18n';
import { ModalDialog } from './ModalDialog';

type Props = {
  connection: ConnectionView;
  locale: Locale;
  onClose: () => void;
  onOpenSettings: () => void;
};

function valueOrUnavailable(value: string | undefined, locale: Locale) {
  return value || t(locale, 'unavailable');
}

export function SyncStatusDialog({ connection, locale, onClose, onOpenSettings }: Props) {
  const sync = connection.sync;
  return (
    <ModalDialog closeLabel={t(locale, 'cancel')} onClose={onClose} title={t(locale, 'syncDetails')}>
      <dl className="sync-detail-list">
        <div><dt>{t(locale, 'account')}</dt><dd>{valueOrUnavailable(connection.account?.login, locale)}</dd></div>
        <div><dt>{t(locale, 'gistFile')}</dt><dd>{valueOrUnavailable(connection.binding?.fileName, locale)}</dd></div>
        <div><dt>{t(locale, 'syncState')}</dt><dd>{sync.state}</dd></div>
        <div><dt>{t(locale, 'syncMessage')}</dt><dd>{valueOrUnavailable(sync.message, locale)}</dd></div>
        <div><dt>{t(locale, 'lastSync')}</dt><dd>{sync.lastSuccessAt ? new Date(sync.lastSuccessAt).toLocaleString() : t(locale, 'unavailable')}</dd></div>
        <div><dt>{t(locale, 'retryTime')}</dt><dd>{sync.retryAt ? new Date(sync.retryAt).toLocaleString() : t(locale, 'unavailable')}</dd></div>
        <div><dt>{t(locale, 'localData')}</dt><dd>{t(locale, 'syncChangesSavedLocally')}</dd></div>
      </dl>
      <button className="primary-button" onClick={onOpenSettings} type="button">
        {sync.action === 'reconnect' ? t(locale, 'syncReconnect') : t(locale, 'openSettings')}
      </button>
    </ModalDialog>
  );
}
