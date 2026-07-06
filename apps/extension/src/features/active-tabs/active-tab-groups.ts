import { getTabHostname, friendlyDomain, isLandingPage } from './tab-labels';
import type {
  ActiveBrowserTab,
  ActiveTabGroup,
  ActiveWorkspaceOrderState,
  DuplicateTabGroup,
  ManualGroupsState,
} from './types';

const LANDING_GROUP_KEY = 'landing:homepages';

function tabId(tab: Pick<ActiveBrowserTab, 'id'>): string {
  return String(tab.id);
}

function sortTabsByOrder(tabs: ActiveBrowserTab[], orderIds: string[] | undefined): ActiveBrowserTab[] {
  if (!orderIds?.length) return [...tabs].sort((a, b) => a.index - b.index);
  const byId = new Map(tabs.map((tab) => [tabId(tab), tab]));
  const ordered = orderIds.map((id) => byId.get(id)).filter((tab): tab is ActiveBrowserTab => Boolean(tab));
  const orderedIds = new Set(ordered.map(tabId));
  const rest = tabs.filter((tab) => !orderedIds.has(tabId(tab))).sort((a, b) => a.index - b.index);
  return [...ordered, ...rest];
}

function orderGroups(groups: ActiveTabGroup[], orderState: ActiveWorkspaceOrderState): ActiveTabGroup[] {
  const byKey = new Map(groups.map((group) => [group.key, group]));
  const ordered = orderState.groupOrder.map((key) => byKey.get(key)).filter((group): group is ActiveTabGroup => Boolean(group));
  const orderedKeys = new Set(ordered.map((group) => group.key));
  const rest = groups.filter((group) => !orderedKeys.has(group.key)).sort((a, b) => a.title.localeCompare(b.title));
  const all = [...ordered, ...rest].map((group) => ({
    ...group,
    pinned: orderState.pinnedGroupKeys.includes(group.key),
    tabs: sortTabsByOrder(group.tabs, orderState.groupTabOrder[group.key]),
  }));
  return all.sort((a, b) => Number(b.pinned) - Number(a.pinned));
}

export function buildActiveTabGroups(
  tabs: ActiveBrowserTab[],
  manualState: ManualGroupsState,
  orderState: ActiveWorkspaceOrderState,
): ActiveTabGroup[] {
  const groups = new Map<string, ActiveTabGroup>();
  const manualGroupsById = new Map(manualState.groups.map((group) => [group.id, group]));

  for (const tab of tabs) {
    if (tab.id == null || !tab.url) continue;

    const manualGroupId = manualState.assignments[String(tab.id)];
    const manualGroup = manualGroupId ? manualGroupsById.get(manualGroupId) : undefined;
    const key = manualGroup
      ? `manual:${manualGroup.id}`
      : isLandingPage(tab.url)
        ? LANDING_GROUP_KEY
        : `domain:${getTabHostname(tab) || 'unknown'}`;

    const title = manualGroup
      ? manualGroup.name
      : key === LANDING_GROUP_KEY
        ? 'Homepages'
        : friendlyDomain(key.replace(/^domain:/, '')) || 'Other';

    const kind = manualGroup ? 'manual' : key === LANDING_GROUP_KEY ? 'landing' : 'domain';
    const current = groups.get(key) ?? { key, kind, title, tabs: [], pinned: false };
    current.tabs.push(tab);
    groups.set(key, current);
  }

  return orderGroups(Array.from(groups.values()), orderState);
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
      const ordered = [...matches].sort((a, b) => a.index - b.index);
      return {
        url,
        keepTabId: ordered[0].id as number,
        duplicateTabIds: ordered.slice(1).map((tab) => tab.id as number),
      };
    });
}
