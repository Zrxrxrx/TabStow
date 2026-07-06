import type { ExtensionSettings } from '@tabstow/core';

export type StowableBrowserTab = Pick<
  chrome.tabs.Tab,
  'active' | 'favIconUrl' | 'id' | 'pinned' | 'title' | 'url' | 'windowId'
>;

const BLOCKED_URL_PREFIXES = ['chrome://', 'edge://', 'about:', 'chrome-extension://'];

export function isBlockedTabUrl(url: string | undefined): boolean {
  if (!url) return true;
  return BLOCKED_URL_PREFIXES.some((prefix) => url.startsWith(prefix));
}

export function isStowableTab(
  tab: StowableBrowserTab,
  settings: Pick<ExtensionSettings, 'includePinnedTabs'>,
): boolean {
  if (tab.id == null) return false;
  if (isBlockedTabUrl(tab.url)) return false;
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
