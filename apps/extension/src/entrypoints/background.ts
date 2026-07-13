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
  sleepActiveTabs,
} from '@/features/active-tabs/active-tabs-service';
import {
  moveActiveTab,
  moveActiveTabGroup,
} from '@/features/active-tabs/active-tab-moves';
import { collapseChromeTabGroups } from '@/features/chrome-tab-groups/chrome-tab-groups';
import { showActionFeedback } from '@/features/action-feedback/action-feedback';
import { getSettings, updateSettings } from '@/features/settings/settings-storage';
import {
  cancelGitHubOAuth,
  chooseAnotherGist,
  rescanGists,
  selectGistTarget,
  startGitHubOAuth,
} from '@/features/sync/connection-service';
import { getConnectionView } from '@/features/sync/connection-store';
import {
  bootstrapSyncCoordinator,
  confirmAndSync,
  disconnectSync,
  handleOAuthAlarm,
  handleSyncAlarm,
  manualPull,
  manualPush,
  noteSynchronizedMutation,
  observeSync,
  OAUTH_ALARM_NAME,
  pollOAuthNow,
  retrySync,
  scheduleOAuthAlarm,
  SYNC_ALARM_NAME,
} from '@/features/sync/sync-coordinator';
import {
  reorderQuickLinks,
  updateQuickLink,
} from '@/features/quick-links/quick-links';
import { updateQuickLinks } from '@/features/quick-links/quick-links-storage';
import { getQuickLinks } from '@/features/quick-links/quick-links-storage';
import {
  getCurrentWindowStowPreview,
  openHistoryTab,
  openSavedTab,
  restoreSession,
  saveCurrentWindowAsSession,
  saveTabsAsSession,
} from '@/features/tabs/session-service';
import {
  err,
  ok,
  toErrorMessage,
  toKnownStorageError,
  type AppResult,
} from '@/lib/errors';
import { browser } from '@/lib/browser';
import type { ExtensionMessage } from '@/lib/messages';
import type { MoveSavedTabRequest } from '@/features/history/types';

function unsupportedMessage(message: { type: unknown }): AppResult<never> {
  return err('unknown-error', `Unsupported extension message: ${String(message.type)}.`);
}

function invalidMessage(type: string): AppResult<never> {
  return err('unknown-error', `Invalid ${type} message.`);
}

async function runBestEffort(operation: () => Promise<unknown>): Promise<void> {
  try {
    await operation();
  } catch {
    // Durable connection and mutation state lets later background triggers recover.
  }
}

function noteSynchronizedMutationBestEffort(): void {
  void runBestEffort(() => Promise.resolve(noteSynchronizedMutation()));
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

async function routeMessage(
  rawMessage: unknown,
  sender?: chrome.runtime.MessageSender,
): Promise<AppResult<unknown>> {
  if (
    !rawMessage
    || typeof rawMessage !== 'object'
    || !('type' in rawMessage)
    || typeof rawMessage.type !== 'string'
  ) {
    return invalidMessage('extension');
  }

  const message = rawMessage as ExtensionMessage;
  try {
    switch (message.type) {
      case 'sessions:list':
        return ok(await listSessions());
      case 'sessions:stow-current-window-preview':
        return getCurrentWindowStowPreview(sender?.tab?.windowId);
      case 'sessions:stow-current-window':
        return saveCurrentWindowAsSession(sender?.tab?.windowId);
      case 'sessions:stow-tab':
        return saveTabsAsSession([message.tabId]);
      case 'sessions:open-tab':
        if (!hasId(message.sessionId)) {
          return err('session-not-found', 'Saved session was not found.');
        }
        if (!hasId(message.tabId)) {
          return err('saved-tab-not-found', 'Saved tab was not found.');
        }
        if (typeof message.consume !== 'boolean') {
          return invalidMessage(message.type);
        }
        return openSavedTab(message.sessionId, message.tabId, message.consume);
      case 'sessions:restore':
        if (!hasId(message.sessionId)) {
          return err('session-not-found', 'Saved session was not found.');
        }
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
        if (!Array.isArray(message.orderedIds) || !message.orderedIds.every(hasId)) {
          return invalidMessage(message.type);
        }
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
        if (!hasId(message.historyId)) {
          return err('history-entry-not-found', 'History entry was not found.');
        }
        if (!hasId(message.tabId)) {
          return err('saved-tab-not-found', 'Saved tab was not found.');
        }
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
      case 'active-tabs:sleep':
        return sleepActiveTabs(message.tabIds);
      case 'active-tabs:search':
        return runDefaultSearch(message.query);
      case 'quick-links:add':
        return ok(await updateQuickLinks((links) => [...links, message.link]));
      case 'quick-links:list':
        return ok(await getQuickLinks());
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
      case 'connection:get':
        return ok(await getConnectionView());
      case 'oauth:start': {
        const started = await startGitHubOAuth();
        await runBestEffort(scheduleOAuthAlarm);
        return ok(started.view);
      }
      case 'oauth:poll':
        return ok(await pollOAuthNow());
      case 'oauth:cancel': {
        const view = await cancelGitHubOAuth();
        await runBestEffort(() => browser.alarms.clear(OAUTH_ALARM_NAME));
        return ok(view);
      }
      case 'gist:rescan':
        return ok(await rescanGists());
      case 'gist:select':
        if (!hasId(message.gistId)) return invalidMessage(message.type);
        return ok(
          await selectGistTarget({
            gistId: message.gistId,
            ...(message.fileName ? { fileName: message.fileName } : {}),
          }),
        );
      case 'gist:confirm':
        if (!hasId(message.targetKey)) return invalidMessage(message.type);
        return ok(await confirmAndSync(message.targetKey));
      case 'gist:choose-another':
        return ok(await chooseAnotherGist());
      case 'sync:observe':
        if (message.reason !== 'open' && message.reason !== 'focus') {
          return invalidMessage(message.type);
        }
        return ok(await observeSync(message.reason));
      case 'sync:retry':
        return retrySync();
      case 'sync:disconnect': {
        return ok(await disconnectSync());
      }
      case 'sync:push':
        return manualPush();
      case 'sync:pull':
        return manualPull();
      default:
        return unsupportedMessage(message);
    }
  } catch (error) {
    return toKnownStorageError(error) ?? err('unknown-error', toErrorMessage(error));
  }
}

const SYNC_MUTATION_MESSAGES = new Set<ExtensionMessage['type']>([
  'sessions:stow-current-window',
  'sessions:stow-tab',
  'sessions:restore',
  'sessions:delete-tab',
  'sessions:delete',
  'sessions:reorder',
  'sessions:move-tab',
  'history:restore',
  'quick-links:add',
  'quick-links:update',
  'quick-links:remove',
  'quick-links:reorder',
  'settings:update',
]);

async function handleMessage(
  rawMessage: unknown,
  sender?: chrome.runtime.MessageSender,
): Promise<AppResult<unknown>> {
  const response = await routeMessage(rawMessage, sender);
  if (
    response.ok &&
    rawMessage &&
    typeof rawMessage === 'object' &&
    'type' in rawMessage &&
    typeof rawMessage.type === 'string' &&
    (SYNC_MUTATION_MESSAGES.has(rawMessage.type as ExtensionMessage['type']) ||
      (rawMessage.type === 'sessions:open-tab' &&
        'consume' in rawMessage &&
        rawMessage.consume === true))
  ) {
    noteSynchronizedMutationBestEffort();
  }
  return response;
}

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(() => {
    void registerContextMenu();
    void bootstrapSyncCoordinator();
  });

  browser.runtime.onStartup.addListener(() => {
    void registerContextMenu();
    void bootstrapSyncCoordinator();
  });

  registerContextMenuClickHandler();
  void bootstrapSyncCoordinator();

  browser.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === SYNC_ALARM_NAME) {
      await handleSyncAlarm();
    } else if (alarm.name === OAUTH_ALARM_NAME) {
      await handleOAuthAlarm();
    }
  });

  browser.action.onClicked.addListener(async (tab) => {
    const result = await saveCurrentWindowAsSession(tab.windowId);
    showActionFeedback(result);
    if (result.ok) noteSynchronizedMutationBestEffort();
  });

  browser.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    void handleMessage(message, sender).then(
      sendResponse,
      (error) => sendResponse(err('unknown-error', toErrorMessage(error))),
    );
    return true;
  });
});
