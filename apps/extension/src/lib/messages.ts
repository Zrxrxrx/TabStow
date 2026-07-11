import type { ExtensionSettings, TabSession } from '@tabstow/core';
import type { ChromeTabGroupsState } from '@/features/active-tabs/active-workspace-storage';
import type {
  ActiveBrowserTab,
  ActiveGroupMoveRequest,
  ActiveTabGroup,
  ActiveTabMoveRequest,
  ActiveTabsMoveResult,
  ActiveTabsSnapshot,
  ManualGroupsState,
} from '@/features/active-tabs/types';
import type { ImportedChromeGroupsResult } from '@/features/chrome-tab-groups/chrome-tab-groups';
import type { QuickLink, QuickLinkIcon } from '@/features/quick-links/quick-links';
import { err, toErrorMessage, type AppResult } from './errors';
import { browser } from './browser';

export type RestoreMode = 'current-window' | 'new-window';

export type StowResult = {
  session: TabSession;
  savedTabCount: number;
  closedTabCount: number;
};

export type SyncResult = {
  sessionCount: number;
  quickLinkCount: number;
  exportedAt?: string;
  importedAt?: string;
};

export type ExtensionMessage =
  | { type: 'sessions:list' }
  | { type: 'sessions:stow-current-window' }
  | { type: 'sessions:stow-tab'; tabId: number }
  | { type: 'sessions:restore'; sessionId: string; mode: RestoreMode }
  | { type: 'sessions:delete'; sessionId: string }
  | { type: 'active-tabs:list' }
  | { type: 'active-tabs:snapshot' }
  | { type: 'active-tabs:move-tab'; request: ActiveTabMoveRequest }
  | { type: 'active-tabs:move-group'; request: ActiveGroupMoveRequest }
  | { type: 'active-tabs:focus'; tabId: number; windowId: number }
  | { type: 'active-tabs:close'; tabIds: number[] }
  | { type: 'active-tabs:search'; query: string }
  | { type: 'quick-links:add'; link: QuickLink }
  | { type: 'quick-links:update'; linkId: string; patch: { label?: string; icon?: QuickLinkIcon | null } }
  | { type: 'quick-links:remove'; linkId: string }
  | { type: 'quick-links:reorder'; orderedIds: string[] }
  | { type: 'chrome-tab-groups:sync'; groups: ActiveTabGroup[]; state: ChromeTabGroupsState }
  | {
      type: 'chrome-tab-groups:import';
      tabs: ActiveBrowserTab[];
      manualGroups: ManualGroupsState;
      state: ChromeTabGroupsState;
    }
  | { type: 'chrome-tab-groups:collapse-window'; windowId: number }
  | { type: 'settings:get' }
  | { type: 'settings:update'; settings: Partial<ExtensionSettings> }
  | { type: 'sync:push' }
  | { type: 'sync:pull' };

export type ExtensionMessageResponse =
  | AppResult<TabSession[]>
  | AppResult<TabSession>
  | AppResult<StowResult>
  | AppResult<ActiveBrowserTab[]>
  | AppResult<ActiveTabsMoveResult>
  | AppResult<ActiveTabsSnapshot>
  | AppResult<QuickLink[]>
  | AppResult<ExtensionSettings>
  | AppResult<SyncResult>
  | AppResult<ChromeTabGroupsState>
  | AppResult<ImportedChromeGroupsResult>
  | AppResult<{ deleted: true }>
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
