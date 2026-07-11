import type {
  ActiveBrowserTab,
  ActiveChromeGroupItem,
  ActiveTabsSnapshot,
  ActiveTabWindow,
  ActiveWindowItem,
  ChromeTabGroupInfo,
} from './types';

function compareTabs(a: ActiveBrowserTab, b: ActiveBrowserTab): number {
  return (a.index ?? 0) - (b.index ?? 0) || (a.id ?? 0) - (b.id ?? 0);
}

function groupKey(windowId: number, groupId: number): string {
  return `chrome:${windowId}:${groupId}`;
}

function groupMetadataByKey(
  groups: ChromeTabGroupInfo[],
): Map<string, ChromeTabGroupInfo> {
  return new Map(groups.map((group) => [groupKey(group.windowId, group.id), group]));
}

function isVisibleTab(tab: ActiveBrowserTab, windowId: number): boolean {
  return tab.windowId === windowId && typeof tab.id === 'number' && Boolean(tab.url);
}

export function buildActiveTabWindows(snapshot: ActiveTabsSnapshot): ActiveTabWindow[] {
  const metadata = groupMetadataByKey(snapshot.chromeGroups);

  return [...snapshot.windows]
    .sort((a, b) => Number(b.focused) - Number(a.focused) || a.id - b.id)
    .map((window): ActiveTabWindow => {
      const tabs = snapshot.tabs
        .filter((tab) => isVisibleTab(tab, window.id))
        .sort(compareTabs);
      const pinnedTabs = tabs.filter((tab) => tab.pinned);
      const unpinnedTabs = tabs.filter((tab) => !tab.pinned);
      const seenGroupIds = new Set<number>();
      const items: ActiveWindowItem[] = [];

      for (const tab of unpinnedTabs) {
        const groupId = typeof tab.groupId === 'number' ? tab.groupId : -1;
        if (groupId < 0) {
          items.push({ kind: 'tab', key: `tab:${tab.id}`, tab });
          continue;
        }

        if (seenGroupIds.has(groupId)) continue;
        seenGroupIds.add(groupId);

        const groupTabs = unpinnedTabs
          .filter((candidate) => candidate.groupId === groupId)
          .sort(compareTabs);
        const nativeGroup = metadata.get(groupKey(window.id, groupId));
        const item: ActiveChromeGroupItem = {
          kind: 'group',
          key: groupKey(window.id, groupId),
          windowId: window.id,
          groupId,
          title: nativeGroup?.title?.trim() || null,
          color: nativeGroup?.color ?? null,
          collapsed: nativeGroup?.collapsed ?? null,
          tabs: groupTabs,
        };
        items.push(item);
      }

      return {
        key: `window:${window.id}`,
        windowId: window.id,
        focused: window.focused,
        incognito: window.incognito,
        visibleTabCount: tabs.length,
        pinnedTabs,
        items,
      };
    })
    .filter((window) => window.visibleTabCount > 0);
}
