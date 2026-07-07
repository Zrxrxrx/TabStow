import type { ExtensionSettings, TabSession } from '@tabstow/core';
import type { ChromeTabGroupsState } from '@/features/active-tabs/active-workspace-storage';
import type {
  ActiveBrowserTab,
  ActiveTabGroup,
  ManualGroupsState,
} from '@/features/active-tabs/types';
import type { ImportedChromeGroupsResult } from '@/features/chrome-tab-groups/chrome-tab-groups';
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
  | { type: 'active-tabs:focus'; tabId: number; windowId: number }
  | { type: 'active-tabs:close'; tabIds: number[] }
  | { type: 'active-tabs:search'; query: string }
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

export async function sendExtensionMessage<T extends ExtensionMessageResponse = ExtensionMessageResponse>(
  message: ExtensionMessage,
): Promise<T> {
  try {
    return (await browser.runtime.sendMessage(message)) as T;
  } catch (error) {
    return err('unknown-error', toErrorMessage(error)) as T;
  }
}
