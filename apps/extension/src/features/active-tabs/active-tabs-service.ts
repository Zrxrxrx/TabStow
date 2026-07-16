import { browser } from '@/lib/browser';
import { err, ok, toErrorMessage, type AppResult } from '@/lib/errors';
import { isBlockedTabUrl } from '@/features/tabs/tab-filter';
import { reconcileTabLifecycleTab } from '@/features/tab-lifecycle/tab-lifecycle-events';
import type {
  ActiveBrowserTab,
  ActiveChromeWindowInfo,
  ActiveTabsSleepResult,
  ActiveTabsSnapshot,
  ChromeTabGroupInfo,
} from './types';

async function listOtherTabstowPageIds(currentTabId: number): Promise<number[]> {
  const newTabUrl = browser.runtime.getURL('/newtab.html');
  const tabs = await browser.tabs.query({});

  return tabs.flatMap((tab) =>
    tab.id != null &&
    tab.id !== currentTabId &&
    (tab.pendingUrl ?? tab.url) === newTabUrl
      ? [tab.id]
      : [],
  );
}

export async function getDuplicateTabstowPageState(
  currentTabId: number | undefined,
): Promise<AppResult<{ duplicateCount: number }>> {
  if (currentTabId == null) {
    return err('chrome-tabs-error', 'Tabstow could not identify the current tab.');
  }

  try {
    const duplicateTabIds = await listOtherTabstowPageIds(currentTabId);
    return ok({ duplicateCount: duplicateTabIds.length });
  } catch (error) {
    return err('chrome-tabs-error', toErrorMessage(error));
  }
}

export async function closeDuplicateTabstowPages(
  currentTabId: number | undefined,
): Promise<AppResult<{ closedTabCount: number }>> {
  if (currentTabId == null) {
    return err('chrome-tabs-error', 'Tabstow could not identify the current tab.');
  }

  try {
    const duplicateTabIds = await listOtherTabstowPageIds(currentTabId);
    if (duplicateTabIds.length > 0) await browser.tabs.remove(duplicateTabIds);
    return ok({ closedTabCount: duplicateTabIds.length });
  } catch (error) {
    return err('chrome-tabs-error', toErrorMessage(error));
  }
}

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
    const tab = await browser.tabs.update(tabId, { active: true });
    await browser.windows.update(tab?.windowId ?? windowId, { focused: true });
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
        try {
          await reconcileTabLifecycleTab(discardedTab);
        } catch {
          // The tab event remains a second signal when observation storage is unavailable.
        }
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
