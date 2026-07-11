import type { ActiveTabWindow } from '@/features/active-tabs/types';
import { t, type Locale } from '@/features/i18n/i18n';

type Props = {
  locale: Locale;
  windows: ActiveTabWindow[];
  onJump: (key: string) => void;
};

export function GroupNav({ locale, windows, onJump }: Props) {
  if (windows.length === 0) return null;
  const targets = windows.flatMap((window, index) => [
    {
      key: window.key,
      label: window.focused
        ? t(locale, 'currentWindow')
        : t(locale, 'windowNumber', { number: index + 1 }),
      count: window.visibleTabCount,
    },
    ...window.items
      .filter((item) => item.kind === 'group')
      .map((group) => ({
        key: group.key,
        label: group.title ?? t(locale, 'chromeGroupFallback', { id: group.groupId }),
        count: group.tabs.length,
      })),
  ]);

  return (
    <nav className="tabs-toolbar group-nav" aria-label={t(locale, 'activeTabsNavigation')}>
      <button
        className="group-filter"
        type="button"
        onClick={() => onJump(windows[0]?.key ?? '')}
        aria-pressed="true"
      >
        <span>{t(locale, 'allActiveTabs')}</span>
        <strong>
          {windows.reduce((count, window) => count + window.visibleTabCount, 0)}
        </strong>
      </button>
      {targets.map((target) => (
        <button
          className="group-filter"
          key={target.key}
          type="button"
          onClick={() => onJump(target.key)}
        >
          <span>{target.label}</span>
          <strong>{target.count}</strong>
        </button>
      ))}
    </nav>
  );
}
