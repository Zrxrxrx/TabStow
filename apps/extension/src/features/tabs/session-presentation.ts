import { t, type Locale } from '@/features/i18n/i18n';

export function formatLocalizedDateTime(locale: Locale, value: string): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export function presentSessionTitle(locale: Locale, title: string, tabCount: number): string {
  if (title !== `${tabCount} tabs stowed`) return title;

  return t(
    locale,
    tabCount === 1 ? 'generatedSessionTitleOne' : 'generatedSessionTitleMany',
    { count: tabCount },
  );
}
