import type { ActiveBrowserTab, DuplicateTabGroup } from './types';

function compareTabs(a: ActiveBrowserTab, b: ActiveBrowserTab): number {
  return (a.windowId ?? 0) - (b.windowId ?? 0)
    || (a.index ?? 0) - (b.index ?? 0)
    || (a.id ?? 0) - (b.id ?? 0);
}

export function findDuplicateTabGroups(tabs: ActiveBrowserTab[]): DuplicateTabGroup[] {
  const byUrl = new Map<string, ActiveBrowserTab[]>();
  for (const tab of tabs) {
    if (!tab.url || tab.id == null) continue;
    byUrl.set(tab.url, [...(byUrl.get(tab.url) ?? []), tab]);
  }
  return Array.from(byUrl.entries())
    .filter(([, matches]) => matches.length > 1)
    .map(([url, matches]) => {
      const ordered = [...matches].sort(compareTabs);
      return {
        url,
        keepTabId: ordered[0]?.id as number,
        duplicateTabIds: ordered.slice(1).map((tab) => tab.id as number),
      };
    });
}
