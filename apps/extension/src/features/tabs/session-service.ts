import type { ExtensionSettings, SavedTab, TabSession } from '@tabstow/core';
import {
  createSession,
  getHistoryEntry,
  getSession,
  moveSavedTabToHistory,
  moveSessionToHistory,
} from '../../db/db';
import { getSettings } from '../settings/settings-storage';
import { browser } from '../../lib/browser';
import {
  err,
  ok,
  toErrorMessage,
  toKnownStorageError,
  type AppResult,
} from '../../lib/errors';
import type { StowPreview, StowResult } from '../../lib/messages';
import {
  isOpenableTabUrl,
  isStowableTab,
  shouldCloseSavedTab,
  type StowableBrowserTab,
} from './tab-filter';

const restoringSessions = new Set<string>();
const consumingTabs = new Set<string>();
const consumingTabCountsBySession = new Map<string, number>();

function acquireConsumptionLock(
  sessionId: string,
  tabId: string | null,
): (() => void) | null {
  if (tabId === null) {
    if (restoringSessions.has(sessionId) || consumingTabCountsBySession.has(sessionId)) {
      return null;
    }
    restoringSessions.add(sessionId);
    return () => restoringSessions.delete(sessionId);
  }

  const tabKey = `${sessionId}\u0000${tabId}`;
  if (restoringSessions.has(sessionId) || consumingTabs.has(tabKey)) return null;

  consumingTabs.add(tabKey);
  consumingTabCountsBySession.set(
    sessionId,
    (consumingTabCountsBySession.get(sessionId) ?? 0) + 1,
  );
  return () => {
    consumingTabs.delete(tabKey);
    const remaining = (consumingTabCountsBySession.get(sessionId) ?? 1) - 1;
    if (remaining === 0) consumingTabCountsBySession.delete(sessionId);
    else consumingTabCountsBySession.set(sessionId, remaining);
  };
}

function operationInProgressResult(): AppResult<never> {
  return err(
    'operation-in-progress',
    'Another saved-session operation is already in progress.',
  );
}

function nowIso(): string {
  return new Date().toISOString();
}

function storageErrorResult(error: unknown): AppResult<never> {
  return toKnownStorageError(error) ?? err('unknown-error', toErrorMessage(error));
}

function titleFromTabs(tabs: SavedTab[]): string {
  if (tabs.length === 1) return tabs[0]?.title || '1 tab';
  return `${tabs.length} tabs stowed`;
}

function toSavedTab(tab: StowableBrowserTab, createdAt: string): SavedTab {
  if (!tab.url) {
    throw new Error('Cannot save a tab without a URL.');
  }

  const savedTab: SavedTab = {
    id: crypto.randomUUID(),
    url: tab.url,
    title: tab.title || tab.url || 'Untitled tab',
    createdAt,
  };

  if (tab.favIconUrl) {
    savedTab.favIconUrl = tab.favIconUrl;
  }

  if (typeof tab.pinned === 'boolean') {
    savedTab.pinned = tab.pinned;
  }

  return savedTab;
}

async function ensureWindowSurvivesRemoval(
  windowId: number | undefined,
  totalCurrentWindowTabs: number,
  tabIdsToClose: number[],
): Promise<void> {
  if (windowId == null) return;
  if (tabIdsToClose.length < totalCurrentWindowTabs) return;

  await browser.tabs.create({
    windowId,
    url: browser.runtime.getURL('/newtab.html'),
    active: true,
  });
}

async function getCurrentWindowTabs(windowId?: number): Promise<StowableBrowserTab[]> {
  if (windowId != null) {
    return browser.tabs.query({ windowId });
  }

  return browser.tabs.query({ lastFocusedWindow: true });
}

async function getCurrentWindowStowSelection(windowId?: number): Promise<{
  eligibleTabs: StowableBrowserTab[];
  settings: ExtensionSettings;
  tabs: StowableBrowserTab[];
}> {
  const settings = await getSettings();
  const tabs = await getCurrentWindowTabs(windowId);
  return {
    eligibleTabs: tabs.filter((tab) => isStowableTab(tab, settings)),
    settings,
    tabs,
  };
}

export async function getCurrentWindowStowPreview(
  windowId?: number,
): Promise<AppResult<StowPreview>> {
  try {
    const { eligibleTabs } = await getCurrentWindowStowSelection(windowId);
    return ok({
      eligibleTabCount: eligibleTabs.length,
    });
  } catch (error) {
    return err('chrome-tabs-error', toErrorMessage(error));
  }
}

export async function saveCurrentWindowAsSession(windowId?: number): Promise<AppResult<StowResult>> {
  try {
    const { eligibleTabs, settings, tabs } = await getCurrentWindowStowSelection(windowId);

    if (eligibleTabs.length === 0) {
      return err('no-eligible-tabs', 'No eligible tabs were found in the current window.');
    }

    const createdAt = nowIso();
    const savedTabs = eligibleTabs.map((tab) => toSavedTab(tab, createdAt));
    const session: TabSession = {
      id: crypto.randomUUID(),
      title: titleFromTabs(savedTabs),
      tabs: savedTabs,
      sourceWindowId: windowId ?? eligibleTabs[0]?.windowId,
      createdAt,
      updatedAt: createdAt,
      deviceId: settings.deviceId,
    };

    const savedSession = await createSession(session);

    const tabIdsToClose = eligibleTabs
      .filter((tab) => shouldCloseSavedTab(tab, settings))
      .map((tab) => tab.id)
      .filter((id): id is number => typeof id === 'number');

    let closedTabCount = 0;

    try {
      await ensureWindowSurvivesRemoval(savedSession.sourceWindowId, tabs.length, tabIdsToClose);
    } catch {
      // Best effort only; the session is already persisted.
    }

    if (tabIdsToClose.length > 0) {
      try {
        await browser.tabs.remove(tabIdsToClose);
        closedTabCount = tabIdsToClose.length;
      } catch {
        closedTabCount = 0;
      }
    }

    return ok({
      session: savedSession,
      savedTabCount: savedSession.tabs.length,
      closedTabCount,
    });
  } catch (error) {
    return err('chrome-tabs-error', toErrorMessage(error));
  }
}

export async function saveTabsAsSession(tabIds: number[]): Promise<AppResult<StowResult>> {
  try {
    const settings = await getSettings();
    const tabs = await Promise.all(tabIds.map((tabId) => browser.tabs.get(tabId)));
    const eligibleTabs = tabs.filter(
      (tab) => tab.id != null && isOpenableTabUrl(tab.url),
    );

    if (eligibleTabs.length === 0) {
      return err('no-eligible-tabs', 'No eligible tabs were found in the selected tab.');
    }

    const createdAt = nowIso();
    const savedTabs = eligibleTabs.map((tab) => toSavedTab(tab, createdAt));
    const session: TabSession = {
      id: crypto.randomUUID(),
      title: titleFromTabs(savedTabs),
      tabs: savedTabs,
      sourceWindowId: eligibleTabs[0]?.windowId,
      createdAt,
      updatedAt: createdAt,
      deviceId: settings.deviceId,
    };

    const savedSession = await createSession(session);

    const tabIdsToClose = eligibleTabs
      .map((tab) => tab.id)
      .filter((id): id is number => typeof id === 'number');
    let closedTabCount = 0;

    if (tabIdsToClose.length > 0) {
      try {
        await browser.tabs.remove(tabIdsToClose);
        closedTabCount = tabIdsToClose.length;
      } catch {
        closedTabCount = 0;
      }
    }

    return ok({
      session: savedSession,
      savedTabCount: savedSession.tabs.length,
      closedTabCount,
    });
  } catch (error) {
    return err('chrome-tabs-error', toErrorMessage(error));
  }
}

async function openSavedTabUnlocked(
  sessionId: string,
  tabId: string,
  consume: boolean,
): Promise<AppResult<{ opened: true; consumed: boolean }>> {
  let session: TabSession | undefined;
  try {
    session = await getSession(sessionId);
  } catch (error) {
    return storageErrorResult(error);
  }
  if (!session) {
    return err('session-not-found', 'Saved window was not found.');
  }

  const tab = session.tabs.find(({ id }) => id === tabId);
  if (!tab) {
    return err('saved-tab-not-found', 'Saved tab was not found.');
  }
  if (!isOpenableTabUrl(tab.url)) {
    return err('invalid-tab-url', 'Saved tab URL cannot be opened.');
  }

  try {
    await browser.tabs.create({ url: tab.url, active: false });
  } catch (error) {
    return err('chrome-tabs-error', toErrorMessage(error));
  }

  if (consume) {
    try {
      await moveSavedTabToHistory(sessionId, tabId, 'opened');
    } catch (error) {
      return storageErrorResult(error);
    }
  }

  return ok({ opened: true, consumed: consume });
}

export async function openSavedTab(
  sessionId: string,
  tabId: string,
  consume: boolean,
): Promise<AppResult<{ opened: true; consumed: boolean }>> {
  if (!consume) return openSavedTabUnlocked(sessionId, tabId, false);

  const release = acquireConsumptionLock(sessionId, tabId);
  if (!release) return operationInProgressResult();
  try {
    return await openSavedTabUnlocked(sessionId, tabId, true);
  } finally {
    release();
  }
}

export async function openHistoryTab(
  historyId: string,
  tabId: string,
): Promise<AppResult<{ opened: true }>> {
  let entry: Awaited<ReturnType<typeof getHistoryEntry>>;
  try {
    entry = await getHistoryEntry(historyId);
  } catch (error) {
    return storageErrorResult(error);
  }
  if (!entry) {
    return err('history-entry-not-found', 'History entry was not found.');
  }

  const tab = entry.tabs.find(({ id }) => id === tabId);
  if (!tab) {
    return err('saved-tab-not-found', 'Saved tab was not found.');
  }
  if (!isOpenableTabUrl(tab.url)) {
    return err('invalid-tab-url', 'Saved tab URL cannot be opened.');
  }

  try {
    await browser.tabs.create({ url: tab.url, active: false });
  } catch (error) {
    return err('chrome-tabs-error', toErrorMessage(error));
  }

  return ok({ opened: true });
}

async function restoreSessionUnlocked(
  sessionId: string,
): Promise<AppResult<{ restored: true; tabCount: number }>> {
  let session: TabSession | undefined;
  try {
    session = await getSession(sessionId);
  } catch (error) {
    return storageErrorResult(error);
  }
  if (!session) {
    return err('session-not-found', 'Saved window was not found.');
  }
  if (session.tabs.length === 0) {
    return err('empty-session', 'Saved window has no tabs to restore.');
  }

  if (session.tabs.some(({ url }) => !isOpenableTabUrl(url))) {
    return err('invalid-tab-url', 'Saved tab URL cannot be opened.');
  }

  try {
    for (const tab of session.tabs) {
      await browser.tabs.create({
        url: tab.url,
        active: false,
        pinned: tab.pinned || undefined,
      });
    }
  } catch (error) {
    return err(
      'chrome-tabs-error',
      `${toErrorMessage(error)} Some tabs may already have opened; the saved window was kept.`,
    );
  }

  try {
    await moveSessionToHistory(sessionId, 'restored');
  } catch (error) {
    return storageErrorResult(error);
  }

  return ok({ restored: true, tabCount: session.tabs.length });
}

export async function restoreSession(
  sessionId: string,
): Promise<AppResult<{ restored: true; tabCount: number }>> {
  const release = acquireConsumptionLock(sessionId, null);
  if (!release) return operationInProgressResult();
  try {
    return await restoreSessionUnlocked(sessionId);
  } finally {
    release();
  }
}
