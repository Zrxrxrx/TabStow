export type ActiveBrowserTab = Pick<
  chrome.tabs.Tab,
  | 'active'
  | 'audible'
  | 'favIconUrl'
  | 'groupId'
  | 'id'
  | 'index'
  | 'pinned'
  | 'title'
  | 'url'
  | 'windowId'
> & {
  discarded?: boolean;
};

export type ChromeTabGroupInfo = Pick<
  chrome.tabGroups.TabGroup,
  'id' | 'windowId' | 'title' | 'color' | 'collapsed'
>;

export type ActiveChromeWindowInfo = {
  id: number;
  focused: boolean;
  incognito: boolean;
  type: 'normal';
};

export type ActiveTabsSnapshot = {
  windows: ActiveChromeWindowInfo[];
  tabs: ActiveBrowserTab[];
  chromeGroups: ChromeTabGroupInfo[];
};

export type ActiveTabItem = {
  kind: 'tab';
  key: string;
  tab: ActiveBrowserTab;
};

export type ActiveChromeGroupItem = {
  kind: 'group';
  key: string;
  windowId: number;
  groupId: number;
  title: string | null;
  color: ChromeTabGroupInfo['color'] | null;
  collapsed: boolean | null;
  tabs: ActiveBrowserTab[];
};

export type ActiveWindowItem = ActiveTabItem | ActiveChromeGroupItem;

export type ActiveTabWindow = {
  key: string;
  windowId: number;
  focused: boolean;
  incognito: boolean;
  visibleTabCount: number;
  pinnedTabs: ActiveBrowserTab[];
  items: ActiveWindowItem[];
};

export type DuplicateTabGroup = {
  url: string;
  keepTabId: number;
  duplicateTabIds: number[];
};

export type ActiveTabLane =
  | { kind: 'pinned' }
  | { kind: 'ungrouped' }
  | { kind: 'group'; groupId: number };

export type ActiveTabsAnchor =
  | { kind: 'tab'; tabId: number }
  | { kind: 'group'; groupId: number };

export type ActiveTabsPosition =
  | { kind: 'before' | 'after'; anchor: ActiveTabsAnchor }
  | { kind: 'end' };

export type ActiveTabMoveRequest = {
  tabId: number;
  destination: {
    windowId: number;
    lane: ActiveTabLane;
    position: ActiveTabsPosition;
  };
};

export type ActiveGroupMoveRequest = {
  groupId: number;
  sourceWindowId: number;
  destination: {
    windowId: number;
    position: ActiveTabsPosition;
  };
};

export type ActiveTabsMoveResult = { moved: boolean };

export type ActiveTabsSleepResult = {
  sleptTabIds: number[];
  skippedTabIds: number[];
  failures: Array<{ tabId: number; message: string }>;
};

export type ActiveTabsDragSource =
  | { kind: 'tab'; tabId: number; windowId: number; pinned: boolean; incognito: boolean }
  | { kind: 'group'; groupId: number; windowId: number; incognito: boolean };
