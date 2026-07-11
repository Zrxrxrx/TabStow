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

export function repairDuplicateTabIds(tabs: SavedTab[]): SavedTab[] {
  const usedIds = new Set<string>();

  return tabs.map((tab) => {
    if (!usedIds.has(tab.id)) {
      usedIds.add(tab.id);
      return tab;
    }

    let suffix = 2;
    let repairedId = `${tab.id}~${suffix}`;
    while (usedIds.has(repairedId)) {
      suffix += 1;
      repairedId = `${tab.id}~${suffix}`;
    }
    usedIds.add(repairedId);
    return { ...tab, id: repairedId };
  });
}

export function sortSessionsForDisplay(sessions: TabSession[]): TabSession[] {
  return [...sessions].sort((a, b) => {
    if (a.sortOrder != null && b.sortOrder != null) {
      const orderDifference = a.sortOrder - b.sortOrder;
      if (orderDifference !== 0) return orderDifference;
    } else {
      if (a.sortOrder != null) return -1;
      if (b.sortOrder != null) return 1;
    }
    return b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id);
  });
}

export function deduplicateSessionsByUrl(sessions: TabSession[]): TabSession[] {
  const winners = new Map<string, { sessionIndex: number; tabIndex: number }>();
  const rankedTabs = sessions
    .flatMap((session, sessionIndex) =>
      session.tabs.map((tab, tabIndex) => ({ session, sessionIndex, tab, tabIndex })),
    )
    .sort(
      (a, b) =>
        b.session.updatedAt.localeCompare(a.session.updatedAt) ||
        b.tab.createdAt.localeCompare(a.tab.createdAt) ||
        a.session.id.localeCompare(b.session.id) ||
        a.tab.id.localeCompare(b.tab.id) ||
        a.sessionIndex - b.sessionIndex ||
        a.tabIndex - b.tabIndex,
    );

  for (const { sessionIndex, tab, tabIndex } of rankedTabs) {
    const normalizedUrl = normalizeSavedTabUrl(tab.url);
    if (normalizedUrl !== null && !winners.has(normalizedUrl)) {
      winners.set(normalizedUrl, { sessionIndex, tabIndex });
    }
  }

  const deduplicated = sessions
    .map((session, sessionIndex) => ({
      ...session,
      tabs: session.tabs.filter((tab, tabIndex) => {
        const normalizedUrl = normalizeSavedTabUrl(tab.url);
        if (normalizedUrl === null) return true;
        const winner = winners.get(normalizedUrl);
        return winner?.sessionIndex === sessionIndex && winner.tabIndex === tabIndex;
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
