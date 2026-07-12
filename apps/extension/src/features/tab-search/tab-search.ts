import type { TabSession } from '@tabstow/core';
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
    }
  | {
      key: string;
      source: 'saved';
      sessionId: string;
      tabId: string;
      title: string;
      url: string;
      favIconUrl?: string;
    };

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
  if (!normalized) return [];

  const candidates: Array<{
    suggestion: UnifiedSearchSuggestion;
    rank: number;
    order: number;
  }> = [];
  let order = 0;

  for (const tab of snapshot.tabs) {
    const title = tab.title || tab.url || 'Untitled tab';
    const url = tab.url || '';
    const rank = suggestionRank(title, url, normalized);
    if (rank !== null && typeof tab.id === 'number') {
      candidates.push({
        suggestion: {
          key: `active:${tab.windowId}:${tab.id}`,
          source: 'active',
          tabId: tab.id,
          windowId: tab.windowId,
          title,
          url,
          ...(tab.favIconUrl ? { favIconUrl: tab.favIconUrl } : {}),
        },
        rank,
        order,
      });
    }
    order += 1;
  }

  for (const session of sessions) {
    for (const tab of session.tabs) {
      const title = tab.title || tab.url || 'Untitled tab';
      const rank = suggestionRank(title, tab.url, normalized);
      if (rank !== null) {
        candidates.push({
          suggestion: {
            key: `saved:${session.id}:${tab.id}`,
            source: 'saved',
            sessionId: session.id,
            tabId: tab.id,
            title,
            url: tab.url,
            ...(tab.favIconUrl ? { favIconUrl: tab.favIconUrl } : {}),
          },
          rank,
          order,
        });
      }
      order += 1;
    }
  }

  return candidates
    .sort((left, right) => left.rank - right.rank || left.order - right.order)
    .slice(0, Math.max(0, limit))
    .map(({ suggestion }) => suggestion);
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
