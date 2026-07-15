import type { TabLifecyclePolicy } from './types';

export const DAY_MS = 86_400_000;
export const NOW = Date.UTC(2026, 6, 15, 12);

export function storedLifecyclePolicy(
  overrides: Partial<TabLifecyclePolicy> = {},
): TabLifecyclePolicy & { schemaVersion: 1 } {
  return {
    schemaVersion: 1,
    automaticSleepEnabled: false,
    automaticSleepAfterDays: 7,
    stowSuggestionsEnabled: true,
    stowSuggestionAfterDays: 14,
    ...overrides,
  };
}

export function sleepingTab(
  overrides: Partial<chrome.tabs.Tab> = {},
): chrome.tabs.Tab {
  return {
    id: 1,
    index: 0,
    windowId: 1,
    highlighted: false,
    active: false,
    pinned: false,
    incognito: false,
    discarded: true,
    autoDiscardable: true,
    audible: false,
    url: 'https://example.com/one',
    title: 'Example one',
    favIconUrl: 'https://example.com/favicon.ico',
    lastAccessed: NOW - 30 * DAY_MS,
    ...overrides,
  } as chrome.tabs.Tab;
}
