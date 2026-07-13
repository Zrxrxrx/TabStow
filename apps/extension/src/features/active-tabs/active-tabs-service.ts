import { browser } from '@/lib/browser';
import { err, ok, toErrorMessage, type AppResult } from '@/lib/errors';
import { isBlockedTabUrl } from '@/features/tabs/tab-filter';
import type {
  ActiveBrowserTab,
  ActiveChromeWindowInfo,
  ActiveTabsSleepResult,
  ActiveTabsSnapshot,
  ChromeTabGroupInfo,
} from './types';

export async function listActiveTabs(): Promise<AppResult<ActiveBrowserTab[]>> {
  try {
    const tabs = await browser.tabs.query({});
    return ok(tabs.filter((tab) => !isBlockedTabUrl(tab.url)));
  } catch (error) {
    return err('chrome-tabs-error', toErrorMessage(error));
  }
}

async function listChromeTabGroups(): Promise<ChromeTabGroupInfo[]> {
  try {
    return await browser.tabGroups.query({});
  } catch {
    return [];
  }
}

function normalizeNormalWindows(windows: chrome.windows.Window[]): ActiveChromeWindowInfo[] {
  return windows
    .filter(
      (window): window is chrome.windows.Window & { id: number; type: 'normal' } =>
        typeof window.id === 'number' && window.type === 'normal',
    )
    .map((window) => ({
      id: window.id,
      focused: window.focused,
      incognito: window.incognito,
      type: 'normal',
    }));
}

export async function listActiveTabsSnapshot(): Promise<AppResult<ActiveTabsSnapshot>> {
  const tabsResponse = await listActiveTabs();
  if (!tabsResponse.ok) return tabsResponse;

  try {
    const [rawWindows, rawGroups] = await Promise.all([
      browser.windows.getAll({ populate: false, windowTypes: ['normal'] }),
      listChromeTabGroups(),
    ]);
    const normalWindows = normalizeNormalWindows(rawWindows);
    const normalWindowIds = new Set(normalWindows.map((window) => window.id));
    const tabs = tabsResponse.data.filter((tab) => normalWindowIds.has(tab.windowId));
    const visibleWindowIds = new Set(tabs.map((tab) => tab.windowId));

    return ok({
      windows: normalWindows.filter((window) => visibleWindowIds.has(window.id)),
      tabs,
      chromeGroups: rawGroups.filter((group) => visibleWindowIds.has(group.windowId)),
    });
  } catch (error) {
    return err('chrome-tabs-error', toErrorMessage(error));
  }
}

export async function focusActiveTab(
  tabId: number,
  windowId: number,
): Promise<AppResult<{ focused: true }>> {
  try {
    await browser.windows.update(windowId, { focused: true });
    await browser.tabs.update(tabId, { active: true });
    return ok({ focused: true });
  } catch (error) {
    return err('chrome-tabs-error', toErrorMessage(error));
  }
}

export async function closeActiveTabs(
  tabIds: number[],
): Promise<AppResult<{ closed: true; tabCount: number }>> {
  try {
    await browser.tabs.remove(tabIds);
    return ok({ closed: true, tabCount: tabIds.length });
  } catch (error) {
    return err('chrome-tabs-error', toErrorMessage(error));
  }
}

export async function sleepActiveTabs(
  tabIds: number[],
): Promise<AppResult<ActiveTabsSleepResult>> {
  const sleptTabIds: number[] = [];
  const skippedTabIds: number[] = [];
  const failures: ActiveTabsSleepResult['failures'] = [];

  for (const tabId of new Set(tabIds)) {
    try {
      const tab = await browser.tabs.get(tabId);
      if (
        tab.active
        || tab.discarded
        || tab.pinned
        || tab.audible
        || tab.incognito
        || isBlockedTabUrl(tab.url)
      ) {
        skippedTabIds.push(tabId);
        continue;
      }
      const discardedTab = await browser.tabs.discard(tabId);
      if (discardedTab?.discarded) {
        sleptTabIds.push(tabId);
      } else {
        skippedTabIds.push(tabId);
      }
    } catch (error) {
      failures.push({ tabId, message: toErrorMessage(error) });
    }
  }

  return ok({ sleptTabIds, skippedTabIds, failures });
}

export async function runDefaultSearch(
  query: string,
): Promise<AppResult<{ searched: true }>> {
  const text = query.trim();
  if (!text) return err('unknown-error', 'Search query is required.');

  try {
    await browser.search.query({ text });
    return ok({ searched: true });
  } catch (error) {
    return err('unknown-error', toErrorMessage(error));
  }
}
