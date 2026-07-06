import type { SavedTab, TabSession } from '@tabstow/core';
import { createSession, getSession } from '@/db/db';
import { getSettings } from '@/features/settings/settings-storage';
import { browser } from '@/lib/browser';
import { err, ok, toErrorMessage, type AppResult } from '@/lib/errors';
import type { RestoreMode, StowResult } from '@/lib/messages';
import { isStowableTab, shouldCloseSavedTab, type StowableBrowserTab } from './tab-filter';

function nowIso(): string {
  return new Date().toISOString();
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

async function getCurrentWindowTabs(): Promise<StowableBrowserTab[]> {
  return browser.tabs.query({ currentWindow: true });
}

export async function saveCurrentWindowAsSession(): Promise<AppResult<StowResult>> {
  try {
    const settings = await getSettings();
    const tabs = await getCurrentWindowTabs();
    const eligibleTabs = tabs.filter((tab) => isStowableTab(tab, settings));

    if (eligibleTabs.length === 0) {
      return err('no-eligible-tabs', 'No eligible tabs were found in the current window.');
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

    await createSession(session);

    const tabIdsToClose = eligibleTabs
      .filter((tab) => shouldCloseSavedTab(tab, settings))
      .map((tab) => tab.id)
      .filter((id): id is number => typeof id === 'number');

    await ensureWindowSurvivesRemoval(session.sourceWindowId, tabs.length, tabIdsToClose);

    if (tabIdsToClose.length > 0) {
      await browser.tabs.remove(tabIdsToClose);
    }

    return ok({
      session,
      savedTabCount: savedTabs.length,
      closedTabCount: tabIdsToClose.length,
    });
  } catch (error) {
    return err('chrome-tabs-error', toErrorMessage(error));
  }
}

export async function restoreSession(
  sessionId: string,
  mode: RestoreMode,
): Promise<AppResult<{ restored: true; tabCount: number }>> {
  try {
    const session = await getSession(sessionId);
    if (!session) {
      return err('session-not-found', 'Saved session was not found.');
    }

    if (mode === 'new-window') {
      await browser.windows.create({
        url: session.tabs.map((tab) => tab.url),
        focused: true,
      });

      return ok({ restored: true, tabCount: session.tabs.length });
    }

    for (const tab of session.tabs) {
      const createProperties: chrome.tabs.CreateProperties = {
        url: tab.url,
        active: false,
      };

      if (tab.pinned) {
        createProperties.pinned = true;
      }

      await browser.tabs.create(createProperties);
    }

    return ok({ restored: true, tabCount: session.tabs.length });
  } catch (error) {
    return err('chrome-tabs-error', toErrorMessage(error));
  }
}
