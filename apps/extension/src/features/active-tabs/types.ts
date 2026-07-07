export type ActiveBrowserTab = Pick<
  chrome.tabs.Tab,
  'active' | 'favIconUrl' | 'groupId' | 'id' | 'index' | 'pinned' | 'title' | 'url' | 'windowId'
>;

export type ManualTabGroup = {
  id: string;
  name: string;
  createdAt: string;
};

export type ManualGroupsState = {
  groups: ManualTabGroup[];
  assignments: Record<string, string>;
};

export type ActiveWorkspaceOrderState = {
  groupOrder: string[];
  pinnedGroupKeys: string[];
  groupTabOrder: Record<string, string[]>;
};

export type ChromeTabGroupInfo = Pick<
  chrome.tabGroups.TabGroup,
  'id' | 'windowId' | 'title' | 'color' | 'collapsed'
>;

export type ActiveTabsSnapshot = {
  tabs: ActiveBrowserTab[];
  chromeGroups: ChromeTabGroupInfo[];
};

export type ActiveTabGroupKind = 'chrome' | 'landing' | 'manual' | 'domain';

export type ActiveTabGroup = {
  key: string;
  kind: ActiveTabGroupKind;
  title: string;
  tabs: ActiveBrowserTab[];
  pinned: boolean;
};

export type DuplicateTabGroup = {
  url: string;
  keepTabId: number;
  duplicateTabIds: number[];
};
