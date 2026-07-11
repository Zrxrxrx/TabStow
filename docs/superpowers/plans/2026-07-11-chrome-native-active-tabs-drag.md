# Chrome-Native Active Tabs Drag Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace URL/manual Active Tabs grouping with a Chrome-window projection and add Chrome-confirmed native drag-and-drop for tabs and native tab groups.

**Architecture:** Chrome remains the only source of truth. The new-tab page projects raw normal-window, tab, and tab-group snapshots into ordered window sections; drag requests carry semantic anchors to the MV3 service worker, which re-queries complete Chrome windows before calling `tabs.move`, `tabs.group`, `tabs.ungroup`, or `tabGroups.move`, then the UI refreshes from Chrome.

**Tech Stack:** TypeScript, React, WXT Manifest V3, Chrome `tabs`/`tabGroups`/`windows` APIs, Vitest, jsdom, CSS, Bun.

## Global Constraints

- Use Bun for package management and scripts; do not use pnpm, npm, npx, or yarn.
- Prefix every shell command with `rtk`.
- Commit messages use `type(scope): msg`.
- Chrome is authoritative; do not persist or optimistically reconcile Active Tabs order.
- Use native HTML drag-and-drop; add no drag-and-drop dependency.
- Keep browser-internal URLs, extension URLs, and tabs without usable URLs hidden from Active Tabs.
- Resolve mutation indices from fresh, unfiltered Chrome window queries so hidden tabs still count.
- Support normal Chrome windows only; reject cross-incognito moves before the first mutation.
- Preserve pinned state; pinned tabs only move within or between pinned lanes and never enter groups.
- Keep all mutating Chrome calls in the MV3 service worker.
- Do not add permissions, content scripts, remote code, `eval`, `new Function`, CDN scripts, Node APIs, or Bun APIs to extension runtime code.
- Do not migrate legacy manual groups or local order into Chrome.
- Preserve focus, close, stow-one-tab, close-group, collapse-group, refresh, and duplicate-closing behavior.

## File Structure

**Create**

- `apps/extension/src/features/active-tabs/active-tab-windows.ts` — pure snapshot-to-window projection.
- `apps/extension/src/features/active-tabs/active-tab-windows.test.ts` — projection contract.
- `apps/extension/src/features/active-tabs/active-tab-moves.ts` — semantic tab/group move resolution and Chrome mutations.
- `apps/extension/src/features/active-tabs/active-tab-moves.test.ts` — mutation, validation, and failure tests.
- `apps/extension/src/entrypoints/newtab/components/ActiveWindowSection.tsx` — window, pinned lane, ungrouped tab, and Chrome group rendering.
- `apps/extension/src/entrypoints/newtab/components/active-tabs-dnd.ts` — drag payload parsing and compatible request resolution.
- `apps/extension/src/entrypoints/newtab/components/active-tabs-dnd.test.ts` — drag payload and target compatibility tests.
- `apps/extension/src/features/active-tabs/active-tabs-events.ts` — complete Chrome event subscription and cleanup.
- `apps/extension/src/features/active-tabs/active-tabs-events.test.ts` — listener registration/cleanup contract.

**Modify**

- `apps/extension/src/features/active-tabs/types.ts` — Chrome window projection, drag, destination, request, and result types.
- `apps/extension/src/features/active-tabs/active-tab-groups.ts` — retain duplicate URL detection only.
- `apps/extension/src/features/active-tabs/active-tab-groups.test.ts` — retain tab-label and duplicate tests only.
- `apps/extension/src/features/active-tabs/tab-labels.ts` — remove landing-page classification while retaining display-label helpers.
- `apps/extension/src/features/active-tabs/active-tabs-service.ts` — add normal-window metadata to snapshots.
- `apps/extension/src/features/active-tabs/active-tabs-service.test.ts` — snapshot filtering/error tests.
- `apps/extension/src/features/chrome-tab-groups/chrome-tab-groups.ts` — retain explicit collapse behavior only.
- `apps/extension/src/features/chrome-tab-groups/chrome-tab-groups.test.ts` — retain collapse tests only.
- `apps/extension/src/lib/messages.ts` — add typed move requests and remove legacy group sync/import messages.
- `apps/extension/src/lib/messages.test.ts` — accept moved/no-op results and transport move requests.
- `apps/extension/src/entrypoints/background.ts` — route move requests to the mutation service.
- `apps/extension/src/tests/background.test.ts` — verify new routes and removal of legacy routes.
- `apps/extension/src/entrypoints/newtab/components/ActiveWorkspace.tsx` — Chrome-only state, actions, drag orchestration, and debounced refresh.
- `apps/extension/src/entrypoints/newtab/components/GroupNav.tsx` — navigate Chrome windows and native groups.
- `apps/extension/src/entrypoints/newtab/App.test.tsx` — Chrome-window UI, native drag, pending state, errors, refresh, and regression coverage.
- `apps/extension/src/entrypoints/newtab/styles.css` — window/group structure, drag handles, targets, and insertion feedback.
- `apps/extension/src/features/i18n/i18n.ts` — Chrome-window and drag copy; remove legacy grouping copy.
- `apps/extension/src/features/i18n/i18n.test.ts` — English/Chinese interpolation coverage.
- `README.md` — Chrome-window and drag manual QA.
- `docs/superpowers/specs/2026-07-11-chrome-native-active-tabs-drag-design.md` — mark the approved specification as approved for planning.

**Delete after all consumers are removed**

- `apps/extension/src/features/active-tabs/active-workspace-storage.ts`
- `apps/extension/src/features/active-tabs/active-workspace-storage.test.ts`
- `apps/extension/src/features/active-tabs/manual-groups.ts`
- `apps/extension/src/features/active-tabs/manual-groups.test.ts`

---

### Task 1: Project Raw Chrome State Into Ordered Windows

**Files:**

- Create: `apps/extension/src/features/active-tabs/active-tab-windows.ts`
- Create: `apps/extension/src/features/active-tabs/active-tab-windows.test.ts`
- Modify: `apps/extension/src/features/active-tabs/types.ts:1-47`

**Interfaces:**

- Consumes: `ActiveTabsSnapshot` containing normal windows, eligible tabs, and native group metadata.
- Produces: `buildActiveTabWindows(snapshot: ActiveTabsSnapshot): ActiveTabWindow[]` for every UI consumer.

- [ ] **Step 1: Write the failing projection tests**

Create `active-tab-windows.test.ts` with fixtures that prove window isolation, physical ordering, pinned separation, URL-classification removal, and metadata fallback:

```ts
import { describe, expect, it } from 'vitest';
import { buildActiveTabWindows } from './active-tab-windows';
import type { ActiveBrowserTab, ActiveTabsSnapshot } from './types';

function tab(
  id: number,
  windowId: number,
  index: number,
  partial: Partial<ActiveBrowserTab> = {},
): ActiveBrowserTab {
  return {
    active: false,
    groupId: -1,
    id,
    index,
    pinned: false,
    title: `Tab ${id}`,
    url: `https://same.example/${id}`,
    windowId,
    ...partial,
  };
}

describe('buildActiveTabWindows', () => {
  it('keeps windows separate and follows Chrome tab index instead of URL', () => {
    const snapshot: ActiveTabsSnapshot = {
      windows: [
        { id: 8, focused: false, incognito: false, type: 'normal' },
        { id: 3, focused: true, incognito: false, type: 'normal' },
      ],
      tabs: [
        tab(1, 3, 0, { pinned: true, url: 'https://same.example/' }),
        tab(2, 3, 1, { url: 'https://same.example/' }),
        tab(3, 3, 2, { groupId: 31 }),
        tab(4, 3, 3, { groupId: 31 }),
        tab(5, 3, 4, { url: 'https://different.example/' }),
        tab(6, 8, 0, { url: 'https://same.example/' }),
      ],
      chromeGroups: [
        { id: 31, windowId: 3, title: 'Reading', color: 'blue', collapsed: true },
      ],
    };

    expect(buildActiveTabWindows(snapshot)).toEqual([
      {
        key: 'window:3',
        windowId: 3,
        focused: true,
        incognito: false,
        visibleTabCount: 5,
        pinnedTabs: [expect.objectContaining({ id: 1 })],
        items: [
          { kind: 'tab', key: 'tab:2', tab: expect.objectContaining({ id: 2 }) },
          {
            kind: 'group',
            key: 'chrome:3:31',
            windowId: 3,
            groupId: 31,
            title: 'Reading',
            color: 'blue',
            collapsed: true,
            tabs: [expect.objectContaining({ id: 3 }), expect.objectContaining({ id: 4 })],
          },
          { kind: 'tab', key: 'tab:5', tab: expect.objectContaining({ id: 5 }) },
        ],
      },
      expect.objectContaining({ key: 'window:8', visibleTabCount: 1 }),
    ]);
  });

  it('uses the window/group pair and keeps grouped tabs grouped without metadata', () => {
    const snapshot: ActiveTabsSnapshot = {
      windows: [
        { id: 2, focused: false, incognito: false, type: 'normal' },
        { id: 7, focused: false, incognito: false, type: 'normal' },
        { id: 9, focused: false, incognito: false, type: 'normal' },
      ],
      tabs: [
        tab(10, 7, 1, { groupId: 31 }),
        tab(11, 2, 0, { groupId: 31 }),
        tab(12, 7, 0, { pinned: true, groupId: 31 }),
      ],
      chromeGroups: [],
    };

    const windows = buildActiveTabWindows(snapshot);

    expect(windows.map((window) => window.windowId)).toEqual([2, 7]);
    expect(windows[0]?.items[0]).toMatchObject({
      key: 'chrome:2:31',
      title: null,
      color: null,
      collapsed: null,
    });
    expect(windows[1]?.items[0]).toMatchObject({ key: 'chrome:7:31' });
    expect(windows[1]?.pinnedTabs[0]).toMatchObject({ id: 12 });
  });
});
```

- [ ] **Step 2: Run the projection test and verify RED**

Run from `apps/extension`:

```bash
rtk bun run test src/features/active-tabs/active-tab-windows.test.ts
```

Expected: FAIL because `active-tab-windows.ts` and the Chrome window projection types do not exist.

- [ ] **Step 3: Add the projection types without removing legacy types yet**

Append these types to `types.ts`; the legacy types remain temporarily so intermediate commits still typecheck:

```ts
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
```

Replace the old two-field `ActiveTabsSnapshot` declaration instead of declaring it twice.

- [ ] **Step 4: Implement the pure projection**

Create `active-tab-windows.ts`:

```ts
import type {
  ActiveBrowserTab,
  ActiveChromeGroupItem,
  ActiveTabsSnapshot,
  ActiveTabWindow,
  ActiveWindowItem,
  ChromeTabGroupInfo,
} from './types';

function compareTabs(a: ActiveBrowserTab, b: ActiveBrowserTab): number {
  return (a.index ?? 0) - (b.index ?? 0) || (a.id ?? 0) - (b.id ?? 0);
}

function groupKey(windowId: number, groupId: number): string {
  return `chrome:${windowId}:${groupId}`;
}

function groupMetadataByKey(
  groups: ChromeTabGroupInfo[],
): Map<string, ChromeTabGroupInfo> {
  return new Map(groups.map((group) => [groupKey(group.windowId, group.id), group]));
}

function isVisibleTab(tab: ActiveBrowserTab, windowId: number): boolean {
  return tab.windowId === windowId && typeof tab.id === 'number' && Boolean(tab.url);
}

export function buildActiveTabWindows(snapshot: ActiveTabsSnapshot): ActiveTabWindow[] {
  const metadata = groupMetadataByKey(snapshot.chromeGroups);

  return [...snapshot.windows]
    .sort((a, b) => Number(b.focused) - Number(a.focused) || a.id - b.id)
    .map((window): ActiveTabWindow => {
      const tabs = snapshot.tabs
        .filter((tab) => isVisibleTab(tab, window.id))
        .sort(compareTabs);
      const pinnedTabs = tabs.filter((tab) => tab.pinned);
      const unpinnedTabs = tabs.filter((tab) => !tab.pinned);
      const seenGroupIds = new Set<number>();
      const items: ActiveWindowItem[] = [];

      for (const tab of unpinnedTabs) {
        const groupId = typeof tab.groupId === 'number' ? tab.groupId : -1;
        if (groupId < 0) {
          items.push({ kind: 'tab', key: `tab:${tab.id}`, tab });
          continue;
        }

        if (seenGroupIds.has(groupId)) continue;
        seenGroupIds.add(groupId);

        const groupTabs = unpinnedTabs
          .filter((candidate) => candidate.groupId === groupId)
          .sort(compareTabs);
        const nativeGroup = metadata.get(groupKey(window.id, groupId));
        const item: ActiveChromeGroupItem = {
          kind: 'group',
          key: groupKey(window.id, groupId),
          windowId: window.id,
          groupId,
          title: nativeGroup?.title?.trim() || null,
          color: nativeGroup?.color ?? null,
          collapsed: nativeGroup?.collapsed ?? null,
          tabs: groupTabs,
        };
        items.push(item);
      }

      return {
        key: `window:${window.id}`,
        windowId: window.id,
        focused: window.focused,
        incognito: window.incognito,
        visibleTabCount: tabs.length,
        pinnedTabs,
        items,
      };
    })
    .filter((window) => window.visibleTabCount > 0);
}
```

- [ ] **Step 5: Verify GREEN and commit**

Run from `apps/extension`:

```bash
rtk bun run test src/features/active-tabs/active-tab-windows.test.ts
rtk bun run typecheck
```

Expected: both commands exit 0.

```bash
rtk git add apps/extension/src/features/active-tabs/types.ts apps/extension/src/features/active-tabs/active-tab-windows.ts apps/extension/src/features/active-tabs/active-tab-windows.test.ts
rtk git commit -m "feat(active-tabs): project Chrome window structure"
```

---

### Task 2: Include Normal Chrome Windows In Snapshots

**Files:**

- Modify: `apps/extension/src/features/active-tabs/active-tabs-service.ts:1-31`
- Modify: `apps/extension/src/features/active-tabs/active-tabs-service.test.ts:1-103`
- Modify: `apps/extension/src/entrypoints/newtab/App.test.tsx:1-2100`
- Modify: `apps/extension/src/tests/background.test.ts:190-214`

**Interfaces:**

- Consumes: `browser.windows.getAll`, existing eligible-tab filtering, and best-effort native group metadata.
- Produces: required `ActiveTabsSnapshot.windows` fixtures and runtime data for Task 6.

- [ ] **Step 1: Add failing snapshot tests**

Extend the hoisted browser mock with `windows.getAll`, then add these tests to `active-tabs-service.test.ts`:

```ts
// Add to browserMocks.
windows: {
  getAll: vi.fn(),
  update: vi.fn(),
},

// Add to beforeEach so the existing snapshot tests keep their window.
browserMocks.windows.getAll.mockResolvedValue([
  { id: 2, focused: true, incognito: false, type: 'normal' },
]);
```

```ts
it('returns eligible tabs and groups only from normal windows', async () => {
  browserMocks.windows.getAll.mockResolvedValue([
    { id: 2, focused: true, incognito: false, type: 'normal' },
    { id: 3, focused: false, incognito: false, type: 'popup' },
    { focused: false, incognito: false, type: 'normal' },
  ]);
  browserMocks.tabs.query.mockResolvedValue([
    { id: 1, windowId: 2, index: 0, url: 'https://visible.example/' },
    { id: 2, windowId: 2, index: 1, url: 'chrome://settings' },
    { id: 3, windowId: 3, index: 0, url: 'https://popup.example/' },
  ]);
  browserMocks.tabGroups.query.mockResolvedValue([
    { id: 31, windowId: 2, title: 'Normal', color: 'blue', collapsed: false },
    { id: 32, windowId: 3, title: 'Popup', color: 'red', collapsed: false },
  ]);

  const { listActiveTabsSnapshot } = await import('./active-tabs-service');

  await expect(listActiveTabsSnapshot()).resolves.toEqual({
    ok: true,
    data: {
      windows: [{ id: 2, focused: true, incognito: false, type: 'normal' }],
      tabs: [{ id: 1, windowId: 2, index: 0, url: 'https://visible.example/' }],
      chromeGroups: [
        { id: 31, windowId: 2, title: 'Normal', color: 'blue', collapsed: false },
      ],
    },
  });
});

it('returns a Chrome tabs error when normal windows cannot be read', async () => {
  browserMocks.tabs.query.mockResolvedValue([]);
  browserMocks.windows.getAll.mockRejectedValue(new Error('Windows unavailable'));

  const { listActiveTabsSnapshot } = await import('./active-tabs-service');

  await expect(listActiveTabsSnapshot()).resolves.toEqual({
    ok: false,
    error: { code: 'chrome-tabs-error', message: 'Windows unavailable' },
  });
});
```

- [ ] **Step 2: Verify RED**

Run from `apps/extension`:

```bash
rtk bun run test src/features/active-tabs/active-tabs-service.test.ts
```

Expected: FAIL because the snapshot does not query or return normal windows.

- [ ] **Step 3: Implement normal-window snapshot normalization**

Add these helpers and replace `listActiveTabsSnapshot`:

```ts
import type {
  ActiveBrowserTab,
  ActiveChromeWindowInfo,
  ActiveTabsSnapshot,
  ChromeTabGroupInfo,
} from './types';

function normalizeNormalWindows(windows: chrome.windows.Window[]): ActiveChromeWindowInfo[] {
  return windows
    .filter(
      (window): window is chrome.windows.Window & { id: number; type: 'normal' } =>
        typeof window.id === 'number' && window.type === 'normal',
    )
    .map((window) => ({
      id: window.id,
      focused: window.focused,
      incognito: window.incognito,
      type: 'normal',
    }));
}

export async function listActiveTabsSnapshot(): Promise<AppResult<ActiveTabsSnapshot>> {
  const tabsResponse = await listActiveTabs();
  if (!tabsResponse.ok) return tabsResponse;

  try {
    const [rawWindows, rawGroups] = await Promise.all([
      browser.windows.getAll({ populate: false, windowTypes: ['normal'] }),
      listChromeTabGroups(),
    ]);
    const normalWindows = normalizeNormalWindows(rawWindows);
    const normalWindowIds = new Set(normalWindows.map((window) => window.id));
    const tabs = tabsResponse.data.filter((tab) => normalWindowIds.has(tab.windowId));
    const visibleWindowIds = new Set(tabs.map((tab) => tab.windowId));

    return ok({
      windows: normalWindows.filter((window) => visibleWindowIds.has(window.id)),
      tabs,
      chromeGroups: rawGroups.filter((group) => visibleWindowIds.has(group.windowId)),
    });
  } catch (error) {
    return err('chrome-tabs-error', toErrorMessage(error));
  }
}
```

Keep `listActiveTabs()` unchanged because Quick Links still consumes `active-tabs:list` across eligible open tabs.

- [ ] **Step 4: Centralize snapshot fixtures**

Add this helper near the bottom of `App.test.tsx`, remove every inline `{ tabs, chromeGroups } satisfies ActiveTabsSnapshot` literal, and call `activeTabsSnapshot(tabs, options)` instead:

```ts
function activeTabsSnapshot(
  tabs: ActiveBrowserTab[],
  options: {
    chromeGroups?: ActiveTabsSnapshot['chromeGroups'];
    focusedWindowId?: number;
  } = {},
): ActiveTabsSnapshot {
  const windowIds = [...new Set(tabs.map((tab) => tab.windowId))].sort((a, b) => a - b);
  const focusedWindowId = options.focusedWindowId ?? windowIds[0];

  return {
    windows: windowIds.map((id) => ({
      id,
      focused: id === focusedWindowId,
      incognito: false,
      type: 'normal',
    })),
    tabs,
    chromeGroups: options.chromeGroups ?? [],
  };
}
```

Replace `mockMessages` so later tests can select the focused window and group metadata while preserving every existing response:

```ts
function mockMessages({
  activeTabs,
  chromeGroups = [],
  focusedWindowId,
  sessions = SESSIONS,
}: {
  activeTabs: ActiveBrowserTab[];
  chromeGroups?: ActiveTabsSnapshot['chromeGroups'];
  focusedWindowId?: number;
  sessions?: TabSession[];
}) {
  sendExtensionMessage.mockImplementation(async (message: ExtensionMessage) => {
    if (message.type === 'active-tabs:snapshot') {
      return {
        ok: true,
        data: activeTabsSnapshot(activeTabs, { chromeGroups, focusedWindowId }),
      };
    }

    if (message.type === 'active-tabs:list') return { ok: true, data: activeTabs };
    if (message.type === 'sessions:list') return { ok: true, data: sessions };
    if (message.type === 'active-tabs:close') {
      return { ok: true, data: { closed: true, tabCount: message.tabIds.length } };
    }
    if (message.type === 'active-tabs:focus') {
      return { ok: true, data: { focused: true } };
    }
    if (message.type === 'quick-links:add') {
      const saved = await saveQuickLinks([...((await getQuickLinks()) as QuickLink[]), message.link]);
      return { ok: true, data: saved };
    }
    if (message.type === 'quick-links:update') {
      const currentLinks = (await getQuickLinks()) as QuickLink[];
      const saved = await saveQuickLinks(
        currentLinks.map((link) =>
          link.id === message.linkId ? updateQuickLink(link, message.patch) : link,
        ),
      );
      return { ok: true, data: saved };
    }
    if (message.type === 'quick-links:remove') {
      const saved = await saveQuickLinks(
        ((await getQuickLinks()) as QuickLink[]).filter((link) => link.id !== message.linkId),
      );
      return { ok: true, data: saved };
    }
    if (message.type === 'quick-links:reorder') {
      const saved = await saveQuickLinks(
        reorderQuickLinks((await getQuickLinks()) as QuickLink[], message.orderedIds),
      );
      return { ok: true, data: saved };
    }
    if (message.type === 'chrome-tab-groups:sync') {
      return { ok: true, data: message.state };
    }
    if (message.type === 'chrome-tab-groups:import') {
      return {
        ok: true,
        data: { manualGroups: message.manualGroups, chromeTabGroups: message.state },
      };
    }
    if (message.type === 'chrome-tab-groups:collapse-window') {
      return { ok: true, data: { collapsed: true, groupCount: 1 } };
    }
    if (message.type === 'sessions:stow-current-window') {
      return {
        ok: true,
        data: { sessionId: 'session-1', savedTabCount: 2, closedTabCount: 2 },
      };
    }
    throw new Error(`Unexpected message: ${message.type}`);
  });
}
```

Update the two existing `active-tabs-service.test.ts` snapshot expectations to include the default normal window:

```ts
windows: [{ id: 2, focused: true, incognito: false, type: 'normal' }],
```

Update the background snapshot fixture and expectation to contain:

```ts
windows: [{ id: 2, focused: true, incognito: false, type: 'normal' }],
```

- [ ] **Step 5: Verify snapshot tests, full extension typecheck, and commit**

Run from `apps/extension`:

```bash
rtk bun run test src/features/active-tabs/active-tabs-service.test.ts src/entrypoints/newtab/App.test.tsx src/tests/background.test.ts
rtk bun run typecheck
```

Expected: all selected tests pass and typecheck exits 0.

```bash
rtk git add apps/extension/src/features/active-tabs/active-tabs-service.ts apps/extension/src/features/active-tabs/active-tabs-service.test.ts apps/extension/src/entrypoints/newtab/App.test.tsx apps/extension/src/tests/background.test.ts
rtk git commit -m "feat(active-tabs): include normal windows in snapshots"
```

---

### Task 3: Move Tabs Through Fresh Chrome State

**Files:**

- Create: `apps/extension/src/features/active-tabs/active-tab-moves.ts`
- Create: `apps/extension/src/features/active-tabs/active-tab-moves.test.ts`
- Modify: `apps/extension/src/features/active-tabs/types.ts`

**Interfaces:**

- Consumes: semantic lane and anchor destinations plus fresh `tabs`, `windows`, and `tabGroups` state.
- Produces: `moveActiveTab(request): Promise<AppResult<ActiveTabsMoveResult>>` for background routing.

- [ ] **Step 1: Add move request/result types**

Add the following to `types.ts` as the desired public API used by the failing tests:

```ts
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

export type ActiveTabsDragSource =
  | { kind: 'tab'; tabId: number; windowId: number; pinned: boolean; incognito: boolean }
  | { kind: 'group'; groupId: number; windowId: number; incognito: boolean };
```

- [ ] **Step 2: Write failing tab-move tests**

Create a hoisted browser mock with `tabs.get/group/move/query/ungroup`, `tabGroups.get`, and `windows.get`. Add tests with explicit fresh-query results:

```ts
it('reorders an ungrouped tab after a fresh tab anchor', async () => {
  browserMocks.tabs.get.mockResolvedValue({ id: 10, windowId: 2, index: 0, pinned: false, groupId: -1 });
  browserMocks.windows.get.mockResolvedValue({ id: 2, type: 'normal', incognito: false });
  browserMocks.tabs.query.mockResolvedValue([
    { id: 10, windowId: 2, index: 0, pinned: false, groupId: -1 },
    { id: 11, windowId: 2, index: 1, pinned: false, groupId: -1 },
  ]);

  const { moveActiveTab } = await import('./active-tab-moves');
  const result = await moveActiveTab({
    tabId: 10,
    destination: {
      windowId: 2,
      lane: { kind: 'ungrouped' },
      position: { kind: 'after', anchor: { kind: 'tab', tabId: 11 } },
    },
  });

  expect(browserMocks.tabs.move).toHaveBeenCalledWith(10, { index: 1 });
  expect(result).toEqual({ ok: true, data: { moved: true } });
});

it('groups an ungrouped tab and resolves its final group position again', async () => {
  browserMocks.tabs.get
    .mockResolvedValueOnce({ id: 10, windowId: 2, index: 0, pinned: false, groupId: -1 })
    .mockResolvedValueOnce({ id: 10, windowId: 2, index: 2, pinned: false, groupId: 31 });
  browserMocks.windows.get.mockResolvedValue({ id: 2, type: 'normal', incognito: false });
  browserMocks.tabGroups.get.mockResolvedValue({ id: 31, windowId: 2 });
  browserMocks.tabs.query
    .mockResolvedValueOnce([
      { id: 10, windowId: 2, index: 0, pinned: false, groupId: -1 },
      { id: 11, windowId: 2, index: 1, pinned: false, groupId: 31 },
    ])
    .mockResolvedValueOnce([
      { id: 11, windowId: 2, index: 1, pinned: false, groupId: 31 },
      { id: 10, windowId: 2, index: 2, pinned: false, groupId: 31 },
    ]);

  const { moveActiveTab } = await import('./active-tab-moves');
  const result = await moveActiveTab({
    tabId: 10,
    destination: {
      windowId: 2,
      lane: { kind: 'group', groupId: 31 },
      position: { kind: 'before', anchor: { kind: 'tab', tabId: 11 } },
    },
  });

  expect(browserMocks.tabs.group).toHaveBeenCalledWith({ groupId: 31, tabIds: 10 });
  expect(browserMocks.tabs.move).toHaveBeenCalledWith(10, { index: 1 });
  expect(result).toEqual({ ok: true, data: { moved: true } });
});

it('ungroups before resolving an ungrouped group boundary', async () => {
  browserMocks.tabs.get
    .mockResolvedValueOnce({ id: 10, windowId: 2, index: 0, pinned: false, groupId: 31 })
    .mockResolvedValueOnce({ id: 10, windowId: 2, index: 0, pinned: false, groupId: -1 });
  browserMocks.windows.get.mockResolvedValue({ id: 2, type: 'normal', incognito: false });
  browserMocks.tabs.query
    .mockResolvedValueOnce([
      { id: 10, windowId: 2, index: 0, pinned: false, groupId: 31 },
      { id: 11, windowId: 2, index: 1, pinned: false, groupId: 32 },
    ])
    .mockResolvedValueOnce([
      { id: 10, windowId: 2, index: 0, pinned: false, groupId: -1 },
      { id: 11, windowId: 2, index: 1, pinned: false, groupId: 32 },
    ]);

  const { moveActiveTab } = await import('./active-tab-moves');
  await moveActiveTab({
    tabId: 10,
    destination: {
      windowId: 2,
      lane: { kind: 'ungrouped' },
      position: { kind: 'after', anchor: { kind: 'group', groupId: 32 } },
    },
  });

  expect(browserMocks.tabs.ungroup).toHaveBeenCalledWith(10);
  expect(browserMocks.tabs.move).toHaveBeenCalledWith(10, { index: 1 });
});

it('rejects pinned and incognito lane mismatches without mutation', async () => {
  browserMocks.tabs.get.mockResolvedValue({ id: 10, windowId: 2, index: 0, pinned: true, groupId: -1 });
  browserMocks.windows.get
    .mockResolvedValueOnce({ id: 2, type: 'normal', incognito: false })
    .mockResolvedValueOnce({ id: 3, type: 'normal', incognito: true });

  const { moveActiveTab } = await import('./active-tab-moves');
  const result = await moveActiveTab({
    tabId: 10,
    destination: { windowId: 3, lane: { kind: 'ungrouped' }, position: { kind: 'end' } },
  });

  expect(result).toEqual({
    ok: false,
    error: { code: 'chrome-tabs-error', message: 'Tabs cannot move between regular and incognito windows.' },
  });
  expect(browserMocks.tabs.move).not.toHaveBeenCalled();
  expect(browserMocks.tabs.group).not.toHaveBeenCalled();
  expect(browserMocks.tabs.ungroup).not.toHaveBeenCalled();
});
```

Add the effective no-op case:

```ts
it('does not mutate Chrome when the tab is already at the resolved position', async () => {
  const source = { id: 10, windowId: 2, index: 0, pinned: false, groupId: -1 };
  browserMocks.tabs.get.mockResolvedValue(source);
  browserMocks.windows.get.mockResolvedValue({ id: 2, type: 'normal', incognito: false });
  browserMocks.tabs.query.mockResolvedValue([
    source,
    { id: 11, windowId: 2, index: 1, pinned: false, groupId: -1 },
  ]);

  const { moveActiveTab } = await import('./active-tab-moves');
  const result = await moveActiveTab({
    tabId: 10,
    destination: {
      windowId: 2,
      lane: { kind: 'ungrouped' },
      position: { kind: 'before', anchor: { kind: 'tab', tabId: 11 } },
    },
  });

  expect(result).toEqual({ ok: true, data: { moved: false } });
  expect(browserMocks.tabs.move).not.toHaveBeenCalled();
  expect(browserMocks.tabs.group).not.toHaveBeenCalled();
  expect(browserMocks.tabs.ungroup).not.toHaveBeenCalled();
});
```

- [ ] **Step 3: Verify RED**

Run from `apps/extension`:

```bash
rtk bun run test src/features/active-tabs/active-tab-moves.test.ts
```

Expected: FAIL because `moveActiveTab` does not exist.

- [ ] **Step 4: Implement fresh-state tab movement**

Create `active-tab-moves.ts` with these complete internal rules and the public function:

```ts
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
  if (position.anchor.kind === 'tab') {
    const anchor = tabs.find((tab) => tab.id === position.anchor.tabId);
    if (!anchor) throw new Error('The drop anchor no longer exists.');
    return [anchor];
  }
  const matches = tabs.filter((tab) => groupId(tab) === position.anchor.groupId);
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

function resolvedFinalIndex(
  tabs: IndexedTab[],
  tabId: number,
  lane: ActiveTabLane,
  position: ActiveTabsPosition,
): number {
  const source = tabs.find((tab) => tab.id === tabId);
  if (!source) throw new Error('The moved tab no longer exists in the target window.');
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
    let source = await browser.tabs.get(request.tabId);
    if (typeof source.id !== 'number') throw new Error('The moved tab no longer exists.');
    const [sourceWindow, targetWindow] = await Promise.all([
      requireNormalWindow(source.windowId),
      requireNormalWindow(request.destination.windowId),
    ]);
    if (sourceWindow.incognito !== targetWindow.incognito) {
      throw new Error('Tabs cannot move between regular and incognito windows.');
    }

    const targetIsPinned = request.destination.lane.kind === 'pinned';
    if (Boolean(source.pinned) !== targetIsPinned) {
      throw new Error('Pinned state cannot be changed by dragging.');
    }

    if (request.destination.lane.kind === 'group') {
      const targetGroup = await browser.tabGroups.get(request.destination.lane.groupId);
      if (targetGroup.windowId !== request.destination.windowId) {
        throw new Error('The target group moved to another window.');
      }
    }

    let targetTabs = await queryWindowTabs(request.destination.windowId);
    insertionBoundary(targetTabs, request.destination.lane, request.destination.position);

    if (source.windowId === request.destination.windowId && laneMatches(source, request.destination.lane)) {
      const index = resolvedFinalIndex(
        targetTabs,
        request.tabId,
        request.destination.lane,
        request.destination.position,
      );
      if (source.index === index) return ok({ moved: false });
    }

    let moved = false;
    if (source.windowId !== request.destination.windowId) {
      const index = source.pinned ? targetTabs.filter((tab) => tab.pinned).length : -1;
      await browser.tabs.move(request.tabId, { windowId: request.destination.windowId, index });
      moved = true;
      source = await browser.tabs.get(request.tabId);
    }

    if (request.destination.lane.kind === 'group' && groupId(source) !== request.destination.lane.groupId) {
      await browser.tabs.group({ groupId: request.destination.lane.groupId, tabIds: request.tabId });
      moved = true;
      source = await browser.tabs.get(request.tabId);
    } else if (request.destination.lane.kind === 'ungrouped' && groupId(source) !== NO_GROUP) {
      await browser.tabs.ungroup(request.tabId);
      moved = true;
      source = await browser.tabs.get(request.tabId);
    }

    targetTabs = await queryWindowTabs(request.destination.windowId);
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
```

- [ ] **Step 5: Add the remaining tab mutation matrix**

Add explicit tests using the same browser mock for these inputs and assertions:

```ts
it.each([
  {
    name: 'unpinned source into pinned lane',
    source: { id: 10, windowId: 2, index: 0, pinned: false, groupId: -1 },
    lane: { kind: 'pinned' } as const,
    message: 'Pinned state cannot be changed by dragging.',
  },
  {
    name: 'pinned source into a group lane',
    source: { id: 10, windowId: 2, index: 0, pinned: true, groupId: -1 },
    lane: { kind: 'group', groupId: 31 } as const,
    message: 'Pinned state cannot be changed by dragging.',
  },
])('rejects $name', async ({ source, lane, message }) => {
  browserMocks.tabs.get.mockResolvedValue(source);
  browserMocks.windows.get.mockResolvedValue({ id: 2, type: 'normal', incognito: false });

  const { moveActiveTab } = await import('./active-tab-moves');
  const result = await moveActiveTab({
    tabId: 10,
    destination: { windowId: 2, lane, position: { kind: 'end' } },
  });

  expect(result).toEqual({ ok: false, error: { code: 'chrome-tabs-error', message } });
  expect(browserMocks.tabs.move).not.toHaveBeenCalled();
});
```

Add these structural and failure tests; the cross-window case includes a hidden tab at index 0 so the expected final index proves that the resolver uses the complete Chrome query:

```ts
it('moves across windows, joins the target group, and counts hidden tabs', async () => {
  browserMocks.tabs.get
    .mockResolvedValueOnce({ id: 10, windowId: 2, index: 0, pinned: false, groupId: -1 })
    .mockResolvedValueOnce({ id: 10, windowId: 3, index: 2, pinned: false, groupId: -1 })
    .mockResolvedValueOnce({ id: 10, windowId: 3, index: 2, pinned: false, groupId: 31 });
  browserMocks.windows.get
    .mockResolvedValueOnce({ id: 2, type: 'normal', incognito: false })
    .mockResolvedValueOnce({ id: 3, type: 'normal', incognito: false });
  browserMocks.tabGroups.get.mockResolvedValue({ id: 31, windowId: 3 });
  browserMocks.tabs.query
    .mockResolvedValueOnce([
      { id: 90, windowId: 3, index: 0, pinned: false, groupId: -1, url: 'chrome://settings' },
      { id: 11, windowId: 3, index: 1, pinned: false, groupId: 31 },
    ])
    .mockResolvedValueOnce([
      { id: 90, windowId: 3, index: 0, pinned: false, groupId: -1, url: 'chrome://settings' },
      { id: 11, windowId: 3, index: 1, pinned: false, groupId: 31 },
      { id: 10, windowId: 3, index: 2, pinned: false, groupId: 31 },
    ]);

  const { moveActiveTab } = await import('./active-tab-moves');
  const result = await moveActiveTab({
    tabId: 10,
    destination: {
      windowId: 3,
      lane: { kind: 'group', groupId: 31 },
      position: { kind: 'before', anchor: { kind: 'tab', tabId: 11 } },
    },
  });

  expect(browserMocks.tabs.move).toHaveBeenNthCalledWith(1, 10, { windowId: 3, index: -1 });
  expect(browserMocks.tabs.group).toHaveBeenCalledWith({ groupId: 31, tabIds: 10 });
  expect(browserMocks.tabs.move).toHaveBeenNthCalledWith(2, 10, { index: 1 });
  expect(result).toEqual({ ok: true, data: { moved: true } });
});

it('moves a tab from one Chrome group to another', async () => {
  browserMocks.tabs.get
    .mockResolvedValueOnce({ id: 10, windowId: 2, index: 0, pinned: false, groupId: 32 })
    .mockResolvedValueOnce({ id: 10, windowId: 2, index: 2, pinned: false, groupId: 31 });
  browserMocks.windows.get.mockResolvedValue({ id: 2, type: 'normal', incognito: false });
  browserMocks.tabGroups.get.mockResolvedValue({ id: 31, windowId: 2 });
  browserMocks.tabs.query
    .mockResolvedValueOnce([
      { id: 10, windowId: 2, index: 0, pinned: false, groupId: 32 },
      { id: 11, windowId: 2, index: 1, pinned: false, groupId: 31 },
    ])
    .mockResolvedValueOnce([
      { id: 11, windowId: 2, index: 1, pinned: false, groupId: 31 },
      { id: 10, windowId: 2, index: 2, pinned: false, groupId: 31 },
    ]);

  const { moveActiveTab } = await import('./active-tab-moves');
  await moveActiveTab({
    tabId: 10,
    destination: {
      windowId: 2,
      lane: { kind: 'group', groupId: 31 },
      position: { kind: 'end' },
    },
  });

  expect(browserMocks.tabs.group).toHaveBeenCalledWith({ groupId: 31, tabIds: 10 });
});

it('reports an anchor that disappears after membership changes', async () => {
  browserMocks.tabs.get
    .mockResolvedValueOnce({ id: 10, windowId: 2, index: 0, pinned: false, groupId: 31 })
    .mockResolvedValueOnce({ id: 10, windowId: 2, index: 0, pinned: false, groupId: -1 });
  browserMocks.windows.get.mockResolvedValue({ id: 2, type: 'normal', incognito: false });
  browserMocks.tabs.query
    .mockResolvedValueOnce([
      { id: 10, windowId: 2, index: 0, pinned: false, groupId: 31 },
      { id: 11, windowId: 2, index: 1, pinned: false, groupId: 32 },
    ])
    .mockResolvedValueOnce([
      { id: 10, windowId: 2, index: 0, pinned: false, groupId: -1 },
    ]);

  const { moveActiveTab } = await import('./active-tab-moves');
  const result = await moveActiveTab({
    tabId: 10,
    destination: {
      windowId: 2,
      lane: { kind: 'ungrouped' },
      position: { kind: 'after', anchor: { kind: 'group', groupId: 32 } },
    },
  });

  expect(browserMocks.tabs.ungroup).toHaveBeenCalledTimes(1);
  expect(browserMocks.tabs.move).not.toHaveBeenCalled();
  expect(result).toEqual({
    ok: false,
    error: { code: 'chrome-tabs-error', message: 'The drop group no longer exists.' },
  });
});

it('does not retry Chrome while a native tab drag blocks editing', async () => {
  browserMocks.tabs.get.mockResolvedValue({ id: 10, windowId: 2, index: 0, pinned: false, groupId: -1 });
  browserMocks.windows.get.mockResolvedValue({ id: 2, type: 'normal', incognito: false });
  browserMocks.tabs.query.mockResolvedValue([
    { id: 10, windowId: 2, index: 0, pinned: false, groupId: -1 },
    { id: 11, windowId: 2, index: 1, pinned: false, groupId: -1 },
  ]);
  browserMocks.tabs.move.mockRejectedValue(
    new Error('Tabs cannot be edited right now (user may be dragging a tab).'),
  );

  const { moveActiveTab } = await import('./active-tab-moves');
  const result = await moveActiveTab({
    tabId: 10,
    destination: {
      windowId: 2,
      lane: { kind: 'ungrouped' },
      position: { kind: 'after', anchor: { kind: 'tab', tabId: 11 } },
    },
  });

  expect(browserMocks.tabs.move).toHaveBeenCalledTimes(1);
  expect(browserMocks.tabs.group).not.toHaveBeenCalled();
  expect(browserMocks.tabs.ungroup).not.toHaveBeenCalled();
  expect(result).toEqual({
    ok: false,
    error: {
      code: 'chrome-tabs-error',
      message: 'Tabs cannot be edited right now (user may be dragging a tab).',
    },
  });
});

it('reorders a tab within its existing Chrome group', async () => {
  browserMocks.tabs.get.mockResolvedValue({ id: 10, windowId: 2, index: 1, pinned: false, groupId: 31 });
  browserMocks.windows.get.mockResolvedValue({ id: 2, type: 'normal', incognito: false });
  browserMocks.tabGroups.get.mockResolvedValue({ id: 31, windowId: 2 });
  browserMocks.tabs.query.mockResolvedValue([
    { id: 90, windowId: 2, index: 0, pinned: false, groupId: -1, url: 'chrome://settings' },
    { id: 10, windowId: 2, index: 1, pinned: false, groupId: 31 },
    { id: 11, windowId: 2, index: 2, pinned: false, groupId: 31 },
  ]);

  const { moveActiveTab } = await import('./active-tab-moves');
  const result = await moveActiveTab({
    tabId: 10,
    destination: {
      windowId: 2,
      lane: { kind: 'group', groupId: 31 },
      position: { kind: 'after', anchor: { kind: 'tab', tabId: 11 } },
    },
  });

  expect(browserMocks.tabs.group).not.toHaveBeenCalled();
  expect(browserMocks.tabs.move).toHaveBeenCalledWith(10, { index: 2 });
  expect(result).toEqual({ ok: true, data: { moved: true } });
});

it('moves a pinned tab to another window pinned lane without changing pinned state', async () => {
  browserMocks.tabs.get
    .mockResolvedValueOnce({ id: 10, windowId: 2, index: 0, pinned: true, groupId: -1 })
    .mockResolvedValueOnce({ id: 10, windowId: 3, index: 1, pinned: true, groupId: -1 });
  browserMocks.windows.get
    .mockResolvedValueOnce({ id: 2, type: 'normal', incognito: false })
    .mockResolvedValueOnce({ id: 3, type: 'normal', incognito: false });
  browserMocks.tabs.query
    .mockResolvedValueOnce([
      { id: 20, windowId: 3, index: 0, pinned: true, groupId: -1 },
      { id: 21, windowId: 3, index: 1, pinned: false, groupId: -1 },
    ])
    .mockResolvedValueOnce([
      { id: 20, windowId: 3, index: 0, pinned: true, groupId: -1 },
      { id: 10, windowId: 3, index: 1, pinned: true, groupId: -1 },
      { id: 21, windowId: 3, index: 2, pinned: false, groupId: -1 },
    ]);

  const { moveActiveTab } = await import('./active-tab-moves');
  const result = await moveActiveTab({
    tabId: 10,
    destination: {
      windowId: 3,
      lane: { kind: 'pinned' },
      position: { kind: 'after', anchor: { kind: 'tab', tabId: 20 } },
    },
  });

  expect(browserMocks.tabs.move).toHaveBeenCalledTimes(1);
  expect(browserMocks.tabs.move).toHaveBeenCalledWith(10, { windowId: 3, index: 1 });
  expect(browserMocks.tabs.group).not.toHaveBeenCalled();
  expect(browserMocks.tabs.ungroup).not.toHaveBeenCalled();
  expect(result).toEqual({ ok: true, data: { moved: true } });
});
```

- [ ] **Step 6: Verify GREEN and commit**

Run from `apps/extension`:

```bash
rtk bun run test src/features/active-tabs/active-tab-moves.test.ts
rtk bun run typecheck
```

Expected: all move tests pass and typecheck exits 0.

```bash
rtk git add apps/extension/src/features/active-tabs/types.ts apps/extension/src/features/active-tabs/active-tab-moves.ts apps/extension/src/features/active-tabs/active-tab-moves.test.ts
rtk git commit -m "feat(active-tabs): move tabs through Chrome state"
```

---

### Task 4: Move Complete Native Chrome Groups

**Files:**

- Modify: `apps/extension/src/features/active-tabs/active-tab-moves.ts`
- Modify: `apps/extension/src/features/active-tabs/active-tab-moves.test.ts`

**Interfaces:**

- Consumes: `ActiveGroupMoveRequest` and the tab-move module's normal-window/query helpers.
- Produces: `moveActiveTabGroup(request): Promise<AppResult<ActiveTabsMoveResult>>`.

- [ ] **Step 1: Write failing group-move tests**

Add tests for same-window ordering, removal-adjusted indices, cross-window movement, self/no-op, and invalid split anchors:

```ts
it('moves a complete group after another complete group without splitting it', async () => {
  browserMocks.tabGroups.get.mockResolvedValue({ id: 31, windowId: 2 });
  browserMocks.windows.get.mockResolvedValue({ id: 2, type: 'normal', incognito: false });
  browserMocks.tabs.query.mockResolvedValue([
    { id: 1, windowId: 2, index: 0, pinned: false, groupId: 31 },
    { id: 2, windowId: 2, index: 1, pinned: false, groupId: 31 },
    { id: 3, windowId: 2, index: 2, pinned: false, groupId: 32 },
    { id: 4, windowId: 2, index: 3, pinned: false, groupId: 32 },
  ]);

  const { moveActiveTabGroup } = await import('./active-tab-moves');
  const result = await moveActiveTabGroup({
    groupId: 31,
    sourceWindowId: 2,
    destination: {
      windowId: 2,
      position: { kind: 'after', anchor: { kind: 'group', groupId: 32 } },
    },
  });

  expect(browserMocks.tabGroups.move).toHaveBeenCalledWith(31, { windowId: 2, index: 2 });
  expect(result).toEqual({ ok: true, data: { moved: true } });
});

it('rejects a grouped tab anchor because it would split a group', async () => {
  browserMocks.tabGroups.get.mockResolvedValue({ id: 31, windowId: 2 });
  browserMocks.windows.get.mockResolvedValue({ id: 2, type: 'normal', incognito: false });
  browserMocks.tabs.query.mockResolvedValue([
    { id: 1, windowId: 2, index: 0, pinned: false, groupId: 31 },
    { id: 2, windowId: 2, index: 1, pinned: false, groupId: 32 },
  ]);

  const { moveActiveTabGroup } = await import('./active-tab-moves');
  const result = await moveActiveTabGroup({
    groupId: 31,
    sourceWindowId: 2,
    destination: {
      windowId: 2,
      position: { kind: 'before', anchor: { kind: 'tab', tabId: 2 } },
    },
  });

  expect(result).toEqual({
    ok: false,
    error: { code: 'chrome-tabs-error', message: 'Group moves cannot split another Chrome group.' },
  });
  expect(browserMocks.tabGroups.move).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Verify RED**

Run from `apps/extension`:

```bash
rtk bun run test src/features/active-tabs/active-tab-moves.test.ts
```

Expected: FAIL because `moveActiveTabGroup` is missing.

- [ ] **Step 3: Implement complete-group movement**

Extend the existing type import from `./types` with `ActiveGroupMoveRequest`, keep `requireNormalWindow` and `queryWindowTabs` private to the module, then append:

```ts
function groupMoveBoundary(
  tabs: IndexedTab[],
  sourceGroupId: number,
  position: ActiveTabsPosition,
): number {
  if (position.kind === 'end') return tabs.length;
  if (position.anchor.kind === 'group') {
    if (position.anchor.groupId === sourceGroupId) return -1;
    const groupTabs = tabs.filter((tab) => groupId(tab) === position.anchor.groupId);
    if (groupTabs.length === 0) throw new Error('The drop group no longer exists.');
    const first = Math.min(...groupTabs.map((tab) => tab.index));
    const last = Math.max(...groupTabs.map((tab) => tab.index));
    return position.kind === 'before' ? first : last + 1;
  }

  const anchor = tabs.find((tab) => tab.id === position.anchor.tabId);
  if (!anchor) throw new Error('The drop anchor no longer exists.');
  if (anchor.pinned || groupId(anchor) !== NO_GROUP) {
    throw new Error('Group moves cannot split another Chrome group.');
  }
  return position.kind === 'before' ? anchor.index : anchor.index + 1;
}

export async function moveActiveTabGroup(
  request: ActiveGroupMoveRequest,
): Promise<AppResult<ActiveTabsMoveResult>> {
  try {
    const sourceGroup = await browser.tabGroups.get(request.groupId);
    if (sourceGroup.windowId !== request.sourceWindowId) {
      throw new Error('The dragged Chrome group moved to another window.');
    }
    const [sourceWindow, targetWindow] = await Promise.all([
      requireNormalWindow(sourceGroup.windowId),
      requireNormalWindow(request.destination.windowId),
    ]);
    if (sourceWindow.incognito !== targetWindow.incognito) {
      throw new Error('Groups cannot move between regular and incognito windows.');
    }

    const targetTabs = await queryWindowTabs(request.destination.windowId);
    const sourceTabs = sourceGroup.windowId === request.destination.windowId
      ? targetTabs.filter((tab) => groupId(tab) === request.groupId)
      : [];
    if (sourceGroup.windowId === request.destination.windowId && sourceTabs.length === 0) {
      throw new Error('The dragged Chrome group has no tabs.');
    }

    const boundary = groupMoveBoundary(targetTabs, request.groupId, request.destination.position);
    if (boundary === -1) return ok({ moved: false });
    const removedBeforeBoundary = sourceTabs.filter((tab) => tab.index < boundary).length;
    const resolvedIndex = Math.max(0, boundary - removedBeforeBoundary);
    const currentIndex = sourceTabs.length === 0
      ? -1
      : Math.min(...sourceTabs.map((tab) => tab.index));
    const alreadyAtEnd = request.destination.position.kind === 'end'
      && sourceTabs.length > 0
      && Math.max(...sourceTabs.map((tab) => tab.index)) === targetTabs.length - 1;

    if (currentIndex === resolvedIndex || alreadyAtEnd) return ok({ moved: false });

    await browser.tabGroups.move(request.groupId, {
      windowId: request.destination.windowId,
      index: request.destination.position.kind === 'end' ? -1 : resolvedIndex,
    });
    return ok({ moved: true });
  } catch (error) {
    return err('chrome-tabs-error', toErrorMessage(error));
  }
}
```

- [ ] **Step 4: Complete group-move coverage**

Add these remaining boundary and failure cases:

```ts
it('moves a group before an ungrouped tab in another normal window', async () => {
  browserMocks.tabGroups.get.mockResolvedValue({ id: 31, windowId: 2 });
  browserMocks.windows.get
    .mockResolvedValueOnce({ id: 2, type: 'normal', incognito: false })
    .mockResolvedValueOnce({ id: 3, type: 'normal', incognito: false });
  browserMocks.tabs.query.mockResolvedValue([
    { id: 90, windowId: 3, index: 0, pinned: false, groupId: -1, url: 'chrome://settings' },
    { id: 11, windowId: 3, index: 1, pinned: false, groupId: -1 },
  ]);

  const { moveActiveTabGroup } = await import('./active-tab-moves');
  const result = await moveActiveTabGroup({
    groupId: 31,
    sourceWindowId: 2,
    destination: {
      windowId: 3,
      position: { kind: 'before', anchor: { kind: 'tab', tabId: 11 } },
    },
  });

  expect(browserMocks.tabGroups.move).toHaveBeenCalledWith(31, { windowId: 3, index: 1 });
  expect(result).toEqual({ ok: true, data: { moved: true } });
});

it('returns a no-op when the source group is already at the window end', async () => {
  browserMocks.tabGroups.get.mockResolvedValue({ id: 31, windowId: 2 });
  browserMocks.windows.get.mockResolvedValue({ id: 2, type: 'normal', incognito: false });
  browserMocks.tabs.query.mockResolvedValue([
    { id: 1, windowId: 2, index: 0, pinned: false, groupId: -1 },
    { id: 2, windowId: 2, index: 1, pinned: false, groupId: 31 },
    { id: 3, windowId: 2, index: 2, pinned: false, groupId: 31 },
  ]);

  const { moveActiveTabGroup } = await import('./active-tab-moves');
  const result = await moveActiveTabGroup({
    groupId: 31,
    sourceWindowId: 2,
    destination: { windowId: 2, position: { kind: 'end' } },
  });

  expect(result).toEqual({ ok: true, data: { moved: false } });
  expect(browserMocks.tabGroups.move).not.toHaveBeenCalled();
});

it.each([
  {
    name: 'source window changed',
    request: { groupId: 31, sourceWindowId: 9, destination: { windowId: 2, position: { kind: 'end' as const } } },
    sourceWindow: { id: 2, type: 'normal', incognito: false },
    targetWindow: { id: 2, type: 'normal', incognito: false },
    message: 'The dragged Chrome group moved to another window.',
  },
  {
    name: 'target is incognito-incompatible',
    request: { groupId: 31, sourceWindowId: 2, destination: { windowId: 3, position: { kind: 'end' as const } } },
    sourceWindow: { id: 2, type: 'normal', incognito: false },
    targetWindow: { id: 3, type: 'normal', incognito: true },
    message: 'Groups cannot move between regular and incognito windows.',
  },
])('rejects $name before mutation', async ({ request, sourceWindow, targetWindow, message }) => {
  browserMocks.tabGroups.get.mockResolvedValue({ id: 31, windowId: 2 });
  browserMocks.windows.get
    .mockResolvedValueOnce(sourceWindow)
    .mockResolvedValueOnce(targetWindow);

  const { moveActiveTabGroup } = await import('./active-tab-moves');
  const result = await moveActiveTabGroup(request);

  expect(result).toEqual({ ok: false, error: { code: 'chrome-tabs-error', message } });
  expect(browserMocks.tabGroups.move).not.toHaveBeenCalled();
});

it('returns the Chrome group move failure without retrying', async () => {
  browserMocks.tabGroups.get.mockResolvedValue({ id: 31, windowId: 2 });
  browserMocks.windows.get.mockResolvedValue({ id: 2, type: 'normal', incognito: false });
  browserMocks.tabs.query.mockResolvedValue([
    { id: 1, windowId: 2, index: 0, pinned: false, groupId: 31 },
    { id: 2, windowId: 2, index: 1, pinned: false, groupId: -1 },
  ]);
  browserMocks.tabGroups.move.mockRejectedValue(new Error('Group move failed'));

  const { moveActiveTabGroup } = await import('./active-tab-moves');
  const result = await moveActiveTabGroup({
    groupId: 31,
    sourceWindowId: 2,
    destination: { windowId: 2, position: { kind: 'end' } },
  });

  expect(browserMocks.tabGroups.move).toHaveBeenCalledTimes(1);
  expect(result).toEqual({
    ok: false,
    error: { code: 'chrome-tabs-error', message: 'Group move failed' },
  });
});
```

The first same-window test already covers source-removal index adjustment and complete-group anchors. Add the self-anchor case:

```ts
it('treats the source group as a no-op anchor', async () => {
  browserMocks.tabGroups.get.mockResolvedValue({ id: 31, windowId: 2 });
  browserMocks.windows.get.mockResolvedValue({ id: 2, type: 'normal', incognito: false });
  browserMocks.tabs.query.mockResolvedValue([
    { id: 1, windowId: 2, index: 0, pinned: false, groupId: 31 },
  ]);

  const { moveActiveTabGroup } = await import('./active-tab-moves');
  const result = await moveActiveTabGroup({
    groupId: 31,
    sourceWindowId: 2,
    destination: {
      windowId: 2,
      position: { kind: 'before', anchor: { kind: 'group', groupId: 31 } },
    },
  });

  expect(result).toEqual({ ok: true, data: { moved: false } });
  expect(browserMocks.tabGroups.move).not.toHaveBeenCalled();
});
```

- [ ] **Step 5: Verify GREEN and commit**

Run from `apps/extension`:

```bash
rtk bun run test src/features/active-tabs/active-tab-moves.test.ts
rtk bun run typecheck
```

Expected: all move tests pass and typecheck exits 0.

```bash
rtk git add apps/extension/src/features/active-tabs/active-tab-moves.ts apps/extension/src/features/active-tabs/active-tab-moves.test.ts
rtk git commit -m "feat(active-tabs): move native Chrome groups"
```

---

### Task 5: Route Typed Move Commands Through The Service Worker

**Files:**

- Modify: `apps/extension/src/lib/messages.ts:1-73`
- Modify: `apps/extension/src/lib/messages.test.ts`
- Modify: `apps/extension/src/entrypoints/background.ts:6-96`
- Modify: `apps/extension/src/tests/background.test.ts:50-323`

**Interfaces:**

- Consumes: `ActiveTabMoveRequest`, `ActiveGroupMoveRequest`, `moveActiveTab`, and `moveActiveTabGroup`.
- Produces: typed extension messages used by Task 7.

- [ ] **Step 1: Write failing routing tests**

Add `moveActiveTab` and `moveActiveTabGroup` to `activeTabsMocks`, then add:

```ts
it('routes semantic tab move messages', async () => {
  const request = {
    tabId: 10,
    destination: {
      windowId: 2,
      lane: { kind: 'ungrouped' as const },
      position: { kind: 'end' as const },
    },
  };
  activeTabsMocks.moveActiveTab.mockResolvedValue({ ok: true, data: { moved: false } });

  await import('../entrypoints/background');
  const { response } = await dispatchRuntimeMessage({ type: 'active-tabs:move-tab', request });

  expect(activeTabsMocks.moveActiveTab).toHaveBeenCalledWith(request);
  expect(response).toEqual({ ok: true, data: { moved: false } });
});

it('routes semantic group move messages', async () => {
  const request = {
    groupId: 31,
    sourceWindowId: 2,
    destination: { windowId: 3, position: { kind: 'end' as const } },
  };
  activeTabsMocks.moveActiveTabGroup.mockResolvedValue({ ok: true, data: { moved: true } });

  await import('../entrypoints/background');
  const { response } = await dispatchRuntimeMessage({ type: 'active-tabs:move-group', request });

  expect(activeTabsMocks.moveActiveTabGroup).toHaveBeenCalledWith(request);
  expect(response).toEqual({ ok: true, data: { moved: true } });
});
```

Add a `messages.test.ts` case in which `browser.runtime.sendMessage` resolves to `{ ok: true, data: { moved: false } }` and assert `sendExtensionMessage({ type: 'active-tabs:move-tab', request })` returns it unchanged.

- [ ] **Step 2: Verify RED**

Run from `apps/extension`:

```bash
rtk bun run test src/lib/messages.test.ts src/tests/background.test.ts
```

Expected: FAIL because the move variants and routes do not exist.

- [ ] **Step 3: Add message variants and response type**

Import the request/result types and extend `ExtensionMessage`:

```ts
import type {
  ActiveBrowserTab,
  ActiveGroupMoveRequest,
  ActiveTabMoveRequest,
  ActiveTabsMoveResult,
  ActiveTabsSnapshot,
} from '@/features/active-tabs/types';

// Inside ExtensionMessage:
| { type: 'active-tabs:move-tab'; request: ActiveTabMoveRequest }
| { type: 'active-tabs:move-group'; request: ActiveGroupMoveRequest }

// Inside ExtensionMessageResponse:
| AppResult<ActiveTabsMoveResult>
```

- [ ] **Step 4: Route both commands**

Import both functions from `active-tab-moves.ts` in `background.ts` and add:

```ts
case 'active-tabs:move-tab':
  return moveActiveTab(message.request);
case 'active-tabs:move-group':
  return moveActiveTabGroup(message.request);
```

- [ ] **Step 5: Verify GREEN and commit**

Run from `apps/extension`:

```bash
rtk bun run test src/lib/messages.test.ts src/tests/background.test.ts
rtk bun run typecheck
```

Expected: selected tests and typecheck pass.

```bash
rtk git add apps/extension/src/lib/messages.ts apps/extension/src/lib/messages.test.ts apps/extension/src/entrypoints/background.ts apps/extension/src/tests/background.test.ts
rtk git commit -m "feat(messaging): route active tab drag moves"
```

---

### Task 6: Render Chrome Windows Without Legacy Workspace State

**Files:**

- Create: `apps/extension/src/entrypoints/newtab/components/ActiveWindowSection.tsx`
- Modify: `apps/extension/src/entrypoints/newtab/components/ActiveWorkspace.tsx:1-399`
- Modify: `apps/extension/src/entrypoints/newtab/components/GroupNav.tsx:1-25`
- Modify: `apps/extension/src/entrypoints/newtab/App.test.tsx`
- Modify: `apps/extension/src/features/i18n/i18n.ts:8-151`
- Modify: `apps/extension/src/features/i18n/i18n.test.ts`

**Interfaces:**

- Consumes: `buildActiveTabWindows(snapshot)` and the existing focus/close/stow/collapse actions.
- Produces: Chrome-window UI and focused-window identity; no local workspace read or write remains.

- [ ] **Step 1: Replace legacy UI tests with failing Chrome-window tests**

Delete the tests that migrate, import, sync, or clear manual groups. Remove the active-workspace storage mocks. Add:

```ts
it('renders focused Chrome windows, pinned tabs, native groups, and ungrouped tabs in order', async () => {
  const tabs: ActiveBrowserTab[] = [
    { ...UNIQUE_TAB, id: 20, windowId: 8, index: 0, pinned: true, title: 'Pinned' },
    { ...UNIQUE_TAB, id: 21, windowId: 8, index: 1, groupId: -1, title: 'Before' },
    { ...UNIQUE_TAB, id: 22, windowId: 8, index: 2, groupId: 31, title: 'Grouped' },
    { ...UNIQUE_TAB, id: 23, windowId: 8, index: 3, groupId: -1, title: 'After' },
    { ...UNIQUE_TAB, id: 24, windowId: 3, index: 0, groupId: -1, title: 'Other window' },
  ];
  sendExtensionMessage.mockImplementation(async (message: ExtensionMessage) => {
    if (message.type === 'active-tabs:snapshot') {
      return {
        ok: true,
        data: activeTabsSnapshot(tabs, {
          focusedWindowId: 8,
          chromeGroups: [{ id: 31, windowId: 8, title: 'Reading', color: 'blue', collapsed: true }],
        }),
      };
    }
    if (message.type === 'sessions:list') return { ok: true, data: SESSIONS };
    throw new Error(`Unexpected message: ${message.type}`);
  });

  await renderApp();

  expect(screen().getByRole('heading', { name: 'Current window' })).not.toBeNull();
  expect(screen().getByRole('heading', { name: 'Window 2' })).not.toBeNull();
  expect(screen().getByText('Pinned tabs')).not.toBeNull();
  expect(screen().getByText('Reading')).not.toBeNull();
  expect(screen().getByText('Collapsed')).not.toBeNull();
  const activeText = container.querySelector('.active-window-list')?.textContent ?? '';
  expect(activeText.indexOf('Before')).toBeLessThan(activeText.indexOf('Reading'));
  expect(activeText.indexOf('Reading')).toBeLessThan(activeText.indexOf('After'));
  expect(() => screen().getByText('Import Chrome groups')).toThrow();
});

it('collapses groups in the focused Chrome window from snapshot metadata', async () => {
  mockMessages({ activeTabs: [UNIQUE_TAB], focusedWindowId: 4 });
  await renderApp();

  await click(screen().getByText('Collapse Chrome groups'));

  expect(sendExtensionMessage).toHaveBeenCalledWith({
    type: 'chrome-tab-groups:collapse-window',
    windowId: 4,
  });
});
```

- [ ] **Step 2: Verify RED**

Run from `apps/extension`:

```bash
rtk bun run test src/entrypoints/newtab/App.test.tsx
```

Expected: FAIL because ActiveWorkspace still requires local workspace state and renders URL/manual groups.

- [ ] **Step 3: Add localized Chrome-window copy**

Add matching English and Chinese keys:

```ts
activeTabsSubtitle: 'Mirrors eligible tabs, windows, and groups from Chrome.',
activeTabsNavigation: 'Active tab windows and groups',
allActiveTabs: 'All',
refreshFromChrome: 'Refresh from Chrome',
currentWindow: 'Current window',
windowNumber: 'Window {{number}}',
pinnedTabs: 'Pinned tabs',
chromeGroupFallback: 'Chrome group {{id}}',
chromeGroupCollapsed: 'Collapsed',
chromeGroupExpanded: 'Expanded',
dragTab: 'Drag {{label}}',
dragGroup: 'Drag {{label}} group',
```

```ts
activeTabsSubtitle: '与 Chrome 中可管理的标签页、窗口和分组保持一致。',
activeTabsNavigation: '标签页窗口和分组',
allActiveTabs: '全部',
refreshFromChrome: '从 Chrome 刷新',
currentWindow: '当前窗口',
windowNumber: '窗口 {{number}}',
pinnedTabs: '固定标签页',
chromeGroupFallback: 'Chrome 分组 {{id}}',
chromeGroupCollapsed: '已折叠',
chromeGroupExpanded: '已展开',
dragTab: '拖动 {{label}}',
dragGroup: '拖动 {{label}} 分组',
```

Replace the old `syncManualGroups` assertion in `i18n.test.ts` with interpolation assertions for `windowNumber`, `chromeGroupFallback`, and `dragTab`.

- [ ] **Step 4: Implement the window section component**

Create `ActiveWindowSection.tsx` with this public boundary and render contract:

```tsx
import { Archive, Trash2, X } from 'lucide-react';
import { getTabLabel } from '@/features/active-tabs/tab-labels';
import type { ActiveBrowserTab, ActiveTabWindow } from '@/features/active-tabs/types';
import { t, type Locale } from '@/features/i18n/i18n';

type Props = {
  disabled: boolean;
  displayIndex: number;
  locale: Locale;
  window: ActiveTabWindow;
  onCloseTabs: (tabIds: number[]) => void;
  onFocusTab: (tab: ActiveBrowserTab) => void;
  onRegisterTarget: (key: string, node: HTMLElement | null) => void;
  onStowTab: (tab: ActiveBrowserTab) => void;
};

export function ActiveWindowSection(props: Props) {
  const windowLabel = props.window.focused
    ? t(props.locale, 'currentWindow')
    : t(props.locale, 'windowNumber', { number: props.displayIndex + 1 });

  function tabRow(tab: ActiveBrowserTab) {
    const label = getTabLabel(tab);
    return (
      <div className="tab-row" key={tab.id ?? tab.url}>
        <button className="tab-open-button" type="button" onClick={() => props.onFocusTab(tab)}>
          <span className="favicon tone-blue" aria-hidden="true">
            {(label.match(/[A-Za-z0-9]/)?.[0] ?? 'T').toUpperCase()}
          </span>
          <span className="tab-copy">
            <span className="tab-title">{label}</span>
            <span className="tab-url">{tab.url ?? ''}</span>
          </span>
        </button>
        <div className="row-actions">
          <button type="button" className="icon-button" aria-label={t(props.locale, 'saveTabForLater', { label })} onClick={() => props.onStowTab(tab)} disabled={props.disabled}>
            <Archive size={14} aria-hidden="true" />
          </button>
          <button type="button" className="icon-button" aria-label={`Close ${label}`} onClick={() => typeof tab.id === 'number' && props.onCloseTabs([tab.id])} disabled={props.disabled}>
            <Trash2 size={14} aria-hidden="true" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <article className="active-window" ref={(node) => props.onRegisterTarget(props.window.key, node)}>
      <header className="active-window-header">
        <h3>{windowLabel}</h3>
        <span className="meta-pill">{props.window.visibleTabCount} open</span>
      </header>
      {props.window.pinnedTabs.length > 0 && (
        <section className="pinned-lane">
          <h4>{t(props.locale, 'pinnedTabs')}</h4>
          <div className="active-tab-list">{props.window.pinnedTabs.map(tabRow)}</div>
        </section>
      )}
      <div className="active-window-items">
        {props.window.items.map((item) => item.kind === 'tab' ? tabRow(item.tab) : (
          <article className="tab-group" key={item.key} ref={(node) => props.onRegisterTarget(item.key, node)}>
            <header>
              <div className="chrome-group-meta">
                <span className={`chrome-group-color chrome-group-color--${item.color ?? 'grey'}`} aria-hidden="true" />
                <h4>{item.title ?? t(props.locale, 'chromeGroupFallback', { id: item.groupId })}</h4>
                {item.collapsed !== null && (
                  <span className="status-pill">
                    {t(props.locale, item.collapsed ? 'chromeGroupCollapsed' : 'chromeGroupExpanded')}
                  </span>
                )}
              </div>
              <button type="button" className="icon-button" aria-label={`Close ${item.title ?? `Chrome group ${item.groupId}`} tabs`} onClick={() => props.onCloseTabs(item.tabs.map((tab) => tab.id).filter((id): id is number => typeof id === 'number'))} disabled={props.disabled}>
                <X size={16} aria-hidden="true" />
              </button>
            </header>
            <div className="active-tab-list">{item.tabs.map(tabRow)}</div>
          </article>
        ))}
      </div>
    </article>
  );
}
```

- [ ] **Step 5: Replace ActiveWorkspace local state with snapshot state**

Remove all active-workspace storage/manual imports and handlers. Use this state and refresh core:

```tsx
const EMPTY_SNAPSHOT: ActiveTabsSnapshot = { windows: [], tabs: [], chromeGroups: [] };

const [snapshot, setSnapshot] = useState<ActiveTabsSnapshot>(EMPTY_SNAPSHOT);
const [snapshotReady, setSnapshotReady] = useState(false);
const [closePending, setClosePending] = useState(false);
const targetRefs = useRef(new Map<string, HTMLElement>());
const closePendingRef = useRef(false);
const refreshTokenRef = useRef(0);

async function refresh() {
  const refreshToken = ++refreshTokenRef.current;
  const response = await sendExtensionMessage<AppResult<ActiveTabsSnapshot>>({
    type: 'active-tabs:snapshot',
  });
  if (refreshToken !== refreshTokenRef.current) return;
  setSnapshotReady(true);
  if (!response.ok) {
    onStatus('error', response.error.message);
    return;
  }
  setSnapshot(response.data);
}

const windows = useMemo(() => buildActiveTabWindows(snapshot), [snapshot]);
const duplicateGroups = useMemo(() => findDuplicateTabGroups(snapshot.tabs), [snapshot.tabs]);
const currentWindowId = snapshot.windows.find((window) => window.focused)?.id;
const controlsDisabled = busy || closePending || !snapshotReady;
```

Render `GroupNav` with `windows`, render `ActiveWindowSection` for each projected window, and keep the existing close/focus/stow/collapse functions pointed at `snapshot.tabs`. Delete the import button, passive `chromeGroupsSynced` pill, and Move to Domain action. Change the refresh button label to `t(locale, 'refreshFromChrome')`. Update the close-pending regression fixture so its close-group button comes from a real native Chrome group rather than the removed domain group.

- [ ] **Step 6: Adapt GroupNav to window/group targets**

Replace `GroupNav.tsx` with:

```tsx
import type { ActiveTabWindow } from '@/features/active-tabs/types';
import { t, type Locale } from '@/features/i18n/i18n';

type Props = {
  locale: Locale;
  windows: ActiveTabWindow[];
  onJump: (key: string) => void;
};

export function GroupNav({ locale, windows, onJump }: Props) {
  if (windows.length === 0) return null;
  const targets = windows.flatMap((window, index) => [
    {
      key: window.key,
      label: window.focused
        ? t(locale, 'currentWindow')
        : t(locale, 'windowNumber', { number: index + 1 }),
      count: window.visibleTabCount,
    },
    ...window.items
      .filter((item) => item.kind === 'group')
      .map((group) => ({
        key: group.key,
        label: group.title ?? t(locale, 'chromeGroupFallback', { id: group.groupId }),
        count: group.tabs.length,
      })),
  ]);

  return (
    <nav className="tabs-toolbar group-nav" aria-label={t(locale, 'activeTabsNavigation')}>
      <button className="group-filter" type="button" onClick={() => onJump(windows[0]?.key ?? '')} aria-pressed="true">
        <span>{t(locale, 'allActiveTabs')}</span>
        <strong>{windows.reduce((count, window) => count + window.visibleTabCount, 0)}</strong>
      </button>
      {targets.map((target) => (
        <button className="group-filter" key={target.key} type="button" onClick={() => onJump(target.key)}>
          <span>{target.label}</span>
          <strong>{target.count}</strong>
        </button>
      ))}
    </nav>
  );
}
```

- [ ] **Step 7: Verify GREEN and commit**

Run from `apps/extension`:

```bash
rtk bun run test src/entrypoints/newtab/App.test.tsx src/features/i18n/i18n.test.ts
rtk bun run typecheck
```

Expected: Chrome-window UI and existing focus/close/stow/collapse regressions pass.

```bash
rtk git add apps/extension/src/entrypoints/newtab/components/ActiveWorkspace.tsx apps/extension/src/entrypoints/newtab/components/ActiveWindowSection.tsx apps/extension/src/entrypoints/newtab/components/GroupNav.tsx apps/extension/src/entrypoints/newtab/App.test.tsx apps/extension/src/features/i18n/i18n.ts apps/extension/src/features/i18n/i18n.test.ts
rtk git commit -m "feat(active-tabs): render Chrome windows and groups"
```

---

### Task 7: Add Native Drag Payloads, Targets, And Pending Control

**Files:**

- Create: `apps/extension/src/entrypoints/newtab/components/active-tabs-dnd.ts`
- Create: `apps/extension/src/entrypoints/newtab/components/active-tabs-dnd.test.ts`
- Modify: `apps/extension/src/entrypoints/newtab/components/ActiveWindowSection.tsx`
- Modify: `apps/extension/src/entrypoints/newtab/components/ActiveWorkspace.tsx`
- Modify: `apps/extension/src/entrypoints/newtab/App.test.tsx`
- Modify: `apps/extension/src/entrypoints/newtab/styles.css:371-495`

**Interfaces:**

- Consumes: move request types/messages from Tasks 3-5 and projected items from Task 1.
- Produces: native drag handles, compatible insertion targets, one-in-flight move control, and Chrome refresh after every result.

- [ ] **Step 1: Write failing pure DnD helper tests**

Create tests for round-trip payload parsing, malformed payload rejection, pinned mismatch, incognito mismatch, and group-only top-level targets:

```ts
import { expect, it } from 'vitest';
import {
  readActiveTabsDragSource,
  resolveActiveTabsDropRequest,
  writeActiveTabsDragSource,
} from './active-tabs-dnd';

function fakeDataTransfer(): DataTransfer {
  const values = new Map<string, string>();
  return {
    effectAllowed: 'none',
    getData: (type: string) => values.get(type) ?? '',
    setData: (type: string, value: string) => values.set(type, value),
  } as unknown as DataTransfer;
}

it('round-trips a tab source and resolves a compatible tab request', () => {
  const transfer = fakeDataTransfer();
  const source = { kind: 'tab', tabId: 10, windowId: 2, pinned: false, incognito: false } as const;
  writeActiveTabsDragSource(transfer, source);

  expect(readActiveTabsDragSource(transfer)).toEqual(source);
  expect(resolveActiveTabsDropRequest(source, {
    key: 'group:31:end',
    incognito: false,
    tabDestination: {
      windowId: 2,
      lane: { kind: 'group', groupId: 31 },
      position: { kind: 'end' },
    },
  })).toEqual({
    kind: 'tab',
    request: { tabId: 10, destination: { windowId: 2, lane: { kind: 'group', groupId: 31 }, position: { kind: 'end' } } },
  });
});

it('rejects incompatible pinned, incognito, and group targets', () => {
  const pinned = { kind: 'tab', tabId: 10, windowId: 2, pinned: true, incognito: false } as const;
  const group = { kind: 'group', groupId: 31, windowId: 2, incognito: false } as const;
  const ungroupedTarget = {
    key: 'window:3:end',
    incognito: true,
    tabDestination: { windowId: 3, lane: { kind: 'ungrouped' as const }, position: { kind: 'end' as const } },
  };

  expect(resolveActiveTabsDropRequest(pinned, ungroupedTarget)).toBeNull();
  expect(resolveActiveTabsDropRequest(group, ungroupedTarget)).toBeNull();
});
```

- [ ] **Step 2: Verify RED**

Run from `apps/extension`:

```bash
rtk bun run test src/entrypoints/newtab/components/active-tabs-dnd.test.ts
```

Expected: FAIL because the DnD helper is missing.

- [ ] **Step 3: Implement payload and compatibility resolution**

Create `active-tabs-dnd.ts`:

```ts
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
    return typeof source.tabId === 'number'
      && Number.isInteger(source.tabId)
      && typeof source.windowId === 'number'
      && Number.isInteger(source.windowId)
      && typeof source.pinned === 'boolean'
      && typeof source.incognito === 'boolean';
  }
  return source.kind === 'group'
    && typeof source.groupId === 'number'
    && Number.isInteger(source.groupId)
    && typeof source.windowId === 'number'
    && Number.isInteger(source.windowId)
    && typeof source.incognito === 'boolean';
}

export function writeActiveTabsDragSource(dataTransfer: DataTransfer, source: ActiveTabsDragSource): void {
  dataTransfer.effectAllowed = 'move';
  dataTransfer.setData(ACTIVE_TABS_DRAG_MIME, JSON.stringify(source));
}

export function readActiveTabsDragSource(dataTransfer: DataTransfer): ActiveTabsDragSource | null {
  try {
    const value = JSON.parse(dataTransfer.getData(ACTIVE_TABS_DRAG_MIME));
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
    request: { tabId: source.tabId, destination: target.tabDestination },
  };
}
```

- [ ] **Step 4: Add failing App drag tests**

Add this `Map`-backed `DataTransfer` stub, event helpers, and deterministic Chrome-window fixtures to `App.test.tsx`:

```ts
function createDataTransfer(): DataTransfer {
  const values = new Map<string, string>();
  return {
    effectAllowed: 'none',
    dropEffect: 'none',
    types: [],
    getData: (type: string) => values.get(type) ?? '',
    setData: (type: string, value: string) => {
      values.set(type, value);
    },
  } as unknown as DataTransfer;
}

async function dispatchDrag(
  element: HTMLElement,
  type: 'dragstart' | 'dragenter' | 'dragover' | 'drop' | 'dragend',
  dataTransfer: DataTransfer,
): Promise<Event> {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
  await act(async () => {
    element.dispatchEvent(event);
  });
  return event;
}

const dragStart = (element: HTMLElement, data: DataTransfer) => dispatchDrag(element, 'dragstart', data);
async function dragOver(element: HTMLElement, data: DataTransfer) {
  await dispatchDrag(element, 'dragenter', data);
  return dispatchDrag(element, 'dragover', data);
}
const drop = (element: HTMLElement, data: DataTransfer) => dispatchDrag(element, 'drop', data);

function mockChromeWindowWithUngroupedAndGroupedTabs() {
  const tabs: ActiveBrowserTab[] = [
    { ...UNIQUE_TAB, id: 21, windowId: 8, index: 0, groupId: -1, title: 'Before' },
    { ...UNIQUE_TAB, id: 22, windowId: 8, index: 1, groupId: 31, title: 'Grouped' },
  ];
  mockMessages({
    activeTabs: tabs,
    focusedWindowId: 8,
    chromeGroups: [{ id: 31, windowId: 8, title: 'Reading', color: 'blue', collapsed: false }],
  });
}

function mockTwoChromeWindowsWithGroup() {
  const tabs: ActiveBrowserTab[] = [
    { ...UNIQUE_TAB, id: 22, windowId: 8, index: 0, groupId: 31, title: 'Grouped' },
    { ...UNIQUE_TAB, id: 30, windowId: 3, index: 0, groupId: -1, title: 'Target' },
  ];
  mockMessages({
    activeTabs: tabs,
    focusedWindowId: 8,
    chromeGroups: [{ id: 31, windowId: 8, title: 'Reading', color: 'blue', collapsed: false }],
  });
}
```

Extend `mockMessages` with the two move responses before writing these tests:

```ts
if (message.type === 'active-tabs:move-tab' || message.type === 'active-tabs:move-group') {
  return { ok: true, data: { moved: true } };
}
```

Then add:

```ts
it('drops an unpinned tab onto a Chrome group header', async () => {
  mockChromeWindowWithUngroupedAndGroupedTabs();
  await renderApp();

  const transfer = createDataTransfer();
  await dragStart(screen().getByLabelText('Drag Before'), transfer);
  const target = screen().getByLabelText('Drop into Reading');
  await dragOver(target, transfer);
  expect(target.className).toContain('is-active-drop-target');
  await drop(target, transfer);

  expect(sendExtensionMessage).toHaveBeenCalledWith({
    type: 'active-tabs:move-tab',
    request: {
      tabId: 21,
      destination: {
        windowId: 8,
        lane: { kind: 'group', groupId: 31 },
        position: { kind: 'end' },
      },
    },
  });
  expect(sentMessageTypes().filter((type) => type === 'active-tabs:snapshot')).toHaveLength(2);
});

it('drops a complete group at another window end', async () => {
  mockTwoChromeWindowsWithGroup();
  await renderApp();

  const transfer = createDataTransfer();
  await dragStart(screen().getByLabelText('Drag Reading group'), transfer);
  await drop(screen().getByLabelText('Drop at end of Window 2'), transfer);

  expect(sendExtensionMessage).toHaveBeenCalledWith({
    type: 'active-tabs:move-group',
    request: {
      groupId: 31,
      sourceWindowId: 8,
      destination: { windowId: 3, position: { kind: 'end' } },
    },
  });
});
```

Add the invalid-target and same-frame pending guards:

```ts
it('does not accept a pinned tab on a Chrome group target', async () => {
  const tabs: ActiveBrowserTab[] = [
    { ...UNIQUE_TAB, id: 20, windowId: 8, index: 0, pinned: true, groupId: -1, title: 'Pinned' },
    { ...UNIQUE_TAB, id: 22, windowId: 8, index: 1, pinned: false, groupId: 31, title: 'Grouped' },
  ];
  mockMessages({
    activeTabs: tabs,
    focusedWindowId: 8,
    chromeGroups: [{ id: 31, windowId: 8, title: 'Reading', color: 'blue', collapsed: false }],
  });
  await renderApp();

  const transfer = createDataTransfer();
  await dragStart(screen().getByLabelText('Drag Pinned'), transfer);
  const dragOverEvent = await dragOver(screen().getByLabelText('Drop into Reading'), transfer);
  await drop(screen().getByLabelText('Drop into Reading'), transfer);

  expect(dragOverEvent.defaultPrevented).toBe(false);
  expect(sentMessageTypes()).not.toContain('active-tabs:move-tab');
});

it('allows only one drag move while the first response is pending', async () => {
  const pending = deferred<AppResult<{ moved: boolean }>>();
  const tabs: ActiveBrowserTab[] = [
    { ...UNIQUE_TAB, id: 21, windowId: 8, index: 0, groupId: -1, title: 'Before' },
    { ...UNIQUE_TAB, id: 22, windowId: 8, index: 1, groupId: 31, title: 'Grouped' },
  ];
  sendExtensionMessage.mockImplementation(async (message: ExtensionMessage) => {
    if (message.type === 'active-tabs:snapshot') {
      return {
        ok: true,
        data: activeTabsSnapshot(tabs, {
          focusedWindowId: 8,
          chromeGroups: [{ id: 31, windowId: 8, title: 'Reading', color: 'blue', collapsed: false }],
        }),
      };
    }
    if (message.type === 'sessions:list') return { ok: true, data: SESSIONS };
    if (message.type === 'active-tabs:move-tab') return pending.promise;
    throw new Error(`Unexpected message: ${message.type}`);
  });
  await renderApp();

  const transfer = createDataTransfer();
  await dragStart(screen().getByLabelText('Drag Before'), transfer);
  const target = screen().getByLabelText('Drop into Reading');
  await act(async () => {
    const first = new Event('drop', { bubbles: true, cancelable: true });
    const second = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(first, 'dataTransfer', { value: transfer });
    Object.defineProperty(second, 'dataTransfer', { value: transfer });
    target.dispatchEvent(first);
    target.dispatchEvent(second);
  });

  expect(sentMessageTypes().filter((type) => type === 'active-tabs:move-tab')).toHaveLength(1);
  pending.resolve({ ok: true, data: { moved: true } });
  await act(async () => {
    await pending.promise;
  });
});

it('reports a failed move and refreshes Chrome state', async () => {
  const tabs: ActiveBrowserTab[] = [
    { ...UNIQUE_TAB, id: 21, windowId: 8, index: 0, groupId: -1, title: 'Before' },
    { ...UNIQUE_TAB, id: 22, windowId: 8, index: 1, groupId: 31, title: 'Grouped' },
  ];
  sendExtensionMessage.mockImplementation(async (message: ExtensionMessage) => {
    if (message.type === 'active-tabs:snapshot') {
      return {
        ok: true,
        data: activeTabsSnapshot(tabs, {
          focusedWindowId: 8,
          chromeGroups: [{ id: 31, windowId: 8, title: 'Reading', color: 'blue', collapsed: false }],
        }),
      };
    }
    if (message.type === 'sessions:list') return { ok: true, data: SESSIONS };
    if (message.type === 'active-tabs:move-tab') {
      return { ok: false, error: { code: 'chrome-tabs-error', message: 'Target disappeared' } };
    }
    throw new Error(`Unexpected message: ${message.type}`);
  });
  await renderApp();

  const transfer = createDataTransfer();
  await dragStart(screen().getByLabelText('Drag Before'), transfer);
  await drop(screen().getByLabelText('Drop into Reading'), transfer);

  expect(screen().getByRole('alert').textContent).toContain('Target disappeared');
  expect(sentMessageTypes().filter((type) => type === 'active-tabs:snapshot')).toHaveLength(2);
});
```

- [ ] **Step 5: Add drag orchestration to ActiveWorkspace**

Use synchronous refs for same-frame guarding and React state for visuals:

```tsx
const [dragSource, setDragSource] = useState<ActiveTabsDragSource | null>(null);
const [activeDropTargetKey, setActiveDropTargetKey] = useState<string | null>(null);
const [movePending, setMovePending] = useState(false);
const dragSourceRef = useRef<ActiveTabsDragSource | null>(null);
const movePendingRef = useRef(false);

function startDrag(event: React.DragEvent, source: ActiveTabsDragSource) {
  if (controlsDisabled || movePendingRef.current) {
    event.preventDefault();
    return;
  }
  dragSourceRef.current = source;
  setDragSource(source);
  writeActiveTabsDragSource(event.dataTransfer, source);
}

function endDrag() {
  dragSourceRef.current = null;
  setDragSource(null);
  setActiveDropTargetKey(null);
}

async function dropOnTarget(event: React.DragEvent, target: ActiveTabsDropTarget) {
  event.stopPropagation();
  const source = readActiveTabsDragSource(event.dataTransfer) ?? dragSourceRef.current;
  const dropRequest = source ? resolveActiveTabsDropRequest(source, target) : null;
  if (!dropRequest || movePendingRef.current) return;

  event.preventDefault();
  movePendingRef.current = true;
  setMovePending(true);
  try {
    const response = dropRequest.kind === 'tab'
      ? await sendExtensionMessage<AppResult<ActiveTabsMoveResult>>({ type: 'active-tabs:move-tab', request: dropRequest.request })
      : await sendExtensionMessage<AppResult<ActiveTabsMoveResult>>({ type: 'active-tabs:move-group', request: dropRequest.request });
    if (!response.ok) onStatus('error', response.error.message);
  } finally {
    await refresh();
    movePendingRef.current = false;
    setMovePending(false);
    endDrag();
  }
}
```

Pass the source, active target key, and handlers into `ActiveWindowSection`. Include `movePending` in every close/drag disabled expression.

- [ ] **Step 6: Add handles and exact drop zones to ActiveWindowSection**

Extend `ActiveWindowSection` props with the drag source, active key, and handlers, then add this local target component:

```tsx
type DropZoneProps = {
  activeKey: string | null;
  dragSource: ActiveTabsDragSource | null;
  label: string;
  target: ActiveTabsDropTarget;
  onActivate: (key: string | null) => void;
  onDrop: (event: React.DragEvent, target: ActiveTabsDropTarget) => void;
};

function DropZone(props: DropZoneProps) {
  const accepts = Boolean(
    props.dragSource && resolveActiveTabsDropRequest(props.dragSource, props.target),
  );
  return (
    <div
      className={`drop-insertion${props.activeKey === props.target.key ? ' is-active-drop-target' : ''}`}
      aria-label={props.label}
      onDragEnter={(event) => {
        if (!accepts) return;
        event.preventDefault();
        event.stopPropagation();
        props.onActivate(props.target.key);
      }}
      onDragOver={(event) => {
        if (!accepts) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = 'move';
      }}
      onDragLeave={() => {
        if (props.activeKey === props.target.key) props.onActivate(null);
      }}
      onDrop={(event) => {
        if (!accepts) return;
        event.stopPropagation();
        props.onDrop(event, props.target);
      }}
    />
  );
}
```

Construct top-level insertion targets without numeric indices:

```tsx
function topLevelTarget(
  window: ActiveTabWindow,
  item: ActiveWindowItem,
  kind: 'before' | 'after',
): ActiveTabsDropTarget {
  const anchor = item.kind === 'tab'
    ? { kind: 'tab' as const, tabId: item.tab.id as number }
    : { kind: 'group' as const, groupId: item.groupId };
  const position = { kind, anchor } as const;
  return {
    key: `${window.key}:${kind}:${item.key}`,
    incognito: window.incognito,
    tabDestination: {
      windowId: window.windowId,
      lane: { kind: 'ungrouped' },
      position,
    },
    groupDestination: { windowId: window.windowId, position },
  };
}

function groupEndTarget(window: ActiveTabWindow, groupId: number): ActiveTabsDropTarget {
  return {
    key: `${window.key}:group:${groupId}:end`,
    incognito: window.incognito,
    tabDestination: {
      windowId: window.windowId,
      lane: { kind: 'group', groupId },
      position: { kind: 'end' },
    },
  };
}

function windowEndTarget(window: ActiveTabWindow): ActiveTabsDropTarget {
  return {
    key: `${window.key}:end`,
    incognito: window.incognito,
    tabDestination: {
      windowId: window.windowId,
      lane: { kind: 'ungrouped' },
      position: { kind: 'end' },
    },
    groupDestination: {
      windowId: window.windowId,
      position: { kind: 'end' },
    },
  };
}
```

Construct pinned and group-row targets with this helper:

```tsx
function tabLaneTarget(
  window: ActiveTabWindow,
  lane: ActiveTabLane,
  tabId: number,
  kind: 'before' | 'after',
): ActiveTabsDropTarget {
  return {
    key: `${window.key}:${lane.kind}:${kind}:tab:${tabId}`,
    incognito: window.incognito,
    tabDestination: {
      windowId: window.windowId,
      lane,
      position: { kind, anchor: { kind: 'tab', tabId } },
    },
  };
}

function pinnedEndTarget(window: ActiveTabWindow): ActiveTabsDropTarget {
  return {
    key: `${window.key}:pinned:end`,
    incognito: window.incognito,
    tabDestination: {
      windowId: window.windowId,
      lane: { kind: 'pinned' },
      position: { kind: 'end' },
    },
  };
}
```

Render `pinnedEndTarget(window)` even when the target window has no pinned tabs whenever `dragSource?.kind === 'tab' && dragSource.pinned`.

Add dedicated drag handles:

```tsx
<button
  type="button"
  className="drag-handle"
  draggable={!props.disabled}
  disabled={props.disabled}
  aria-label={t(props.locale, 'dragTab', { label })}
  onDragStart={(event) => props.onDragStart(event, {
    kind: 'tab',
    tabId: tab.id as number,
    windowId: props.window.windowId,
    pinned: Boolean(tab.pinned),
    incognito: props.window.incognito,
  })}
  onDragEnd={props.onDragEnd}
>
  ⋮⋮
</button>
```

Use this group handle in each native group header:

```tsx
<button
  type="button"
  className="drag-handle"
  draggable={!props.disabled}
  disabled={props.disabled}
  aria-label={t(props.locale, 'dragGroup', {
    label: item.title ?? t(props.locale, 'chromeGroupFallback', { id: item.groupId }),
  })}
  onDragStart={(event) => props.onDragStart(event, {
    kind: 'group',
    groupId: item.groupId,
    windowId: props.window.windowId,
    incognito: props.window.incognito,
  })}
  onDragEnd={props.onDragEnd}
>
  ⋮⋮
</button>
```

Place `DropZone` components before the first item and after every complete top-level item, never inside another group's outer boundary. Every nested handler calls `stopPropagation()`.

- [ ] **Step 7: Add drag styling**

Add these concrete class rules and Chrome group color variants to `styles.css`:

```css
.active-window-list,
.active-window-items,
.pinned-lane {
  display: grid;
  gap: 10px;
}

.active-window {
  display: grid;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: color-mix(in oklab, var(--surface), transparent 8%);
}

.active-window-header,
.pinned-lane-header,
.chrome-group-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  justify-content: space-between;
}

.drag-handle {
  width: 28px;
  min-width: 28px;
  min-height: 34px;
  padding: 0;
  cursor: grab;
  color: var(--muted);
  background: transparent;
}

.drag-handle:active { cursor: grabbing; }
.drag-handle:disabled { cursor: not-allowed; opacity: 0.45; }

.tab-row {
  grid-template-columns: auto minmax(0, 1fr) auto;
}

.drop-insertion {
  min-height: 8px;
  border-radius: var(--radius-pill);
}

.drop-insertion.is-active-drop-target {
  min-height: 4px;
  background: var(--accent);
  box-shadow: 0 0 0 2px color-mix(in oklab, var(--accent), transparent 70%);
}

.drop-target.is-active-drop-target {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.chrome-group-color { width: 10px; height: 10px; border-radius: 50%; }
.chrome-group-color--grey { background: #8b95a7; }
.chrome-group-color--blue { background: #4f8cff; }
.chrome-group-color--red { background: #e65b65; }
.chrome-group-color--yellow { background: #dcae3f; }
.chrome-group-color--green { background: #45a66f; }
.chrome-group-color--pink { background: #d56fa7; }
.chrome-group-color--purple { background: #8d72d9; }
.chrome-group-color--cyan { background: #3ca9ba; }
.chrome-group-color--orange { background: #dc8545; }
```

- [ ] **Step 8: Verify GREEN and commit**

Run from `apps/extension`:

```bash
rtk bun run test src/entrypoints/newtab/components/active-tabs-dnd.test.ts src/entrypoints/newtab/App.test.tsx
rtk bun run typecheck
```

Expected: helper tests, App drag tests, and typecheck pass.

```bash
rtk git add apps/extension/src/entrypoints/newtab/components/active-tabs-dnd.ts apps/extension/src/entrypoints/newtab/components/active-tabs-dnd.test.ts apps/extension/src/entrypoints/newtab/components/ActiveWorkspace.tsx apps/extension/src/entrypoints/newtab/components/ActiveWindowSection.tsx apps/extension/src/entrypoints/newtab/App.test.tsx apps/extension/src/entrypoints/newtab/styles.css
rtk git commit -m "feat(active-tabs): add native tab and group dragging"
```

---

### Task 8: Refresh For The Complete Chrome Event Surface

**Files:**

- Create: `apps/extension/src/features/active-tabs/active-tabs-events.ts`
- Create: `apps/extension/src/features/active-tabs/active-tabs-events.test.ts`
- Modify: `apps/extension/src/entrypoints/newtab/components/ActiveWorkspace.tsx:96-129`
- Modify: `apps/extension/src/entrypoints/newtab/App.test.tsx`

**Interfaces:**

- Consumes: one stable `onChange: () => void` callback.
- Produces: `subscribeToActiveTabsChanges(onChange): () => void` and 150ms coalesced UI refresh.

- [ ] **Step 1: Write failing subscription tests**

Create `active-tabs-events.test.ts` with event mocks that store listeners. Verify all 15 events register the same callback, representative events call it, and cleanup removes it from every event:

```ts
import { expect, it, vi } from 'vitest';

function eventMock() {
  const listeners = new Set<(...args: unknown[]) => void>();
  return {
    addListener: vi.fn((listener: (...args: unknown[]) => void) => listeners.add(listener)),
    removeListener: vi.fn((listener: (...args: unknown[]) => void) => listeners.delete(listener)),
    emit: (...args: unknown[]) => {
      for (const listener of listeners) listener(...args);
    },
  };
}

function installChromeEvents() {
  const tabs = {
    onCreated: eventMock(),
    onUpdated: eventMock(),
    onRemoved: eventMock(),
    onMoved: eventMock(),
    onAttached: eventMock(),
    onDetached: eventMock(),
    onActivated: eventMock(),
    onReplaced: eventMock(),
  };
  const tabGroups = {
    onCreated: eventMock(),
    onUpdated: eventMock(),
    onRemoved: eventMock(),
    onMoved: eventMock(),
  };
  const windows = {
    onCreated: eventMock(),
    onRemoved: eventMock(),
    onFocusChanged: eventMock(),
  };
  const all = [...Object.values(tabs), ...Object.values(tabGroups), ...Object.values(windows)];
  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    value: { tabs, tabGroups, windows },
  });
  return { tabs, tabGroups, windows, all };
}

it('subscribes and unsubscribes the complete Chrome change surface', async () => {
  const events = installChromeEvents();
  const onChange = vi.fn();

  const { subscribeToActiveTabsChanges } = await import('./active-tabs-events');
  const unsubscribe = subscribeToActiveTabsChanges(onChange);

  expect(events.all.every((event) => event.addListener.mock.calls[0]?.[0] === onChange)).toBe(true);
  events.tabs.onAttached.emit(10, { newWindowId: 3, newPosition: 1 });
  events.tabGroups.onMoved.emit({ id: 31 });
  events.windows.onFocusChanged.emit(3);
  expect(onChange).toHaveBeenCalledTimes(3);

  unsubscribe();
  expect(events.all.every((event) => event.removeListener.mock.calls[0]?.[0] === onChange)).toBe(true);
});
```

- [ ] **Step 2: Verify RED**

Run from `apps/extension`:

```bash
rtk bun run test src/features/active-tabs/active-tabs-events.test.ts
```

Expected: FAIL because the subscription module does not exist.

- [ ] **Step 3: Implement exact registration and cleanup**

Create `active-tabs-events.ts` with explicit add/remove calls for:

```ts
export function subscribeToActiveTabsChanges(onChange: () => void): () => void {
  if (typeof chrome === 'undefined') return () => undefined;
  const tabs = chrome.tabs;
  const groups = chrome.tabGroups;
  const windows = chrome.windows;

  tabs?.onCreated?.addListener(onChange);
  tabs?.onUpdated?.addListener(onChange);
  tabs?.onRemoved?.addListener(onChange);
  tabs?.onMoved?.addListener(onChange);
  tabs?.onAttached?.addListener(onChange);
  tabs?.onDetached?.addListener(onChange);
  tabs?.onActivated?.addListener(onChange);
  tabs?.onReplaced?.addListener(onChange);
  groups?.onCreated?.addListener(onChange);
  groups?.onUpdated?.addListener(onChange);
  groups?.onRemoved?.addListener(onChange);
  groups?.onMoved?.addListener(onChange);
  windows?.onCreated?.addListener(onChange);
  windows?.onRemoved?.addListener(onChange);
  windows?.onFocusChanged?.addListener(onChange);

  return () => {
    tabs?.onCreated?.removeListener(onChange);
    tabs?.onUpdated?.removeListener(onChange);
    tabs?.onRemoved?.removeListener(onChange);
    tabs?.onMoved?.removeListener(onChange);
    tabs?.onAttached?.removeListener(onChange);
    tabs?.onDetached?.removeListener(onChange);
    tabs?.onActivated?.removeListener(onChange);
    tabs?.onReplaced?.removeListener(onChange);
    groups?.onCreated?.removeListener(onChange);
    groups?.onUpdated?.removeListener(onChange);
    groups?.onRemoved?.removeListener(onChange);
    groups?.onMoved?.removeListener(onChange);
    windows?.onCreated?.removeListener(onChange);
    windows?.onRemoved?.removeListener(onChange);
    windows?.onFocusChanged?.removeListener(onChange);
  };
}
```

- [ ] **Step 4: Use the subscription with a 150ms debounce**

Replace the current event effect in `ActiveWorkspace.tsx`:

```tsx
useEffect(() => {
  let timeoutId: number | null = null;
  const unsubscribe = subscribeToActiveTabsChanges(() => {
    if (timeoutId !== null) window.clearTimeout(timeoutId);
    timeoutId = window.setTimeout(() => {
      timeoutId = null;
      void refresh();
    }, 150);
  });

  return () => {
    refreshTokenRef.current += 1;
    if (timeoutId !== null) window.clearTimeout(timeoutId);
    unsubscribe();
  };
}, []);
```

Add this event setup to `App.test.tsx`; assign `chromeChangeEvents = installAppChromeEvents()` in `beforeEach`, use its returned `chrome` value in the existing `globalThis.chrome` definition, and call `vi.useRealTimers()` in `afterEach`:

```ts
function createAppChromeEvent() {
  const listeners = new Set<(...args: unknown[]) => void>();
  return {
    addListener: vi.fn((listener: (...args: unknown[]) => void) => listeners.add(listener)),
    removeListener: vi.fn((listener: (...args: unknown[]) => void) => listeners.delete(listener)),
    emit: (...args: unknown[]) => {
      for (const listener of listeners) listener(...args);
    },
  };
}

function installAppChromeEvents() {
  const tabs = {
    onCreated: createAppChromeEvent(), onUpdated: createAppChromeEvent(),
    onRemoved: createAppChromeEvent(), onMoved: createAppChromeEvent(),
    onAttached: createAppChromeEvent(), onDetached: createAppChromeEvent(),
    onActivated: createAppChromeEvent(), onReplaced: createAppChromeEvent(),
  };
  const tabGroups = {
    onCreated: createAppChromeEvent(), onUpdated: createAppChromeEvent(),
    onRemoved: createAppChromeEvent(), onMoved: createAppChromeEvent(),
  };
  const windows = {
    onCreated: createAppChromeEvent(), onRemoved: createAppChromeEvent(),
    onFocusChanged: createAppChromeEvent(),
  };
  return {
    tabs,
    tabGroups,
    windows,
    chrome: { runtime: chromeRuntimeMocks, tabs, tabGroups, windows },
  };
}

let chromeChangeEvents: ReturnType<typeof installAppChromeEvents>;
```

Then add this App-level debounce test:

```ts
it('coalesces Chrome tab, group, and window events into one refresh', async () => {
  vi.useFakeTimers();
  mockMessages({ activeTabs: [UNIQUE_TAB], focusedWindowId: 4 });
  await renderApp();
  expect(sentMessageTypes().filter((type) => type === 'active-tabs:snapshot')).toHaveLength(1);

  await act(async () => {
    chromeChangeEvents.tabs.onMoved.emit(12, { windowId: 4, fromIndex: 0, toIndex: 1 });
    chromeChangeEvents.tabGroups.onMoved.emit({ id: 31, windowId: 4 });
    chromeChangeEvents.windows.onFocusChanged.emit(4);
    await vi.advanceTimersByTimeAsync(150);
  });

  expect(sentMessageTypes().filter((type) => type === 'active-tabs:snapshot')).toHaveLength(2);
});
```


- [ ] **Step 5: Verify GREEN and commit**

Run from `apps/extension`:

```bash
rtk bun run test src/features/active-tabs/active-tabs-events.test.ts src/entrypoints/newtab/App.test.tsx
rtk bun run typecheck
```

Expected: event tests, App refresh tests, and typecheck pass.

```bash
rtk git add apps/extension/src/features/active-tabs/active-tabs-events.ts apps/extension/src/features/active-tabs/active-tabs-events.test.ts apps/extension/src/entrypoints/newtab/components/ActiveWorkspace.tsx apps/extension/src/entrypoints/newtab/App.test.tsx
rtk git commit -m "fix(active-tabs): refresh for all Chrome tab events"
```

---

### Task 9: Remove Legacy URL/Manual Workspace Grouping

**Files:**

- Modify: `apps/extension/src/features/active-tabs/types.ts`
- Modify: `apps/extension/src/features/active-tabs/active-tab-groups.ts`
- Modify: `apps/extension/src/features/active-tabs/active-tab-groups.test.ts`
- Modify: `apps/extension/src/features/active-tabs/tab-labels.ts`
- Modify: `apps/extension/src/features/chrome-tab-groups/chrome-tab-groups.ts`
- Modify: `apps/extension/src/features/chrome-tab-groups/chrome-tab-groups.test.ts`
- Modify: `apps/extension/src/lib/messages.ts`
- Modify: `apps/extension/src/entrypoints/background.ts`
- Modify: `apps/extension/src/tests/background.test.ts`
- Modify: `apps/extension/src/entrypoints/newtab/App.test.tsx`
- Modify: `apps/extension/src/features/i18n/i18n.ts`
- Modify: `apps/extension/src/features/i18n/i18n.test.ts`
- Delete: `apps/extension/src/features/active-tabs/active-workspace-storage.ts`
- Delete: `apps/extension/src/features/active-tabs/active-workspace-storage.test.ts`
- Delete: `apps/extension/src/features/active-tabs/manual-groups.ts`
- Delete: `apps/extension/src/features/active-tabs/manual-groups.test.ts`

**Interfaces:**

- Consumes: new Chrome-window UI and move routes from prior tasks.
- Produces: no runtime or test dependency on manual groups, local order, mappings, URL display grouping, sync, or import.

- [ ] **Step 1: Strengthen the existing absence regression**

In the Chrome-window App test, add:

```ts
expect(container.textContent).not.toContain('Import Chrome groups');
expect(container.textContent).not.toContain('Move to domain group');
expect(sentMessageTypes()).not.toContain('chrome-tab-groups:sync');
expect(sentMessageTypes()).not.toContain('chrome-tab-groups:import');
```

Run the App test once and confirm it passes before cleanup; it is the behavioral guard for the refactor.

- [ ] **Step 2: Delete legacy message routes and module code**

Remove `chrome-tab-groups:sync` and `chrome-tab-groups:import` from `ExtensionMessage`, response imports, background imports/switch cases, and background tests. Replace `chrome-tab-groups.ts` with:

```ts
import { browser } from '@/lib/browser';
import { err, ok, toErrorMessage, type AppResult } from '@/lib/errors';

export async function collapseChromeTabGroups(
  windowId: number,
): Promise<AppResult<{ collapsed: true; groupCount: number }>> {
  try {
    const groups = await browser.tabGroups.query({});
    const matchingGroups = groups.filter((group) => group.windowId === windowId);
    await Promise.all(
      matchingGroups.map((group) => browser.tabGroups.update(group.id, { collapsed: true })),
    );
    return ok({ collapsed: true, groupCount: matchingGroups.length });
  } catch (error) {
    return err('chrome-tabs-error', toErrorMessage(error));
  }
}
```

Retain only the existing collapse test in `chrome-tab-groups.test.ts`.

- [ ] **Step 3: Delete local workspace modules and legacy types**

Delete the four storage/manual files. Remove these types from `types.ts`:

```ts
ManualTabGroup
ManualGroupsState
ActiveWorkspaceOrderState
ActiveTabGroupKind
ActiveTabGroup
```

- [ ] **Step 4: Reduce URL grouping code to duplicate detection**

Replace `active-tab-groups.ts` with the duplicate detector:

```ts
import type { ActiveBrowserTab, DuplicateTabGroup } from './types';

function compareTabs(a: ActiveBrowserTab, b: ActiveBrowserTab): number {
  return (a.windowId ?? 0) - (b.windowId ?? 0)
    || (a.index ?? 0) - (b.index ?? 0)
    || (a.id ?? 0) - (b.id ?? 0);
}

export function findDuplicateTabGroups(tabs: ActiveBrowserTab[]): DuplicateTabGroup[] {
  const byUrl = new Map<string, ActiveBrowserTab[]>();
  for (const tab of tabs) {
    if (!tab.url || tab.id == null) continue;
    byUrl.set(tab.url, [...(byUrl.get(tab.url) ?? []), tab]);
  }
  return Array.from(byUrl.entries())
    .filter(([, matches]) => matches.length > 1)
    .map(([url, matches]) => {
      const ordered = [...matches].sort(compareTabs);
      return {
        url,
        keepTabId: ordered[0]?.id as number,
        duplicateTabIds: ordered.slice(1).map((tab) => tab.id as number),
      };
    });
}
```

Remove its URL/manual grouping tests while retaining the duplicate tests. Remove `isLandingPage` and its landing rules from `tab-labels.ts`; retain `getTabLabel`, `getTabHostname`, and `friendlyDomain` because Active Tabs and Quick Links still use display labels.

- [ ] **Step 5: Remove unused legacy copy**

After checking consumers with `rg`, remove these English/Chinese keys and their old tests:

```ts
importChromeGroups
moveToDomainGroup
moveToManualGroup
syncManualGroups
chromeGroupsSynced
refreshChromeGroups
```

The refresh button already uses `refreshFromChrome` from Task 6, so every listed key must have zero consumers before deletion.

- [ ] **Step 6: Prove no legacy references remain**

Run from the repository root:

```bash
rtk rg -n "ManualGroupsState|ActiveWorkspaceOrderState|ActiveWorkspaceState|buildActiveTabGroups|syncChromeTabGroups|importChromeTabGroups|chrome-tab-groups:(sync|import)|isLandingPage" apps/extension/src
```

Expected: no matches.

Run from `apps/extension`:

```bash
rtk bun run test src/features/active-tabs/active-tab-groups.test.ts src/features/chrome-tab-groups/chrome-tab-groups.test.ts src/entrypoints/newtab/App.test.tsx src/tests/background.test.ts src/features/i18n/i18n.test.ts
rtk bun run typecheck
```

Expected: all selected tests pass and typecheck exits 0.

- [ ] **Step 7: Commit the legacy removal**

```bash
rtk git add -A apps/extension/src/features/active-tabs apps/extension/src/features/chrome-tab-groups apps/extension/src/lib/messages.ts apps/extension/src/entrypoints/background.ts apps/extension/src/entrypoints/newtab apps/extension/src/tests/background.test.ts apps/extension/src/features/i18n
rtk git commit -m "refactor(active-tabs): remove legacy workspace grouping"
```

---

### Task 10: Update QA Documentation And Run Final Gates

**Files:**

- Modify: `README.md:45-70`

**Interfaces:**

- Consumes: the completed feature and approved design.
- Produces: reproducible manual QA and fresh completion evidence.

- [ ] **Step 1: Replace obsolete README QA**

Replace domain/homepage/manual-group bullets with these exact checks:

```markdown
- Open two normal Chrome windows with pinned, ungrouped, and natively grouped web tabs.
- Confirm Active Tabs shows the focused window first and preserves each window's eligible tab-strip order.
- Drag an ungrouped tab, reorder a tab inside a group, move a tab into and out of a group, and move a tab between windows.
- Reorder a complete Chrome group and move it to the other normal window.
- Confirm pinned tabs only accept pinned destinations and retain their pinned state across windows.
- Change tab order, group membership, group title/color/collapsed state, and window focus directly in Chrome; confirm the open dashboard refreshes.
- Reload Tabstow and confirm no local URL/manual grouping or stale local order returns.
```

- [ ] **Step 2: Run the complete automated gate**

Run from the repository root:

```bash
rtk bun run test
rtk bun run typecheck
rtk bun run build
rtk git diff --check
```

Expected: all tests pass, typecheck exits 0, the Chrome MV3 build exits 0, and `git diff --check` reports no whitespace errors.

- [ ] **Step 3: Run manual Chrome QA**

Load `apps/extension/.output/chrome-mv3` as an unpacked extension and execute every new README bullet. Also close a drop anchor during a drag and confirm the error status appears before the dashboard refreshes to Chrome's actual state.

- [ ] **Step 4: Commit documentation after verification**

```bash
rtk git add README.md
rtk git commit -m "docs(active-tabs): document Chrome-native drag QA"
```

- [ ] **Step 5: Record final repository state**

```bash
rtk git status --short
rtk git log -10 --oneline
```

Expected: the worktree is clean and the ten task commits appear in execution order.
