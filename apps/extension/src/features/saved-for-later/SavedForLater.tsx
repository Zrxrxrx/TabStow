import { useState } from 'react';
import type { Locale } from '@/features/i18n/i18n';
import { RecoveryBinDialog } from './RecoveryBinDialog';
import { SavedForLaterView } from './SavedForLaterView';
import type { SavedForLaterController } from './useSavedForLaterController';

export type SavedForLaterProps = {
  controller: SavedForLaterController;
  historyLinkTarget?: '_blank';
  locale: Locale;
  query: string;
};

export function SavedForLater({
  controller,
  historyLinkTarget,
  locale,
  query,
}: SavedForLaterProps) {
  const [recoveryOpen, setRecoveryOpen] = useState(false);

  return (
    <>
      <SavedForLaterView
        busyAction={controller.busyAction}
        locale={locale}
        onRunAction={controller.runAction}
        onOpenRecovery={() => setRecoveryOpen(true)}
        query={query}
        sessions={controller.sessions}
      />
      {recoveryOpen ? (
        <RecoveryBinDialog
          historyLinkTarget={historyLinkTarget}
          locale={locale}
          onClose={() => setRecoveryOpen(false)}
          runSavedDataMutation={controller.runSavedDataMutation}
        />
      ) : null}
    </>
  );
}
