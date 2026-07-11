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
