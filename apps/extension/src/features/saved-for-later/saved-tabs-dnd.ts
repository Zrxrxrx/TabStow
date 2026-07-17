import type { MoveSavedTabRequest } from '@/features/history/types';

export const SAVED_TABS_DRAG_MIME = 'application/x-tabstow-saved-tabs';

export type SavedTabsDragSource =
  | { kind: 'session'; sessionId: string }
  | { kind: 'tab'; sessionId: string; tabId: string };

export type SavedTabsDropTarget =
  | {
      kind: 'session';
      beforeSessionId: string | null;
      sessionIds: readonly string[];
    }
  | {
      kind: 'tab';
      destinationSessionId: string;
      beforeTabId: string | null;
      tabIds: readonly string[];
    };

export type SavedTabsDropRequest =
  | { kind: 'sessions'; orderedIds: string[] }
  | { kind: 'tab'; request: MoveSavedTabRequest };

function isId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasExactKeys(value: object, expected: string[]): boolean {
  const keys = Object.keys(value).sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

function isDragSource(value: unknown): value is SavedTabsDragSource {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;

  const source = value as { kind?: unknown; sessionId?: unknown; tabId?: unknown };
  if (source.kind === 'session') {
    return hasExactKeys(value, ['kind', 'sessionId']) && isId(source.sessionId);
  }

  return (
    source.kind === 'tab' &&
    hasExactKeys(value, ['kind', 'sessionId', 'tabId']) &&
    isId(source.sessionId) &&
    isId(source.tabId)
  );
}

function hasUniqueIds(ids: readonly string[]): boolean {
  return ids.every(isId) && new Set(ids).size === ids.length;
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function writeSavedTabsDragSource(
  dataTransfer: DataTransfer,
  source: SavedTabsDragSource,
): void {
  dataTransfer.effectAllowed = 'move';
  dataTransfer.setData(SAVED_TABS_DRAG_MIME, JSON.stringify(source));
}

export function readSavedTabsDragSource(
  dataTransfer: DataTransfer,
): SavedTabsDragSource | null {
  try {
    const value: unknown = JSON.parse(dataTransfer.getData(SAVED_TABS_DRAG_MIME));
    return isDragSource(value) ? value : null;
  } catch {
    return null;
  }
}

export function resolveSavedDrop(
  source: SavedTabsDragSource,
  target: SavedTabsDropTarget,
  options: { searchActive?: boolean } = {},
): SavedTabsDropRequest | null {
  if (options.searchActive) return null;

  if (source.kind === 'session') {
    if (
      target.kind !== 'session' ||
      !hasUniqueIds(target.sessionIds) ||
      !target.sessionIds.includes(source.sessionId) ||
      (target.beforeSessionId !== null && !target.sessionIds.includes(target.beforeSessionId)) ||
      target.beforeSessionId === source.sessionId
    ) {
      return null;
    }

    const orderedIds = target.sessionIds.filter((id) => id !== source.sessionId);
    const destinationIndex =
      target.beforeSessionId === null
        ? orderedIds.length
        : orderedIds.indexOf(target.beforeSessionId);
    if (destinationIndex < 0) return null;

    orderedIds.splice(destinationIndex, 0, source.sessionId);
    return arraysEqual(orderedIds, target.sessionIds)
      ? null
      : { kind: 'sessions', orderedIds };
  }

  if (
    target.kind !== 'tab' ||
    !isId(target.destinationSessionId) ||
    !hasUniqueIds(target.tabIds) ||
    (target.beforeTabId !== null && !target.tabIds.includes(target.beforeTabId)) ||
    (source.sessionId === target.destinationSessionId && target.beforeTabId === source.tabId)
  ) {
    return null;
  }

  const destinationTabIds =
    source.sessionId === target.destinationSessionId
      ? target.tabIds.filter((id) => id !== source.tabId)
      : [...target.tabIds];
  const destinationIndex =
    target.beforeTabId === null
      ? destinationTabIds.length
      : destinationTabIds.indexOf(target.beforeTabId);
  if (destinationIndex < 0) return null;

  if (source.sessionId === target.destinationSessionId) {
    const orderedIds = [...destinationTabIds];
    orderedIds.splice(destinationIndex, 0, source.tabId);
    if (arraysEqual(orderedIds, target.tabIds)) return null;
  }

  return {
    kind: 'tab',
    request: {
      sourceSessionId: source.sessionId,
      tabId: source.tabId,
      destinationSessionId: target.destinationSessionId,
      destinationIndex,
    },
  };
}
