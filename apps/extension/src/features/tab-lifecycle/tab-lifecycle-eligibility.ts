import { isOpenableTabUrl } from '@/features/tabs/tab-filter';

export type IdentifiableHttpTab = chrome.tabs.Tab & {
  id: number;
  url: string;
};

export function isIdentifiableHttpTab(
  tab: chrome.tabs.Tab,
): tab is IdentifiableHttpTab {
  return (
    Number.isInteger(tab.id)
    && (tab.id as number) >= 0
    && typeof tab.url === 'string'
    && isOpenableTabUrl(tab.url)
  );
}

export function isInactiveUnprotectedHttpTab(
  tab: chrome.tabs.Tab,
): tab is IdentifiableHttpTab {
  return (
    isIdentifiableHttpTab(tab)
    && tab.active !== true
    && tab.pinned !== true
    && tab.audible !== true
    && tab.incognito !== true
    && tab.autoDiscardable !== false
  );
}

export function validLastAccessed(
  value: unknown,
  now: number,
): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= now
    ? value
    : undefined;
}
