import { browser } from '@/lib/browser';
import { err, ok, toErrorMessage, type AppResult } from '@/lib/errors';
import { isBlockedTabUrl } from '@/features/tabs/tab-filter';
import type { ActiveBrowserTab, ActiveTabsSnapshot, ChromeTabGroupInfo } from './types';

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

export async function listActiveTabsSnapshot(): Promise<AppResult<ActiveTabsSnapshot>> {
  const response = await listActiveTabs();
  if (!response.ok) return response;

  return ok({
    windows: [],
    tabs: response.data,
    chromeGroups: await listChromeTabGroups(),
  });
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
