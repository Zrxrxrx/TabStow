import type { ActiveTabWindow } from '@/features/active-tabs/types';
import { t, type Locale } from '@/features/i18n/i18n';

type Props = {
  locale: Locale;
  onChange: (windowId: number | null) => void;
  value: number | null;
  windows: ActiveTabWindow[];
};

export function WindowFilter({ locale, onChange, value, windows }: Props) {
  return (
    <nav className="window-filter" aria-label={t(locale, 'windowFilter')}>
      <button className="group-filter" type="button" onClick={() => onChange(null)} aria-pressed={value === null}>
        <span>{t(locale, 'allActiveTabs')}</span>
        <strong>{windows.reduce((count, window) => count + window.visibleTabCount, 0)}</strong>
      </button>
      {windows.map((window, index) => (
        <button className="group-filter" key={window.key} type="button" onClick={() => onChange(window.windowId)} aria-pressed={value === window.windowId}>
          <span>{window.focused ? t(locale, 'currentWindow') : t(locale, 'windowNumber', { number: index + 1 })}</span>
          <strong>{window.visibleTabCount}</strong>
        </button>
      ))}
    </nav>
  );
}
