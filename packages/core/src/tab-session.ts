import type { TabSession } from './schemas';

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
