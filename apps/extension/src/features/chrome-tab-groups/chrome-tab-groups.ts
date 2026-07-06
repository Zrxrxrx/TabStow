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

function getTabIds(group: ActiveTabGroup): number[] {
  return group.tabs.map((tab) => tab.id).filter((id): id is number => typeof id === 'number');
}

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

async function groupTabsIntoChromeGroup(
  tabIds: number[],
  existingChromeGroupId?: number,
): Promise<number> {
  if (typeof existingChromeGroupId !== 'number') {
    return browser.tabs.group({ tabIds });
  }

  try {
    await browser.tabs.group({ groupId: existingChromeGroupId, tabIds });
    return existingChromeGroupId;
  } catch {
    return browser.tabs.group({ tabIds });
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
        const chromeGroupId = await groupTabsIntoChromeGroup(tabIds, existing?.chromeGroupId);

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

    for (const chromeGroup of chromeGroups) {
      const groupTabs = tabs.filter((tab) => tab.groupId === chromeGroup.id && typeof tab.id === 'number');

      if (groupTabs.length === 0) {
        continue;
      }

      const existingMapping = mappings.find((mapping) => mapping.chromeGroupId === chromeGroup.id);
      let manualGroupId = existingMapping?.virtualGroupKey.replace(/^manual:/, '') ?? '';

      if (!manualGroupId || !nextManualGroups.groups.some((group) => group.id === manualGroupId)) {
        const baseName = chromeGroup.title?.trim() || `Chrome group ${chromeGroup.id}`;
        const name = nextManualGroups.groups.some((group) => group.name.toLowerCase() === baseName.toLowerCase())
          ? `${baseName} ${chromeGroup.id}`
          : baseName;
        const created = addManualGroup(nextManualGroups, name, createId);
        nextManualGroups = created.state;
        manualGroupId = created.group.id;
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
