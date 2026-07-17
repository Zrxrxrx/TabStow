import { t, type Locale } from '@/features/i18n/i18n';
import { presentSessionTitle } from '@/features/tabs/session-presentation';
import type { ActiveTabContext, SavedTabContext } from './tab-search';

export function presentActiveTabContext(locale: Locale, context: ActiveTabContext): string {
  const windowLabel = context.currentWindow
    ? t(locale, 'currentWindow')
    : t(locale, 'windowNumber', { number: context.windowNumber });
  const laneLabel =
    context.lane.kind === 'group'
      ? context.lane.title || t(locale, 'unnamedGroup')
      : t(locale, context.lane.kind === 'pinned' ? 'pinnedTabs' : 'ungroupedTabs');

  return `${windowLabel} · ${laneLabel}`;
}

export function presentSavedTabContext(locale: Locale, context: SavedTabContext): string {
  return presentSessionTitle(locale, context.sessionTitle, context.tabCount);
}
