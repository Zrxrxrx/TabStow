import { deleteSession, listSessions } from '@/db/db';
import {
  registerContextMenu,
  registerContextMenuClickHandler,
} from '@/features/context-menu/context-menu';
import {
  closeActiveTabs,
  focusActiveTab,
  listActiveTabs,
  listActiveTabsSnapshot,
  runDefaultSearch,
} from '@/features/active-tabs/active-tabs-service';
import {
  moveActiveTab,
  moveActiveTabGroup,
} from '@/features/active-tabs/active-tab-moves';
import { collapseChromeTabGroups } from '@/features/chrome-tab-groups/chrome-tab-groups';
import { showActionFeedback } from '@/features/action-feedback/action-feedback';
import { getSettings, updateSettings } from '@/features/settings/settings-storage';
import { pullFromGist, pushToGist } from '@/features/sync/sync-service';
import {
  reorderQuickLinks,
  updateQuickLink,
} from '@/features/quick-links/quick-links';
import { updateQuickLinks } from '@/features/quick-links/quick-links-storage';
import {
  restoreSession,
  saveCurrentWindowAsSession,
  saveTabsAsSession,
} from '@/features/tabs/session-service';
import { err, ok, toErrorMessage, type AppResult } from '@/lib/errors';
import { browser } from '@/lib/browser';
import type { ExtensionMessage } from '@/lib/messages';

function unsupportedMessage(message: ExtensionMessage): AppResult<never> {
  return err('unknown-error', `Unsupported extension message: ${String(message.type)}.`);
}

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
      case 'active-tabs:snapshot':
        return listActiveTabsSnapshot();
      case 'active-tabs:move-tab':
        return moveActiveTab(message.request);
      case 'active-tabs:move-group':
        return moveActiveTabGroup(message.request);
      case 'active-tabs:focus':
        return focusActiveTab(message.tabId, message.windowId);
      case 'active-tabs:close':
        return closeActiveTabs(message.tabIds);
      case 'active-tabs:search':
        return runDefaultSearch(message.query);
      case 'quick-links:add':
        return ok(await updateQuickLinks((links) => [...links, message.link]));
      case 'quick-links:update':
        return ok(
          await updateQuickLinks((links) =>
            links.map((link) =>
              link.id === message.linkId ? updateQuickLink(link, message.patch) : link,
            ),
          ),
        );
      case 'quick-links:remove':
        return ok(await updateQuickLinks((links) => links.filter((link) => link.id !== message.linkId)));
      case 'quick-links:reorder':
        return ok(await updateQuickLinks((links) => reorderQuickLinks(links, message.orderedIds)));
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
      default:
        return unsupportedMessage(message);
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

  browser.runtime.onMessage.addListener((message: ExtensionMessage, sender, sendResponse) => {
    void handleMessage(message, sender).then(
      sendResponse,
      (error) => sendResponse(err('unknown-error', toErrorMessage(error))),
    );
    return true;
  });
});
