import {
  addManualGroup,
  assignTabToManualGroup,
} from '@/features/active-tabs/manual-groups';
import type {
  ActiveBrowserTab,
  ActiveTabGroup,
  ManualGroupsState,
} from '@/features/active-tabs/types';
import type { ChromeTabGroupsState } from '@/features/active-tabs/active-workspace-storage';
import { browser } from '@/lib/browser';
import { err, ok, toErrorMessage, type AppResult } from '@/lib/errors';

export type ImportedChromeGroupsResult = {
  manualGroups: ManualGroupsState;
  chromeTabGroups: ChromeTabGroupsState;
};

type GroupableTabIds = number | [number, ...number[]];

function getTabsByWindow(group: ActiveTabGroup): Array<{ windowId: number; tabIds: number[] }> {
  const tabIdsByWindow = new Map<number, number[]>();

  for (const tab of group.tabs) {
    if (typeof tab.id !== 'number' || typeof tab.windowId !== 'number') {
      continue;
    }

    const tabIds = tabIdsByWindow.get(tab.windowId) ?? [];
    tabIds.push(tab.id);
    tabIdsByWindow.set(tab.windowId, tabIds);
  }

  return Array.from(tabIdsByWindow.entries()).map(([windowId, tabIds]) => ({ windowId, tabIds }));
}

function isMissingChromeGroupError(error: unknown): boolean {
  return /no group with id/i.test(toErrorMessage(error));
}

function toGroupableTabIds(tabIds: number[]): GroupableTabIds | null {
  const [first, ...rest] = tabIds;
  if (typeof first !== 'number') {
    return null;
  }

  return rest.length === 0 ? first : [first, ...rest];
}

async function createChromeGroup(tabIds: GroupableTabIds): Promise<number> {
  return await (browser.tabs.group({ tabIds }) as Promise<number>);
}

async function groupTabsIntoChromeGroup(
  tabIds: number[],
  existingChromeGroupId?: number,
): Promise<{ chromeGroupId: number; reusedExistingGroup: boolean }> {
  const groupableTabIds = toGroupableTabIds(tabIds);
  if (groupableTabIds === null) {
    throw new Error('Cannot create a Chrome tab group without tabs');
  }

  if (typeof existingChromeGroupId !== 'number') {
    return {
      chromeGroupId: await createChromeGroup(groupableTabIds),
      reusedExistingGroup: false,
    };
  }

  try {
    await (browser.tabs.group({
      groupId: existingChromeGroupId,
      tabIds: groupableTabIds,
    }) as Promise<number> | void);
    return {
      chromeGroupId: existingChromeGroupId,
      reusedExistingGroup: true,
    };
  } catch (error) {
    if (!isMissingChromeGroupError(error)) {
      throw error;
    }

    return {
      chromeGroupId: await createChromeGroup(groupableTabIds),
      reusedExistingGroup: false,
    };
  }
}

export async function syncChromeTabGroups(
  groups: ActiveTabGroup[],
  state: ChromeTabGroupsState,
): Promise<AppResult<ChromeTabGroupsState>> {
  if (!state.enabled) {
    return ok(state);
  }

  try {
    const nextMappings: ChromeTabGroupsState['mappings'] = [];

    for (const group of groups.filter((item) => item.kind === 'manual')) {
      for (const { windowId, tabIds } of getTabsByWindow(group)) {
        const existing = state.mappings.find(
          (mapping) => mapping.virtualGroupKey === group.key && mapping.windowId === windowId,
        );
        const { chromeGroupId, reusedExistingGroup } = await groupTabsIntoChromeGroup(
          tabIds,
          existing?.chromeGroupId,
        );

        if (reusedExistingGroup) {
          const currentTabs = await browser.tabs.query({ groupId: chromeGroupId });
          const desiredTabIds = new Set(tabIds);
          const extraTabIds = currentTabs
            .map((tab) => tab.id)
            .filter((tabId): tabId is number => typeof tabId === 'number' && !desiredTabIds.has(tabId));
          const groupableExtraTabIds = toGroupableTabIds(extraTabIds);

          if (groupableExtraTabIds !== null) {
            await browser.tabs.ungroup(groupableExtraTabIds);
          }
        }

        await browser.tabGroups.update(chromeGroupId, { title: group.title, collapsed: true });
        nextMappings.push({
          virtualGroupKey: group.key,
          windowId,
          chromeGroupId,
        });
      }
    }

    return ok({ enabled: true, mappings: nextMappings });
  } catch (error) {
    return err('chrome-tabs-error', toErrorMessage(error));
  }
}

export async function collapseChromeTabGroups(
  windowId: number,
): Promise<AppResult<{ collapsed: true; groupCount: number }>> {
  try {
    const groups = await browser.tabGroups.query({});
    const matchingGroups = groups.filter((group) => group.windowId === windowId);

    await Promise.all(
      matchingGroups.map((group) => browser.tabGroups.update(group.id, { collapsed: true })),
    );

    return ok({ collapsed: true, groupCount: matchingGroups.length });
  } catch (error) {
    return err('chrome-tabs-error', toErrorMessage(error));
  }
}

export async function importChromeTabGroups(
  tabs: ActiveBrowserTab[],
  manualGroups: ManualGroupsState,
  state: ChromeTabGroupsState,
  createId: () => string = () => crypto.randomUUID(),
): Promise<AppResult<ImportedChromeGroupsResult>> {
  try {
    const chromeGroups = await browser.tabGroups.query({});
    let nextManualGroups = manualGroups;
    const mappings = state.mappings.map((mapping) => ({ ...mapping }));
    const replacementGroupIdsByStaleKey = new Map<string, string>();

    for (const chromeGroup of chromeGroups) {
      const groupTabs = tabs.filter((tab) => tab.groupId === chromeGroup.id && typeof tab.id === 'number');

      if (groupTabs.length === 0) {
        continue;
      }

      const existingMapping = mappings.find((mapping) => mapping.chromeGroupId === chromeGroup.id);
      const mappedVirtualGroupKey = existingMapping?.virtualGroupKey ?? '';
      let manualGroupId = mappedVirtualGroupKey.replace(/^manual:/, '');
      const hasExistingManualGroup = nextManualGroups.groups.some((group) => group.id === manualGroupId);

      if (!manualGroupId || !hasExistingManualGroup) {
        const replacementGroupId = replacementGroupIdsByStaleKey.get(mappedVirtualGroupKey);
        if (replacementGroupId) {
          manualGroupId = replacementGroupId;
        } else {
          const baseName = chromeGroup.title?.trim() || `Chrome group ${chromeGroup.id}`;
          const name = nextManualGroups.groups.some(
            (group) => group.name.toLowerCase() === baseName.toLowerCase(),
          )
            ? `${baseName} ${chromeGroup.id}`
            : baseName;
          const created = addManualGroup(nextManualGroups, name, createId);
          nextManualGroups = created.state;
          manualGroupId = created.group.id;
          if (mappedVirtualGroupKey) {
            replacementGroupIdsByStaleKey.set(mappedVirtualGroupKey, manualGroupId);
          }
        }
      }

      for (const tab of groupTabs) {
        nextManualGroups = assignTabToManualGroup(nextManualGroups, tab.id as number, manualGroupId);
      }

      if (!existingMapping) {
        mappings.push({
          virtualGroupKey: `manual:${manualGroupId}`,
          windowId: chromeGroup.windowId,
          chromeGroupId: chromeGroup.id,
        });
      } else {
        existingMapping.virtualGroupKey = `manual:${manualGroupId}`;
        existingMapping.windowId = chromeGroup.windowId;
      }
    }

    return ok({
      manualGroups: nextManualGroups,
      chromeTabGroups: { enabled: state.enabled, mappings },
    });
  } catch (error) {
    return err('chrome-tabs-error', toErrorMessage(error));
  }
}
