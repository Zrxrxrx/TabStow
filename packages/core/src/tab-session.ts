import type { SavedTab, TabSession } from './schemas';

export function normalizeSavedTabUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return null;
  }
}

export function deduplicateIncomingTabs(tabs: SavedTab[]): SavedTab[] {
  const seenUrls = new Set<string>();
  const winners: SavedTab[] = [];

  for (let index = tabs.length - 1; index >= 0; index -= 1) {
    const tab = tabs[index];
    if (!tab) continue;

    const normalizedUrl = normalizeSavedTabUrl(tab.url);
    if (normalizedUrl === null || !seenUrls.has(normalizedUrl)) {
      winners.push(tab);
      if (normalizedUrl !== null) seenUrls.add(normalizedUrl);
    }
  }

  return winners.reverse();
}

export function sortSessionsForDisplay(sessions: TabSession[]): TabSession[] {
  return [...sessions].sort((a, b) => {
    if (a.sortOrder != null && b.sortOrder != null) return a.sortOrder - b.sortOrder;
    if (a.sortOrder != null) return -1;
    if (b.sortOrder != null) return 1;
    return b.createdAt.localeCompare(a.createdAt);
  });
}

export function deduplicateSessionsByUrl(sessions: TabSession[]): TabSession[] {
  const winners = new Map<string, { sessionId: string; tabId: string }>();
  const rankedTabs = sessions
    .flatMap((session) => session.tabs.map((tab) => ({ session, tab })))
    .sort(
      (a, b) =>
        b.session.updatedAt.localeCompare(a.session.updatedAt) ||
        b.tab.createdAt.localeCompare(a.tab.createdAt) ||
        a.session.id.localeCompare(b.session.id) ||
        a.tab.id.localeCompare(b.tab.id),
    );

  for (const { session, tab } of rankedTabs) {
    const normalizedUrl = normalizeSavedTabUrl(tab.url);
    if (normalizedUrl !== null && !winners.has(normalizedUrl)) {
      winners.set(normalizedUrl, { sessionId: session.id, tabId: tab.id });
    }
  }

  const deduplicated = sessions
    .map((session) => ({
      ...session,
      tabs: session.tabs.filter((tab) => {
        const normalizedUrl = normalizeSavedTabUrl(tab.url);
        if (normalizedUrl === null) return true;
        const winner = winners.get(normalizedUrl);
        return winner?.sessionId === session.id && winner.tabId === tab.id;
      }),
    }))
    .filter((session) => session.tabs.length > 0);

  return sortSessionsForDisplay(deduplicated);
}

export function sortSessionsNewestFirst(sessions: TabSession[]): TabSession[] {
  return [...sessions].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function mergeSessionsById(
  localSessions: TabSession[],
  remoteSessions: TabSession[],
): TabSession[] {
  const mergedById = new Map<string, TabSession>();

  for (const session of localSessions) {
    mergedById.set(session.id, session);
  }

  for (const session of remoteSessions) {
    mergedById.set(session.id, session);
  }

  return sortSessionsNewestFirst(Array.from(mergedById.values()));
}
