import type { ExtensionSettings } from '@tabstow/core';

export type StowableBrowserTab = Pick<
  chrome.tabs.Tab,
  'active' | 'favIconUrl' | 'id' | 'pinned' | 'title' | 'url' | 'windowId'
>;

const BLOCKED_URL_PREFIXES = [
  'chrome://',
  'edge://',
  'about:',
  'chrome-extension://',
  'devtools://',
];

export function isBlockedTabUrl(url: string | undefined): boolean {
  if (!url) return true;
  return BLOCKED_URL_PREFIXES.some((prefix) => url.startsWith(prefix));
}

export function isOpenableTabUrl(url: string | undefined): boolean {
  if (!url) return false;

  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function isStowableTab(
  tab: StowableBrowserTab,
  settings: Pick<ExtensionSettings, 'includePinnedTabs'>,
): boolean {
  if (tab.id == null) return false;
  if (!isOpenableTabUrl(tab.url)) return false;
  if (tab.pinned && !settings.includePinnedTabs) return false;
  return true;
}

export function shouldCloseSavedTab(
  tab: StowableBrowserTab,
  settings: Pick<ExtensionSettings, 'includePinnedTabs' | 'closePinnedTabs'>,
): boolean {
  if (tab.id == null) return false;
  if (tab.pinned && !settings.closePinnedTabs) return false;
  return true;
}
