import type { ExtensionSettings, TabSession } from '@tabstow/core';
import type {
  ActiveBrowserTab,
  ActiveGroupMoveRequest,
  ActiveTabMoveRequest,
  ActiveTabsMoveResult,
  ActiveTabsSleepResult,
  ActiveTabsSnapshot,
} from '@/features/active-tabs/types';
import type { QuickLink, QuickLinkIcon } from '@/features/quick-links/quick-links';
import type { HistoryEntry, MoveSavedTabRequest } from '@/features/history/types';
import type {
  ConnectionView,
  SyncResult,
  SyncStatusView,
} from '@/features/sync/sync-types';
import type {
  TabLifecyclePolicy,
  TabLifecycleState,
} from '@/features/tab-lifecycle/types';
import { err, toErrorMessage, type AppResult } from './errors';
import { browser } from './browser';

export type StowResult = {
  session: TabSession;
  savedTabCount: number;
  closedTabCount: number;
};

export type StowPreview = {
  eligibleTabCount: number;
};

export type { SyncResult } from '@/features/sync/sync-types';

export type ExtensionMessage =
  | { type: 'sessions:list' }
  | { type: 'sessions:stow-current-window-preview' }
  | { type: 'sessions:stow-current-window' }
  | { type: 'sessions:stow-tab'; tabId: number }
  | { type: 'sessions:open-tab'; sessionId: string; tabId: string; consume: boolean }
  | { type: 'sessions:restore'; sessionId: string }
  | { type: 'sessions:delete-tab'; sessionId: string; tabId: string }
  | { type: 'sessions:delete'; sessionId: string }
  | { type: 'sessions:reorder'; orderedIds: string[] }
  | { type: 'sessions:move-tab'; request: MoveSavedTabRequest }
  | { type: 'history:list' }
  | { type: 'history:open-tab'; historyId: string; tabId: string }
  | { type: 'history:restore'; historyId: string }
  | { type: 'history:delete'; historyId: string }
  | { type: 'active-tabs:list' }
  | { type: 'active-tabs:snapshot' }
  | { type: 'active-tabs:move-tab'; request: ActiveTabMoveRequest }
  | { type: 'active-tabs:move-group'; request: ActiveGroupMoveRequest }
  | { type: 'active-tabs:focus'; tabId: number; windowId: number }
  | { type: 'active-tabs:close'; tabIds: number[] }
  | { type: 'active-tabs:sleep'; tabIds: number[] }
  | { type: 'active-tabs:search'; query: string }
  | { type: 'tab-lifecycle:get-state' }
  | { type: 'tab-lifecycle:update-policy'; policy: TabLifecyclePolicy }
  | { type: 'quick-links:add'; link: QuickLink }
  | { type: 'quick-links:list' }
  | { type: 'quick-links:update'; linkId: string; patch: { label?: string; icon?: QuickLinkIcon | null } }
  | { type: 'quick-links:remove'; linkId: string }
  | { type: 'quick-links:reorder'; orderedIds: string[] }
  | { type: 'chrome-tab-groups:collapse-window'; windowId: number }
  | { type: 'settings:get' }
  | { type: 'settings:update'; settings: Partial<ExtensionSettings> }
  | { type: 'connection:get' }
  | { type: 'oauth:start' }
  | { type: 'oauth:poll' }
  | { type: 'oauth:cancel' }
  | { type: 'gist:rescan' }
  | { type: 'gist:select'; gistId: string; fileName?: string }
  | { type: 'gist:confirm'; targetKey: string }
  | { type: 'gist:choose-another' }
  | { type: 'sync:observe'; reason: 'open' | 'focus' }
  | { type: 'sync:retry' }
  | { type: 'sync:disconnect' }
  | { type: 'sync:push' }
  | { type: 'sync:pull' };

export type ExtensionEvent =
  | { type: 'sync:data-changed' }
  | { type: 'sync:status-changed'; status: SyncStatusView }
  | { type: 'connection:state-changed' };

export type ExtensionMessageResponse =
  | AppResult<TabSession[]>
  | AppResult<TabSession>
  | AppResult<StowResult>
  | AppResult<StowPreview>
  | AppResult<HistoryEntry[]>
  | AppResult<ActiveBrowserTab[]>
  | AppResult<ActiveTabsMoveResult>
  | AppResult<ActiveTabsSleepResult>
  | AppResult<ActiveTabsSnapshot>
  | AppResult<TabLifecycleState>
  | AppResult<QuickLink[]>
  | AppResult<ExtensionSettings>
  | AppResult<ConnectionView>
  | AppResult<SyncResult>
  | AppResult<{ deleted: true }>
  | AppResult<{ opened: true }>
  | AppResult<{ opened: true; consumed: boolean }>
  | AppResult<{ moved: true }>
  | AppResult<{ focused: true }>
  | AppResult<{ closed: true; tabCount: number }>
  | AppResult<{ collapsed: true; groupCount: number }>
  | AppResult<{ searched: true }>
  | AppResult<{ restored: true; tabCount: number }>;

function isExtensionMessageResponse(response: unknown): response is ExtensionMessageResponse {
  if (!response || typeof response !== 'object') return false;

  const result = response as {
    data?: unknown;
    error?: { code?: unknown; message?: unknown };
    ok?: unknown;
  };
  if (result.ok === true) return 'data' in result;

  const error = result.error as { code?: unknown; message?: unknown } | undefined;
  return result.ok === false && typeof error?.code === 'string' && typeof error.message === 'string';
}

export async function sendExtensionMessage<T extends ExtensionMessageResponse = ExtensionMessageResponse>(
  message: ExtensionMessage,
): Promise<T> {
  try {
    const response = await browser.runtime.sendMessage(message);
    if (isExtensionMessageResponse(response)) return response as T;

    return err(
      'unknown-error',
      'Extension background did not return a valid response. Reload Tabstow from chrome://extensions and try again.',
    ) as T;
  } catch (error) {
    return err('unknown-error', toErrorMessage(error)) as T;
  }
}
