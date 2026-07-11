import { browser } from '@/lib/browser';
import { err, ok, toErrorMessage, type AppResult } from '@/lib/errors';
import type {
  ActiveTabLane,
  ActiveTabMoveRequest,
  ActiveTabsMoveResult,
  ActiveTabsPosition,
} from './types';

const NO_GROUP = -1;
type IndexedTab = chrome.tabs.Tab & { id: number };

function groupId(tab: chrome.tabs.Tab): number {
  return typeof tab.groupId === 'number' ? tab.groupId : NO_GROUP;
}

function indexedTabs(tabs: chrome.tabs.Tab[]): IndexedTab[] {
  return tabs
    .filter((tab): tab is IndexedTab => typeof tab.id === 'number')
    .sort((a, b) => a.index - b.index || a.id - b.id);
}

async function requireNormalWindow(windowId: number): Promise<chrome.windows.Window> {
  const window = await browser.windows.get(windowId);
  if (window.type !== 'normal') throw new Error('Drag targets must be normal Chrome windows.');
  return window;
}

async function queryWindowTabs(windowId: number): Promise<IndexedTab[]> {
  return indexedTabs(await browser.tabs.query({ windowId }));
}

function anchorTabs(tabs: IndexedTab[], position: ActiveTabsPosition): IndexedTab[] {
  if (position.kind === 'end') return [];
  const { anchor } = position;
  if (anchor.kind === 'tab') {
    const anchorTab = tabs.find((tab) => tab.id === anchor.tabId);
    if (!anchorTab) throw new Error('The drop anchor no longer exists.');
    return [anchorTab];
  }
  const matches = tabs.filter((tab) => groupId(tab) === anchor.groupId);
  if (matches.length === 0) throw new Error('The drop group no longer exists.');
  return matches;
}

function assertAnchorFitsLane(
  tabs: IndexedTab[],
  lane: ActiveTabLane,
  position: ActiveTabsPosition,
): void {
  if (position.kind === 'end') return;
  const matches = anchorTabs(tabs, position);

  if (lane.kind === 'pinned') {
    if (position.anchor.kind !== 'tab' || !matches[0]?.pinned) {
      throw new Error('Pinned tabs can only use pinned tab anchors.');
    }
    return;
  }

  if (lane.kind === 'group') {
    if (position.anchor.kind !== 'tab' || groupId(matches[0] as IndexedTab) !== lane.groupId) {
      throw new Error('Grouped tabs can only use anchors from the target group.');
    }
    return;
  }

  if (position.anchor.kind === 'tab') {
    const anchor = matches[0] as IndexedTab;
    if (anchor.pinned || groupId(anchor) !== NO_GROUP) {
      throw new Error('Ungrouped tab anchors must be unpinned and ungrouped.');
    }
  }
}

function insertionBoundary(
  tabs: IndexedTab[],
  lane: ActiveTabLane,
  position: ActiveTabsPosition,
): number {
  assertAnchorFitsLane(tabs, lane, position);

  if (position.kind === 'end') {
    if (lane.kind === 'ungrouped') return tabs.length;
    const laneTabs = lane.kind === 'pinned'
      ? tabs.filter((tab) => tab.pinned)
      : tabs.filter((tab) => groupId(tab) === lane.groupId);
    if (lane.kind === 'group' && laneTabs.length === 0) {
      throw new Error('The target group no longer exists.');
    }
    return laneTabs.length === 0 ? 0 : Math.max(...laneTabs.map((tab) => tab.index)) + 1;
  }

  const matches = anchorTabs(tabs, position);
  const first = Math.min(...matches.map((tab) => tab.index));
  const last = Math.max(...matches.map((tab) => tab.index));
  return position.kind === 'before' ? first : last + 1;
}

function movedTab(tabs: IndexedTab[], tabId: number): IndexedTab {
  const source = tabs.find((tab) => tab.id === tabId);
  if (!source) throw new Error('The moved tab no longer exists in the target window.');
  return source;
}

function resolvedFinalIndex(
  tabs: IndexedTab[],
  tabId: number,
  lane: ActiveTabLane,
  position: ActiveTabsPosition,
): number {
  const source = movedTab(tabs, tabId);
  if (position.kind !== 'end' && position.anchor.kind === 'tab' && position.anchor.tabId === tabId) {
    throw new Error('A tab cannot use itself as a drop anchor.');
  }
  const boundary = insertionBoundary(tabs, lane, position);
  const adjusted = source.index < boundary ? boundary - 1 : boundary;
  return Math.max(0, Math.min(adjusted, tabs.length - 1));
}

function laneMatches(tab: chrome.tabs.Tab, lane: ActiveTabLane): boolean {
  if (lane.kind === 'pinned') return Boolean(tab.pinned) && groupId(tab) === NO_GROUP;
  if (lane.kind === 'ungrouped') return !tab.pinned && groupId(tab) === NO_GROUP;
  return !tab.pinned && groupId(tab) === lane.groupId;
}

export async function moveActiveTab(
  request: ActiveTabMoveRequest,
): Promise<AppResult<ActiveTabsMoveResult>> {
  try {
    const initialSource = await browser.tabs.get(request.tabId);
    if (typeof initialSource.id !== 'number') throw new Error('The moved tab no longer exists.');
    const [sourceWindow, targetWindow] = await Promise.all([
      requireNormalWindow(initialSource.windowId),
      requireNormalWindow(request.destination.windowId),
    ]);
    if (sourceWindow.incognito !== targetWindow.incognito) {
      throw new Error('Tabs cannot move between regular and incognito windows.');
    }

    const sameWindow = initialSource.windowId === request.destination.windowId;
    const targetIsPinned = request.destination.lane.kind === 'pinned';
    if (!sameWindow && Boolean(initialSource.pinned) !== targetIsPinned) {
      throw new Error('Pinned state cannot be changed by dragging.');
    }

    let targetTabs = await queryWindowTabs(request.destination.windowId);
    let source = sameWindow ? movedTab(targetTabs, request.tabId) : initialSource;
    if (Boolean(source.pinned) !== targetIsPinned) {
      throw new Error('Pinned state cannot be changed by dragging.');
    }

    if (request.destination.lane.kind === 'group') {
      const targetGroup = await browser.tabGroups.get(request.destination.lane.groupId);
      if (targetGroup.windowId !== request.destination.windowId) {
        throw new Error('The target group moved to another window.');
      }
    }

    insertionBoundary(targetTabs, request.destination.lane, request.destination.position);

    if (sameWindow && laneMatches(source, request.destination.lane)) {
      const index = resolvedFinalIndex(
        targetTabs,
        request.tabId,
        request.destination.lane,
        request.destination.position,
      );
      if (source.index === index) return ok({ moved: false });
    }

    let moved = false;
    if (!sameWindow) {
      const index = source.pinned ? targetTabs.filter((tab) => tab.pinned).length : -1;
      await browser.tabs.move(request.tabId, { windowId: request.destination.windowId, index });
      moved = true;
      targetTabs = await queryWindowTabs(request.destination.windowId);
      source = movedTab(targetTabs, request.tabId);
      if (Boolean(source.pinned) !== targetIsPinned) {
        throw new Error('Pinned state cannot be changed by dragging.');
      }
    }

    if (request.destination.lane.kind === 'group' && groupId(source) !== request.destination.lane.groupId) {
      await browser.tabs.group({ groupId: request.destination.lane.groupId, tabIds: request.tabId });
      moved = true;
      targetTabs = await queryWindowTabs(request.destination.windowId);
      source = movedTab(targetTabs, request.tabId);
    } else if (request.destination.lane.kind === 'ungrouped' && groupId(source) !== NO_GROUP) {
      await browser.tabs.ungroup(request.tabId);
      moved = true;
      targetTabs = await queryWindowTabs(request.destination.windowId);
      source = movedTab(targetTabs, request.tabId);
    }

    const finalIndex = resolvedFinalIndex(
      targetTabs,
      request.tabId,
      request.destination.lane,
      request.destination.position,
    );
    if (source.index !== finalIndex) {
      await browser.tabs.move(request.tabId, { index: finalIndex });
      moved = true;
    }

    return ok({ moved });
  } catch (error) {
    return err('chrome-tabs-error', toErrorMessage(error));
  }
}
