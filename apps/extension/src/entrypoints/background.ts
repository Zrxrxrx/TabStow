import { deleteSession, listSessions } from '@/db/db';
import {
  registerContextMenu,
  registerContextMenuClickHandler,
} from '@/features/context-menu/context-menu';
import {
  closeActiveTabs,
  focusActiveTab,
  listActiveTabs,
  runDefaultSearch,
} from '@/features/active-tabs/active-tabs-service';
import {
  collapseChromeTabGroups,
  importChromeTabGroups,
  syncChromeTabGroups,
} from '@/features/chrome-tab-groups/chrome-tab-groups';
import { showActionFeedback } from '@/features/action-feedback/action-feedback';
import { getSettings, updateSettings } from '@/features/settings/settings-storage';
import { pullFromGist, pushToGist } from '@/features/sync/sync-service';
import {
  restoreSession,
  saveCurrentWindowAsSession,
  saveTabsAsSession,
} from '@/features/tabs/session-service';
import { err, ok, toErrorMessage, type AppResult } from '@/lib/errors';
import { browser } from '@/lib/browser';
import type { ExtensionMessage } from '@/lib/messages';

async function handleMessage(
  message: ExtensionMessage,
  sender?: chrome.runtime.MessageSender,
): Promise<AppResult<unknown>> {
  try {
    switch (message.type) {
      case 'sessions:list':
        return ok(await listSessions());
      case 'sessions:stow-current-window':
        return saveCurrentWindowAsSession(sender?.tab?.windowId);
      case 'sessions:stow-tab':
        return saveTabsAsSession([message.tabId]);
      case 'sessions:restore':
        return restoreSession(message.sessionId, message.mode);
      case 'sessions:delete':
        await deleteSession(message.sessionId);
        return ok({ deleted: true });
      case 'active-tabs:list':
        return listActiveTabs();
      case 'active-tabs:focus':
        return focusActiveTab(message.tabId, message.windowId);
      case 'active-tabs:close':
        return closeActiveTabs(message.tabIds);
      case 'active-tabs:search':
        return runDefaultSearch(message.query);
      case 'chrome-tab-groups:sync':
        return syncChromeTabGroups(message.groups, message.state);
      case 'chrome-tab-groups:import':
        return importChromeTabGroups(message.tabs, message.manualGroups, message.state);
      case 'chrome-tab-groups:collapse-window':
        return collapseChromeTabGroups(message.windowId);
      case 'settings:get':
        return ok(await getSettings());
      case 'settings:update':
        return ok(await updateSettings(message.settings));
      case 'sync:push':
        return pushToGist();
      case 'sync:pull':
        return pullFromGist();
    }
  } catch (error) {
    return err('unknown-error', toErrorMessage(error));
  }
}

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(() => {
    void registerContextMenu();
  });

  browser.runtime.onStartup.addListener(() => {
    void registerContextMenu();
  });

  registerContextMenuClickHandler();

  browser.action.onClicked.addListener((tab) => {
    void saveCurrentWindowAsSession(tab.windowId).then(showActionFeedback);
  });

  browser.runtime.onMessage.addListener((message: ExtensionMessage, sender) => {
    return handleMessage(message, sender);
  });
});
