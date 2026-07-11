import {
  deleteHistoryEntry,
  listHistory,
  listSessions,
  moveSavedTab,
  moveSavedTabToHistory,
  moveSessionToHistory,
  reorderSessions,
  restoreHistoryEntry,
} from '@/db/db';
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
  openHistoryTab,
  openSavedTab,
  restoreSession,
  saveCurrentWindowAsSession,
  saveTabsAsSession,
} from '@/features/tabs/session-service';
import { err, ok, toErrorMessage, type AppResult } from '@/lib/errors';
import { browser } from '@/lib/browser';
import type { ExtensionMessage } from '@/lib/messages';
import type { MoveSavedTabRequest } from '@/features/history/types';

function unsupportedMessage(message: ExtensionMessage): AppResult<never> {
  return err('unknown-error', `Unsupported extension message: ${String(message.type)}.`);
}

function hasId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isValidSavedMoveRequest(request: unknown): request is MoveSavedTabRequest {
  if (!request || typeof request !== 'object') return false;

  const candidate = request as Partial<MoveSavedTabRequest>;
  return hasId(candidate.sourceSessionId)
    && hasId(candidate.tabId)
    && hasId(candidate.destinationSessionId)
    && Number.isInteger(candidate.destinationIndex)
    && candidate.destinationIndex != null
    && candidate.destinationIndex >= 0;
}

function knownStorageError(error: unknown): AppResult<never> | null {
  const message = toErrorMessage(error);
  if (message.startsWith('Session not found:')) {
    return err('session-not-found', 'Saved session was not found.');
  }
  if (message.startsWith('Saved tab not found:')) {
    return err('saved-tab-not-found', 'Saved tab was not found.');
  }
  if (message.startsWith('History entry not found:')) {
    return err('history-entry-not-found', 'History entry was not found.');
  }
  if (message.startsWith('Invalid destination index:')) {
    return err('invalid-saved-move', 'Saved tab move request is invalid.');
  }
  return null;
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
      case 'sessions:open-tab':
        return openSavedTab(message.sessionId, message.tabId, message.consume);
      case 'sessions:restore':
        return restoreSession(message.sessionId);
      case 'sessions:delete-tab':
        if (!hasId(message.sessionId)) {
          return err('session-not-found', 'Saved session was not found.');
        }
        if (!hasId(message.tabId)) {
          return err('saved-tab-not-found', 'Saved tab was not found.');
        }
        await moveSavedTabToHistory(message.sessionId, message.tabId, 'deleted');
        return ok({ deleted: true });
      case 'sessions:delete':
        if (!hasId(message.sessionId)) {
          return err('session-not-found', 'Saved session was not found.');
        }
        await moveSessionToHistory(message.sessionId, 'deleted');
        return ok({ deleted: true });
      case 'sessions:reorder':
        return ok(await reorderSessions(message.orderedIds));
      case 'sessions:move-tab':
        if (!isValidSavedMoveRequest(message.request)) {
          return err('invalid-saved-move', 'Saved tab move request is invalid.');
        }
        await moveSavedTab(message.request);
        return ok({ moved: true });
      case 'history:list':
        return ok(await listHistory());
      case 'history:open-tab':
        return openHistoryTab(message.historyId, message.tabId);
      case 'history:restore':
        if (!hasId(message.historyId)) {
          return err('history-entry-not-found', 'History entry was not found.');
        }
        return ok(await restoreHistoryEntry(message.historyId));
      case 'history:delete':
        if (!hasId(message.historyId)) {
          return err('history-entry-not-found', 'History entry was not found.');
        }
        await deleteHistoryEntry(message.historyId);
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
    return knownStorageError(error) ?? err('unknown-error', toErrorMessage(error));
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
