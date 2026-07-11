import type {
  ActiveGroupMoveRequest,
  ActiveTabMoveRequest,
  ActiveTabsDragSource,
} from '@/features/active-tabs/types';

export const ACTIVE_TABS_DRAG_MIME = 'application/x-tabstow-active-tabs';

export type ActiveTabsDropTarget = {
  key: string;
  incognito: boolean;
  tabDestination?: ActiveTabMoveRequest['destination'];
  groupDestination?: ActiveGroupMoveRequest['destination'];
};

export type ActiveTabsDropRequest =
  | { kind: 'tab'; request: ActiveTabMoveRequest }
  | { kind: 'group'; request: ActiveGroupMoveRequest };

function isDragSource(value: unknown): value is ActiveTabsDragSource {
  if (!value || typeof value !== 'object') return false;

  const source = value as {
    kind?: unknown;
    tabId?: unknown;
    groupId?: unknown;
    windowId?: unknown;
    pinned?: unknown;
    incognito?: unknown;
  };

  if (source.kind === 'tab') {
    return (
      typeof source.tabId === 'number' &&
      Number.isInteger(source.tabId) &&
      typeof source.windowId === 'number' &&
      Number.isInteger(source.windowId) &&
      typeof source.pinned === 'boolean' &&
      typeof source.incognito === 'boolean'
    );
  }

  return (
    source.kind === 'group' &&
    typeof source.groupId === 'number' &&
    Number.isInteger(source.groupId) &&
    typeof source.windowId === 'number' &&
    Number.isInteger(source.windowId) &&
    typeof source.incognito === 'boolean'
  );
}

export function writeActiveTabsDragSource(
  dataTransfer: DataTransfer,
  source: ActiveTabsDragSource,
): void {
  dataTransfer.effectAllowed = 'move';
  dataTransfer.setData(ACTIVE_TABS_DRAG_MIME, JSON.stringify(source));
}

export function readActiveTabsDragSource(
  dataTransfer: DataTransfer,
): ActiveTabsDragSource | null {
  try {
    const value: unknown = JSON.parse(dataTransfer.getData(ACTIVE_TABS_DRAG_MIME));
    return isDragSource(value) ? value : null;
  } catch {
    return null;
  }
}

export function resolveActiveTabsDropRequest(
  source: ActiveTabsDragSource,
  target: ActiveTabsDropTarget,
): ActiveTabsDropRequest | null {
  if (source.incognito !== target.incognito) return null;

  if (source.kind === 'group') {
    return target.groupDestination
      ? {
          kind: 'group',
          request: {
            groupId: source.groupId,
            sourceWindowId: source.windowId,
            destination: target.groupDestination,
          },
        }
      : null;
  }

  if (!target.tabDestination) return null;

  const targetPinned = target.tabDestination.lane.kind === 'pinned';
  if (source.pinned !== targetPinned) return null;

  return {
    kind: 'tab',
    request: {
      tabId: source.tabId,
      destination: target.tabDestination,
    },
  };
}
