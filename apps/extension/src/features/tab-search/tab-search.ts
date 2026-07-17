import type { TabSession } from '@tabstow/core';
import { getTabLabel } from '@/features/active-tabs/tab-labels';
import type { ActiveBrowserTab, ActiveTabsSnapshot } from '@/features/active-tabs/types';

function normalizedQuery(query: string): string {
  return query.trim().toLowerCase();
}

function matchesTab(tab: Pick<ActiveBrowserTab, 'title' | 'url'>, query: string): boolean {
  return (
    (tab.title ?? '').toLowerCase().includes(query) ||
    (tab.url ?? '').toLowerCase().includes(query)
  );
}

export type UnifiedSearchSuggestion =
  | {
      key: string;
      source: 'active';
      tabId: number;
      windowId: number;
      title: string;
      url: string;
      favIconUrl?: string;
      context: ActiveTabContext;
    }
  | {
      key: string;
      source: 'saved';
      sessionId: string;
      tabId: string;
      title: string;
      url: string;
      favIconUrl?: string;
      context: SavedTabContext;
    };

export type ActiveTabContext = {
  currentWindow: boolean;
  windowNumber: number;
  lane:
    | { kind: 'group'; title: string | null }
    | { kind: 'pinned' }
    | { kind: 'ungrouped' };
};

export type SavedTabContext = {
  sessionTitle: string;
  tabCount: number;
};

export type OpenTabChoice = {
  key: string;
  tab: ActiveBrowserTab;
  label: string;
  context: ActiveTabContext;
};

export type OpenTabChoices = {
  choices: OpenTabChoice[];
  overflow: boolean;
};

type ActiveTabContextIndex = {
  focusedWindowIds: ReadonlySet<number>;
  groupTitleByKey: ReadonlyMap<string, string | null>;
  windowNumberById: ReadonlyMap<number, number>;
};

function buildActiveTabContextIndex(snapshot: ActiveTabsSnapshot): ActiveTabContextIndex {
  const visibleWindowIds = new Set<number>();
  for (const tab of snapshot.tabs) {
    if (typeof tab.id === 'number' && tab.url) visibleWindowIds.add(tab.windowId);
  }
  const orderedWindows = [...snapshot.windows].sort(
    (left, right) => Number(right.focused) - Number(left.focused) || left.id - right.id,
  );
  const windowNumberById = new Map<number, number>();
  for (const window of orderedWindows) {
    if (visibleWindowIds.has(window.id)) {
      windowNumberById.set(window.id, windowNumberById.size + 1);
    }
  }
  for (const window of orderedWindows) {
    if (!windowNumberById.has(window.id)) {
      windowNumberById.set(window.id, windowNumberById.size + 1);
    }
  }
  for (const tab of snapshot.tabs) {
    if (!windowNumberById.has(tab.windowId)) {
      windowNumberById.set(tab.windowId, windowNumberById.size + 1);
    }
  }

  const groupTitleByKey = new Map(
    snapshot.chromeGroups.map((group) => [
      `${group.windowId}:${group.id}`,
      group.title?.trim() || null,
    ]),
  );
  const focusedWindowIds = new Set(
    snapshot.windows.filter((window) => window.focused).map((window) => window.id),
  );

  return { focusedWindowIds, groupTitleByKey, windowNumberById };
}

function resolveActiveTabContext(
  index: ActiveTabContextIndex,
  tab: ActiveBrowserTab,
): ActiveTabContext {
  const groupTitle =
    typeof tab.groupId === 'number' && tab.groupId >= 0
      ? index.groupTitleByKey.get(`${tab.windowId}:${tab.groupId}`) ?? null
      : undefined;
  const lane: ActiveTabContext['lane'] =
    groupTitle !== undefined
      ? { kind: 'group', title: groupTitle }
      : tab.pinned
        ? { kind: 'pinned' }
        : { kind: 'ungrouped' };

  return {
    currentWindow: index.focusedWindowIds.has(tab.windowId),
    windowNumber: index.windowNumberById.get(tab.windowId) ?? index.windowNumberById.size + 1,
    lane,
  };
}

function suggestionRank(title: string, url: string, query: string): number | null {
  const normalizedTitle = title.toLowerCase();
  const normalizedUrl = url.toLowerCase();
  if (normalizedTitle.startsWith(query)) return 0;
  if (normalizedTitle.includes(query)) return 1;
  if (normalizedUrl.includes(query)) return 2;
  return null;
}

export function buildUnifiedSearchSuggestions(
  snapshot: ActiveTabsSnapshot,
  sessions: TabSession[],
  query: string,
  limit = 5,
): UnifiedSearchSuggestion[] {
  const normalized = normalizedQuery(query);
  const boundedLimit = Math.max(0, limit);
  if (!normalized || boundedLimit === 0) return [];

  const candidatesByRank: UnifiedSearchSuggestion[][] = [[], [], []];
  const contextIndex = buildActiveTabContextIndex(snapshot);

  function addCandidate(rank: number, suggestion: UnifiedSearchSuggestion) {
    const bucket = candidatesByRank[rank];
    if (bucket.length < boundedLimit) bucket.push(suggestion);
  }

  for (const tab of snapshot.tabs) {
    const title = tab.title || tab.url || 'Untitled tab';
    const url = tab.url || '';
    const rank = suggestionRank(title, url, normalized);
    if (rank !== null && typeof tab.id === 'number') {
      addCandidate(rank, {
        key: `active:${tab.windowId}:${tab.id}`,
        source: 'active',
        tabId: tab.id,
        windowId: tab.windowId,
        title,
        url,
        context: resolveActiveTabContext(contextIndex, tab),
        ...(tab.favIconUrl ? { favIconUrl: tab.favIconUrl } : {}),
      });
    }
  }

  for (const session of sessions) {
    for (const tab of session.tabs) {
      const title = tab.title || tab.url || 'Untitled tab';
      const rank = suggestionRank(title, tab.url, normalized);
      if (rank !== null) {
        addCandidate(rank, {
          key: `saved:${session.id}:${tab.id}`,
          source: 'saved',
          sessionId: session.id,
          tabId: tab.id,
          title,
          url: tab.url,
          context: {
            sessionTitle: session.title,
            tabCount: session.tabs.length,
          },
          ...(tab.favIconUrl ? { favIconUrl: tab.favIconUrl } : {}),
        });
      }
    }
  }

  return candidatesByRank.flat().slice(0, boundedLimit);
}

function canUseQuickLinkUrl(url: string | undefined): url is string {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function buildOpenTabChoices(
  snapshot: ActiveTabsSnapshot,
  query: string,
  limit = 50,
): OpenTabChoices {
  const boundedLimit = Math.max(0, limit);
  const normalized = normalizedQuery(query);
  const contextIndex = buildActiveTabContextIndex(snapshot);
  const choices: OpenTabChoice[] = [];

  for (const tab of snapshot.tabs) {
    if (!canUseQuickLinkUrl(tab.url)) continue;
    if (normalized && !matchesTab(tab, normalized)) continue;
    if (choices.length === boundedLimit) return { choices, overflow: true };

    choices.push({
      key: `active:${tab.windowId}:${tab.id ?? tab.index}:${tab.url}`,
      tab,
      label: getTabLabel(tab),
      context: resolveActiveTabContext(contextIndex, tab),
    });
  }

  return { choices, overflow: false };
}

export function filterActiveTabsSnapshot(
  snapshot: ActiveTabsSnapshot,
  query: string,
): ActiveTabsSnapshot {
  const normalized = normalizedQuery(query);
  if (!normalized) return snapshot;

  const tabs = snapshot.tabs.filter((tab) => matchesTab(tab, normalized));
  const windowIds = new Set(tabs.map((tab) => tab.windowId));
  const groupKeys = new Set(
    tabs
      .filter((tab) => typeof tab.groupId === 'number' && tab.groupId >= 0)
      .map((tab) => `${tab.windowId}:${tab.groupId}`),
  );

  return {
    windows: snapshot.windows.filter((window) => windowIds.has(window.id)),
    tabs,
    chromeGroups: snapshot.chromeGroups.filter((group) =>
      groupKeys.has(`${group.windowId}:${group.id}`),
    ),
  };
}

export function filterSavedSessions(sessions: TabSession[], query: string): TabSession[] {
  const normalized = normalizedQuery(query);
  if (!normalized) return sessions;

  return sessions.flatMap((session) => {
    const tabs = session.tabs.filter((tab) => matchesTab(tab, normalized));
    return tabs.length > 0 ? [{ ...session, tabs }] : [];
  });
}
