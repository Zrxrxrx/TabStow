# Tab Harbor Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the approved Tab Harbor feature set into Tabstow's WXT/React/TypeScript extension while making toolbar icon click stow the current window by default.

**Architecture:** Keep Tabstow's current package boundaries: `apps/extension` owns Chrome APIs, React UI, WXT storage, Dexie, and the background service worker; `packages/core` remains runtime-neutral. Active browser workspace state is local-only extension storage, while stowed sessions remain IndexedDB-backed and Gist-synced. Chrome privileged actions go through typed feature services and background message routing.

**Tech Stack:** Bun workspaces, WXT, React, TypeScript, Chrome Manifest V3, Dexie/IndexedDB, WXT storage, Zod, Vitest, lucide-react.

## Global Constraints

- Use Bun for package management and scripts in this repository.
- Do not use pnpm, npm, npx, or yarn commands for project dependency work.
- Commit messages must use `type(scope): msg`, for example `feat(auth): add login page`.
- Chrome extension runtime code must not use Bun-only APIs.
- Avoid Node-only APIs in bundled extension code.
- Keep Manifest V3 permissions minimal.
- Do not add content scripts.
- Do not use eval, new Function, remote executable code, or CDN-loaded scripts.
- Treat the background entrypoint as a Manifest V3 service worker.
- Store durable tab sessions in IndexedDB.
- Store lightweight settings through extension storage.
- Do not commit real tokens, credentials, or user-specific values.
- The manifest action must not define `default_popup`.
- Add `tabGroups` for native Chrome tab-group support.
- Add `search` for dashboard default-engine search.
- Do not add `clipboardRead`.
- Do not sync active tabs, live tab IDs, live Chrome tab-group state, or current browser workspace state through Gist.
- Stowed sessions remain the canonical saved-tab model and continue to sync through Gist.

---

## File Structure

Create or modify these files during the migration:

- `apps/extension/wxt.config.ts`: Manifest action and permissions.
- `apps/extension/src/entrypoints/background.ts`: Register toolbar action click and new message routes.
- `apps/extension/src/lib/messages.ts`: Extend request/response types for active tab, quick link, todo, theme, language, and search actions.
- `apps/extension/src/features/action-feedback/action-feedback.ts`: Short-lived toolbar badge/title feedback for toolbar stow results.
- `apps/extension/src/features/active-tabs/types.ts`: Active tab and active workspace types.
- `apps/extension/src/features/active-tabs/tab-labels.ts`: Title cleanup, domain labels, landing-page detection.
- `apps/extension/src/features/active-tabs/active-tab-groups.ts`: Pure grouping, ordering, and duplicate detection helpers.
- `apps/extension/src/features/active-tabs/active-tabs-service.ts`: Background-owned Chrome tab query/focus/close/search operations.
- `apps/extension/src/features/active-tabs/manual-groups.ts`: Manual group normalization, assignment, pruning, and order helpers.
- `apps/extension/src/features/active-tabs/active-workspace-storage.ts`: Local-only active workspace storage.
- `apps/extension/src/features/chrome-tab-groups/chrome-tab-groups.ts`: Native Chrome tab-group import/sync/collapse service.
- `apps/extension/src/features/quick-links/quick-links.ts`: Quick link normalization and pure helpers.
- `apps/extension/src/features/quick-links/quick-links-storage.ts`: Local quick link storage.
- `apps/extension/src/features/todos/todos.ts`: Todo normalization and pure helpers.
- `apps/extension/src/features/todos/todos-storage.ts`: Local todo storage.
- `apps/extension/src/features/theme/theme-preferences.ts`: Theme preference normalization and storage.
- `apps/extension/src/features/i18n/i18n.ts`: English/Simplified Chinese localization helper and language preference storage.
- `apps/extension/src/entrypoints/newtab/App.tsx`: Compose the migrated dashboard.
- `apps/extension/src/entrypoints/newtab/components/ActiveWorkspace.tsx`: Active tabs workspace UI.
- `apps/extension/src/entrypoints/newtab/components/GroupNav.tsx`: Group jump navigation.
- `apps/extension/src/entrypoints/newtab/components/StowedSessions.tsx`: Existing stowed session UI extracted from `App.tsx`.
- `apps/extension/src/entrypoints/newtab/components/QuickLinks.tsx`: Quick links UI.
- `apps/extension/src/entrypoints/newtab/components/TodosPanel.tsx`: Todos UI.
- `apps/extension/src/entrypoints/newtab/components/ThemeControls.tsx`: Theme and language UI.
- `apps/extension/src/entrypoints/newtab/components/SearchBox.tsx`: Dashboard default-engine search UI.
- `apps/extension/src/entrypoints/newtab/styles.css`: Integrated dashboard styling.
- `apps/extension/src/tests/background.test.ts`: Toolbar action and message routing tests.
- `apps/extension/src/tests/manifest.test.ts`: Manifest permissions and popup regression tests.
- `apps/extension/src/features/**/**/*.test.ts`: Feature unit tests.
- `README.md`: Manual QA notes for migrated features.

---

### Task 1: Toolbar Action Stows Current Window

**Files:**
- Modify: `apps/extension/wxt.config.ts`
- Modify: `apps/extension/src/entrypoints/background.ts`
- Modify: `apps/extension/src/tests/background.test.ts`
- Create: `apps/extension/src/features/action-feedback/action-feedback.ts`
- Create: `apps/extension/src/tests/manifest.test.ts`

**Interfaces:**
- Consumes: `saveCurrentWindowAsSession(windowId?: number): Promise<AppResult<StowResult>>`
- Produces: `showActionFeedback(result: AppResult<StowResult>): Promise<void>`
- Produces: background registration for `browser.action.onClicked`

- [ ] **Step 1: Write failing background tests**

Add `action` to the `browserMocks` object and add tests in `apps/extension/src/tests/background.test.ts`:

```ts
const browserMocks = vi.hoisted(() => ({
  action: {
    onClicked: {
      addListener: vi.fn(),
    },
    setBadgeBackgroundColor: vi.fn(),
    setBadgeText: vi.fn(),
    setTitle: vi.fn(),
  },
  runtime: {
    onInstalled: {
      addListener: vi.fn(),
    },
    onStartup: {
      addListener: vi.fn(),
    },
    onMessage: {
      addListener: vi.fn(),
    },
  },
}));

const actionFeedbackMocks = vi.hoisted(() => ({
  showActionFeedback: vi.fn(),
}));

vi.mock('@/features/action-feedback/action-feedback', () => actionFeedbackMocks);
```

Add these test cases:

```ts
it('registers toolbar action click handling', async () => {
  await import('../entrypoints/background');

  expect(browserMocks.action.onClicked.addListener).toHaveBeenCalledTimes(1);
});

it('stows the clicked tab window from the toolbar action', async () => {
  const result = {
    ok: true,
    data: { session: null, savedTabCount: 3, closedTabCount: 3 },
  };
  sessionServiceMocks.saveCurrentWindowAsSession.mockResolvedValue(result);

  await import('../entrypoints/background');

  const listener = browserMocks.action.onClicked.addListener.mock.calls[0]?.[0];
  await listener?.({ windowId: 41 } as chrome.tabs.Tab);

  expect(sessionServiceMocks.saveCurrentWindowAsSession).toHaveBeenCalledWith(41);
  expect(actionFeedbackMocks.showActionFeedback).toHaveBeenCalledWith(result);
});

it('falls back to the last focused window when toolbar tab has no window id', async () => {
  sessionServiceMocks.saveCurrentWindowAsSession.mockResolvedValue({
    ok: false,
    error: { code: 'no-eligible-tabs', message: 'No eligible tabs were found in the current window.' },
  });

  await import('../entrypoints/background');

  const listener = browserMocks.action.onClicked.addListener.mock.calls[0]?.[0];
  await listener?.({} as chrome.tabs.Tab);

  expect(sessionServiceMocks.saveCurrentWindowAsSession).toHaveBeenCalledWith(undefined);
});
```

- [ ] **Step 2: Write failing manifest tests**

Create `apps/extension/src/tests/manifest.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import config from '../../wxt.config';

describe('extension manifest', () => {
  it('keeps toolbar action click as the default action', () => {
    expect(config.manifest?.action).toMatchObject({
      default_title: 'Tabstow',
    });
    expect(config.manifest?.action).not.toHaveProperty('default_popup');
  });

  it('uses the approved permissions for this migration', () => {
    expect(config.manifest?.permissions).toEqual(
      expect.arrayContaining(['tabs', 'storage', 'contextMenus', 'tabGroups', 'search']),
    );
    expect(config.manifest?.permissions).not.toContain('clipboardRead');
  });
});
```

- [ ] **Step 3: Run tests to verify failure**

Run:

```bash
bun --cwd apps/extension run test -- src/tests/background.test.ts src/tests/manifest.test.ts
```

Expected: background tests fail because `browser.action.onClicked.addListener` is not called and the action feedback module does not exist. Manifest test fails until `tabGroups` and `search` are added.

- [ ] **Step 4: Implement action feedback**

Create `apps/extension/src/features/action-feedback/action-feedback.ts`:

```ts
import type { StowResult } from '@/lib/messages';
import type { AppResult } from '@/lib/errors';
import { browser } from '@/lib/browser';

const RESET_DELAY_MS = 1800;

async function resetActionFeedback(): Promise<void> {
  await Promise.allSettled([
    browser.action.setBadgeText({ text: '' }),
    browser.action.setTitle({ title: 'Tabstow' }),
  ]);
}

export async function showActionFeedback(result: AppResult<StowResult>): Promise<void> {
  const text = result.ok ? String(result.data.savedTabCount) : '!';
  const title = result.ok
    ? `Stowed ${result.data.savedTabCount} tabs`
    : result.error.message;
  const color = result.ok ? '#2f855a' : '#b42318';

  await Promise.allSettled([
    browser.action.setBadgeBackgroundColor({ color }),
    browser.action.setBadgeText({ text }),
    browser.action.setTitle({ title }),
  ]);

  setTimeout(() => {
    void resetActionFeedback();
  }, RESET_DELAY_MS);
}
```

- [ ] **Step 5: Wire the toolbar action**

Modify `apps/extension/src/entrypoints/background.ts`:

```ts
import { showActionFeedback } from '@/features/action-feedback/action-feedback';
```

Inside `defineBackground(() => { ... })`, after `registerContextMenuClickHandler();`:

```ts
  browser.action.onClicked.addListener((tab) => {
    void saveCurrentWindowAsSession(tab.windowId).then(showActionFeedback);
  });
```

- [ ] **Step 6: Add accepted manifest permissions**

Modify `apps/extension/wxt.config.ts`:

```ts
    permissions: ['tabs', 'storage', 'contextMenus', 'tabGroups', 'search'],
```

Keep the action block without `default_popup`:

```ts
    action: {
      default_title: 'Tabstow',
    },
```

- [ ] **Step 7: Run task tests**

Run:

```bash
bun --cwd apps/extension run test -- src/tests/background.test.ts src/tests/manifest.test.ts
```

Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add apps/extension/wxt.config.ts apps/extension/src/entrypoints/background.ts apps/extension/src/features/action-feedback/action-feedback.ts apps/extension/src/tests/background.test.ts apps/extension/src/tests/manifest.test.ts
git commit -m "feat(action): stow current window on toolbar click"
```

---

### Task 2: Active Tab Domain Model And Grouping Helpers

**Files:**
- Create: `apps/extension/src/features/active-tabs/types.ts`
- Create: `apps/extension/src/features/active-tabs/tab-labels.ts`
- Create: `apps/extension/src/features/active-tabs/active-tab-groups.ts`
- Create: `apps/extension/src/features/active-tabs/active-tab-groups.test.ts`

**Interfaces:**
- Produces: `ActiveBrowserTab`, `ActiveTabGroup`, `ActiveTabGroupKind`, `DuplicateTabGroup`
- Produces: `getTabHostname(tab)`, `getTabLabel(tab)`, `isLandingPage(url)`
- Produces: `buildActiveTabGroups(tabs, manualState, orderState): ActiveTabGroup[]`
- Produces: `findDuplicateTabGroups(tabs): DuplicateTabGroup[]`

- [ ] **Step 1: Write failing pure helper tests**

Create `apps/extension/src/features/active-tabs/active-tab-groups.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildActiveTabGroups, findDuplicateTabGroups } from './active-tab-groups';
import { getTabLabel, isLandingPage } from './tab-labels';
import type { ActiveBrowserTab } from './types';

const tabs: ActiveBrowserTab[] = [
  { id: 1, windowId: 7, index: 0, active: false, pinned: false, title: 'GitHub', url: 'https://github.com/' },
  { id: 2, windowId: 7, index: 1, active: true, pinned: false, title: 'openai/tabstow PR #4 · GitHub', url: 'https://github.com/openai/tabstow/pull/4' },
  { id: 3, windowId: 7, index: 2, active: false, pinned: false, title: 'Mail', url: 'https://mail.google.com/mail/u/0/#inbox' },
  { id: 4, windowId: 7, index: 3, active: false, pinned: false, title: 'Duplicate', url: 'https://example.com/a' },
  { id: 5, windowId: 7, index: 4, active: false, pinned: false, title: 'Duplicate 2', url: 'https://example.com/a' },
];

describe('active tab labels', () => {
  it('identifies landing pages', () => {
    expect(isLandingPage('https://github.com/')).toBe(true);
    expect(isLandingPage('https://github.com/openai/tabstow/pull/4')).toBe(false);
  });

  it('uses a readable GitHub title', () => {
    expect(getTabLabel(tabs[1])).toBe('openai/tabstow PR #4');
  });
});

describe('active tab groups', () => {
  it('groups homepage-style tabs separately from domain work tabs', () => {
    const groups = buildActiveTabGroups(tabs, { groups: [], assignments: {} }, { groupOrder: [], pinnedGroupKeys: [], groupTabOrder: {} });

    expect(groups.map((group) => group.key)).toContain('landing:homepages');
    expect(groups.find((group) => group.key === 'domain:github.com')?.tabs.map((tab) => tab.id)).toEqual([2]);
  });

  it('applies manual group assignments before domain grouping', () => {
    const groups = buildActiveTabGroups(
      tabs,
      { groups: [{ id: 'manual-1', name: 'Launch', createdAt: '2026-07-06T00:00:00.000Z' }], assignments: { '2': 'manual-1' } },
      { groupOrder: [], pinnedGroupKeys: [], groupTabOrder: {} },
    );

    expect(groups.find((group) => group.key === 'manual:manual-1')?.tabs.map((tab) => tab.id)).toEqual([2]);
    expect(groups.find((group) => group.key === 'domain:github.com')).toBeUndefined();
  });

  it('finds duplicate tabs by exact URL and keeps the first tab out of the close list', () => {
    expect(findDuplicateTabGroups(tabs)).toEqual([
      {
        url: 'https://example.com/a',
        keepTabId: 4,
        duplicateTabIds: [5],
      },
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
bun --cwd apps/extension run test -- src/features/active-tabs/active-tab-groups.test.ts
```

Expected: FAIL because active-tab files do not exist.

- [ ] **Step 3: Add active tab types**

Create `apps/extension/src/features/active-tabs/types.ts`:

```ts
export type ActiveBrowserTab = Pick<
  chrome.tabs.Tab,
  'active' | 'favIconUrl' | 'groupId' | 'id' | 'index' | 'pinned' | 'title' | 'url' | 'windowId'
>;

export type ManualTabGroup = {
  id: string;
  name: string;
  createdAt: string;
};

export type ManualGroupsState = {
  groups: ManualTabGroup[];
  assignments: Record<string, string>;
};

export type ActiveWorkspaceOrderState = {
  groupOrder: string[];
  pinnedGroupKeys: string[];
  groupTabOrder: Record<string, string[]>;
};

export type ActiveTabGroupKind = 'landing' | 'manual' | 'domain';

export type ActiveTabGroup = {
  key: string;
  kind: ActiveTabGroupKind;
  title: string;
  tabs: ActiveBrowserTab[];
  pinned: boolean;
};

export type DuplicateTabGroup = {
  url: string;
  keepTabId: number;
  duplicateTabIds: number[];
};
```

- [ ] **Step 4: Add label and landing helpers**

Create `apps/extension/src/features/active-tabs/tab-labels.ts`:

```ts
import type { ActiveBrowserTab } from './types';

const LANDING_RULES = [
  { hostname: 'mail.google.com', rejectHashPrefixes: ['#inbox/', '#sent/', '#search/'] },
  { hostname: 'x.com', paths: ['/home'] },
  { hostname: 'www.linkedin.com', paths: ['/'] },
  { hostname: 'github.com', paths: ['/'] },
  { hostname: 'www.youtube.com', paths: ['/'] },
] as const;

export function getTabHostname(tab: Pick<ActiveBrowserTab, 'url'>): string {
  try {
    if (tab.url?.startsWith('file://')) return 'local-files';
    return new URL(tab.url ?? '').hostname;
  } catch {
    return '';
  }
}

export function friendlyDomain(domain: string): string {
  return domain.replace(/^www\./, '').replace(/\./g, ' ').trim();
}

function stripTitleNoise(title: string): string {
  return title
    .replace(/^\(\d+\+?\)\s*/, '')
    .replace(/\s*\([\d,]+\+?\)\s*/g, ' ')
    .replace(/\s*[\-\u2010-\u2015]\s*[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '')
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '')
    .replace(/\s+on X:\s*/, ': ')
    .replace(/\s*\/\s*X\s*$/, '')
    .trim();
}

function smartTitle(title: string, url: string | undefined): string {
  if (!url) return title;

  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split('/').filter(Boolean);
    const titleIsUrl = !title || title === url || title.startsWith(parsed.hostname) || title.startsWith('http');

    if ((parsed.hostname === 'github.com' || parsed.hostname === 'www.github.com') && parts.length >= 2) {
      const [owner, repo, section, id] = parts;
      if (section === 'issues' && id) return `${owner}/${repo} Issue #${id}`;
      if (section === 'pull' && id) return `${owner}/${repo} PR #${id}`;
      if ((section === 'blob' || section === 'tree') && parts.length > 4) return `${owner}/${repo} - ${parts.slice(4).join('/')}`;
      if (titleIsUrl) return `${owner}/${repo}`;
    }

    if ((parsed.hostname === 'x.com' || parsed.hostname === 'twitter.com') && parsed.pathname.includes('/status/')) {
      const username = parts[0];
      return titleIsUrl && username ? `Post by @${username}` : title;
    }

    return title;
  } catch {
    return title;
  }
}

export function getTabLabel(tab: Pick<ActiveBrowserTab, 'title' | 'url'>): string {
  const title = smartTitle(stripTitleNoise(tab.title ?? ''), tab.url);
  if (title) return title;

  const hostname = getTabHostname(tab);
  return hostname ? friendlyDomain(hostname) : tab.url ?? 'Tab';
}

export function isLandingPage(url: string | undefined): boolean {
  if (!url) return false;

  try {
    const parsed = new URL(url);
    return LANDING_RULES.some((rule) => {
      if (parsed.hostname !== rule.hostname) return false;
      if ('rejectHashPrefixes' in rule) {
        return !rule.rejectHashPrefixes.some((prefix) => parsed.hash.includes(prefix));
      }
      return rule.paths.includes(parsed.pathname);
    });
  } catch {
    return false;
  }
}
```

- [ ] **Step 5: Add grouping helpers**

Create `apps/extension/src/features/active-tabs/active-tab-groups.ts`:

```ts
import { getTabHostname, friendlyDomain, isLandingPage } from './tab-labels';
import type {
  ActiveBrowserTab,
  ActiveTabGroup,
  ActiveWorkspaceOrderState,
  DuplicateTabGroup,
  ManualGroupsState,
} from './types';

const LANDING_GROUP_KEY = 'landing:homepages';

function tabId(tab: Pick<ActiveBrowserTab, 'id'>): string {
  return String(tab.id);
}

function sortTabsByOrder(tabs: ActiveBrowserTab[], orderIds: string[] | undefined): ActiveBrowserTab[] {
  if (!orderIds?.length) return [...tabs].sort((a, b) => a.index - b.index);
  const byId = new Map(tabs.map((tab) => [tabId(tab), tab]));
  const ordered = orderIds.map((id) => byId.get(id)).filter((tab): tab is ActiveBrowserTab => Boolean(tab));
  const orderedIds = new Set(ordered.map(tabId));
  const rest = tabs.filter((tab) => !orderedIds.has(tabId(tab))).sort((a, b) => a.index - b.index);
  return [...ordered, ...rest];
}

function orderGroups(groups: ActiveTabGroup[], orderState: ActiveWorkspaceOrderState): ActiveTabGroup[] {
  const byKey = new Map(groups.map((group) => [group.key, group]));
  const ordered = orderState.groupOrder.map((key) => byKey.get(key)).filter((group): group is ActiveTabGroup => Boolean(group));
  const orderedKeys = new Set(ordered.map((group) => group.key));
  const rest = groups.filter((group) => !orderedKeys.has(group.key)).sort((a, b) => a.title.localeCompare(b.title));
  const all = [...ordered, ...rest].map((group) => ({
    ...group,
    pinned: orderState.pinnedGroupKeys.includes(group.key),
    tabs: sortTabsByOrder(group.tabs, orderState.groupTabOrder[group.key]),
  }));
  return all.sort((a, b) => Number(b.pinned) - Number(a.pinned));
}

export function buildActiveTabGroups(
  tabs: ActiveBrowserTab[],
  manualState: ManualGroupsState,
  orderState: ActiveWorkspaceOrderState,
): ActiveTabGroup[] {
  const groups = new Map<string, ActiveTabGroup>();
  const manualGroupsById = new Map(manualState.groups.map((group) => [group.id, group]));

  for (const tab of tabs) {
    if (tab.id == null || !tab.url) continue;

    const manualGroupId = manualState.assignments[String(tab.id)];
    const manualGroup = manualGroupId ? manualGroupsById.get(manualGroupId) : undefined;
    const key = manualGroup
      ? `manual:${manualGroup.id}`
      : isLandingPage(tab.url)
        ? LANDING_GROUP_KEY
        : `domain:${getTabHostname(tab) || 'unknown'}`;

    const title = manualGroup
      ? manualGroup.name
      : key === LANDING_GROUP_KEY
        ? 'Homepages'
        : friendlyDomain(key.replace(/^domain:/, '')) || 'Other';

    const kind = manualGroup ? 'manual' : key === LANDING_GROUP_KEY ? 'landing' : 'domain';
    const current = groups.get(key) ?? { key, kind, title, tabs: [], pinned: false };
    current.tabs.push(tab);
    groups.set(key, current);
  }

  return orderGroups(Array.from(groups.values()), orderState);
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
      const ordered = [...matches].sort((a, b) => a.index - b.index);
      return {
        url,
        keepTabId: ordered[0].id as number,
        duplicateTabIds: ordered.slice(1).map((tab) => tab.id as number),
      };
    });
}
```

- [ ] **Step 6: Run task tests**

Run:

```bash
bun --cwd apps/extension run test -- src/features/active-tabs/active-tab-groups.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/extension/src/features/active-tabs/types.ts apps/extension/src/features/active-tabs/tab-labels.ts apps/extension/src/features/active-tabs/active-tab-groups.ts apps/extension/src/features/active-tabs/active-tab-groups.test.ts
git commit -m "feat(active-tabs): add grouping helpers"
```

---

### Task 3: Active Tab Background Service And Messages

**Files:**
- Modify: `apps/extension/src/lib/messages.ts`
- Modify: `apps/extension/src/entrypoints/background.ts`
- Create: `apps/extension/src/features/active-tabs/active-tabs-service.ts`
- Create: `apps/extension/src/features/active-tabs/active-tabs-service.test.ts`
- Modify: `apps/extension/src/tests/background.test.ts`

**Interfaces:**
- Consumes: `ActiveBrowserTab`
- Produces: `listActiveTabs(): Promise<AppResult<ActiveBrowserTab[]>>`
- Produces: `focusActiveTab(tabId: number, windowId: number): Promise<AppResult<{ focused: true }>>`
- Produces: `closeActiveTabs(tabIds: number[]): Promise<AppResult<{ closed: true; tabCount: number }>>`
- Produces: `runDefaultSearch(query: string): Promise<AppResult<{ searched: true }>>`
- Produces message types: `active-tabs:list`, `active-tabs:focus`, `active-tabs:close`, `active-tabs:search`

- [ ] **Step 1: Write failing service tests**

Create `apps/extension/src/features/active-tabs/active-tabs-service.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const browserMocks = vi.hoisted(() => ({
  search: {
    query: vi.fn(),
  },
  tabs: {
    query: vi.fn(),
    remove: vi.fn(),
    update: vi.fn(),
  },
  windows: {
    update: vi.fn(),
  },
}));

vi.mock('@/lib/browser', () => ({
  browser: browserMocks,
}));

describe('active tabs service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists active browser tabs from all windows', async () => {
    browserMocks.tabs.query.mockResolvedValue([{ id: 1, windowId: 2, index: 0, url: 'https://example.com' }]);

    const { listActiveTabs } = await import('./active-tabs-service');
    const result = await listActiveTabs();

    expect(browserMocks.tabs.query).toHaveBeenCalledWith({});
    expect(result).toEqual({ ok: true, data: [{ id: 1, windowId: 2, index: 0, url: 'https://example.com' }] });
  });

  it('focuses a tab and its window', async () => {
    const { focusActiveTab } = await import('./active-tabs-service');
    const result = await focusActiveTab(5, 8);

    expect(browserMocks.windows.update).toHaveBeenCalledWith(8, { focused: true });
    expect(browserMocks.tabs.update).toHaveBeenCalledWith(5, { active: true });
    expect(result).toEqual({ ok: true, data: { focused: true } });
  });

  it('closes requested tabs', async () => {
    const { closeActiveTabs } = await import('./active-tabs-service');
    const result = await closeActiveTabs([3, 4]);

    expect(browserMocks.tabs.remove).toHaveBeenCalledWith([3, 4]);
    expect(result).toEqual({ ok: true, data: { closed: true, tabCount: 2 } });
  });

  it('runs a default search with trimmed query text', async () => {
    const { runDefaultSearch } = await import('./active-tabs-service');
    const result = await runDefaultSearch('  tab groups  ');

    expect(browserMocks.search.query).toHaveBeenCalledWith({ text: 'tab groups' });
    expect(result).toEqual({ ok: true, data: { searched: true } });
  });
});
```

- [ ] **Step 2: Run service tests to verify failure**

Run:

```bash
bun --cwd apps/extension run test -- src/features/active-tabs/active-tabs-service.test.ts
```

Expected: FAIL because the service file does not exist.

- [ ] **Step 3: Implement the active tabs service**

Create `apps/extension/src/features/active-tabs/active-tabs-service.ts`:

```ts
import { browser } from '@/lib/browser';
import { err, ok, toErrorMessage, type AppResult } from '@/lib/errors';
import type { ActiveBrowserTab } from './types';

export async function listActiveTabs(): Promise<AppResult<ActiveBrowserTab[]>> {
  try {
    return ok(await browser.tabs.query({}));
  } catch (error) {
    return err('chrome-tabs-error', toErrorMessage(error));
  }
}

export async function focusActiveTab(
  tabId: number,
  windowId: number,
): Promise<AppResult<{ focused: true }>> {
  try {
    await browser.windows.update(windowId, { focused: true });
    await browser.tabs.update(tabId, { active: true });
    return ok({ focused: true });
  } catch (error) {
    return err('chrome-tabs-error', toErrorMessage(error));
  }
}

export async function closeActiveTabs(tabIds: number[]): Promise<AppResult<{ closed: true; tabCount: number }>> {
  try {
    await browser.tabs.remove(tabIds);
    return ok({ closed: true, tabCount: tabIds.length });
  } catch (error) {
    return err('chrome-tabs-error', toErrorMessage(error));
  }
}

export async function runDefaultSearch(query: string): Promise<AppResult<{ searched: true }>> {
  const text = query.trim();
  if (!text) return err('unknown-error', 'Search query is required.');

  try {
    await browser.search.query({ text });
    return ok({ searched: true });
  } catch (error) {
    return err('unknown-error', toErrorMessage(error));
  }
}
```

- [ ] **Step 4: Extend message types**

Modify `apps/extension/src/lib/messages.ts`:

```ts
import type { ActiveBrowserTab } from '@/features/active-tabs/types';
```

Add request variants:

```ts
  | { type: 'active-tabs:list' }
  | { type: 'active-tabs:focus'; tabId: number; windowId: number }
  | { type: 'active-tabs:close'; tabIds: number[] }
  | { type: 'active-tabs:search'; query: string }
```

Add response variants:

```ts
  | AppResult<ActiveBrowserTab[]>
  | AppResult<{ focused: true }>
  | AppResult<{ closed: true; tabCount: number }>
  | AppResult<{ searched: true }>;
```

- [ ] **Step 5: Route background messages**

Modify `apps/extension/src/entrypoints/background.ts` imports:

```ts
import {
  closeActiveTabs,
  focusActiveTab,
  listActiveTabs,
  runDefaultSearch,
} from '@/features/active-tabs/active-tabs-service';
```

Add switch cases in `handleMessage`:

```ts
      case 'active-tabs:list':
        return listActiveTabs();
      case 'active-tabs:focus':
        return focusActiveTab(message.tabId, message.windowId);
      case 'active-tabs:close':
        return closeActiveTabs(message.tabIds);
      case 'active-tabs:search':
        return runDefaultSearch(message.query);
```

- [ ] **Step 6: Add background routing test**

Add mocks to `apps/extension/src/tests/background.test.ts`:

```ts
const activeTabsMocks = vi.hoisted(() => ({
  closeActiveTabs: vi.fn(),
  focusActiveTab: vi.fn(),
  listActiveTabs: vi.fn(),
  runDefaultSearch: vi.fn(),
}));

vi.mock('@/features/active-tabs/active-tabs-service', () => activeTabsMocks);
```

Add one representative routing test:

```ts
it('routes active tab close messages', async () => {
  activeTabsMocks.closeActiveTabs.mockResolvedValue({
    ok: true,
    data: { closed: true, tabCount: 2 },
  });

  await import('../entrypoints/background');

  const listener = browserMocks.runtime.onMessage.addListener.mock.calls[0]?.[0];
  await listener?.({ type: 'active-tabs:close', tabIds: [11, 12] }, {});

  expect(activeTabsMocks.closeActiveTabs).toHaveBeenCalledWith([11, 12]);
});
```

- [ ] **Step 7: Run task tests**

Run:

```bash
bun --cwd apps/extension run test -- src/features/active-tabs/active-tabs-service.test.ts src/tests/background.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/extension/src/lib/messages.ts apps/extension/src/entrypoints/background.ts apps/extension/src/features/active-tabs/active-tabs-service.ts apps/extension/src/features/active-tabs/active-tabs-service.test.ts apps/extension/src/tests/background.test.ts
git commit -m "feat(active-tabs): add background tab actions"
```

---

### Task 4: Manual Groups And Active Workspace Storage

**Files:**
- Create: `apps/extension/src/features/active-tabs/manual-groups.ts`
- Create: `apps/extension/src/features/active-tabs/manual-groups.test.ts`
- Create: `apps/extension/src/features/active-tabs/active-workspace-storage.ts`
- Create: `apps/extension/src/features/active-tabs/active-workspace-storage.test.ts`

**Interfaces:**
- Consumes: `ManualGroupsState`, `ActiveWorkspaceOrderState`
- Produces: `normalizeManualGroupsState(input): ManualGroupsState`
- Produces: `addManualGroup(state, name, idFactory): { state; group }`
- Produces: `assignTabToManualGroup(state, tabId, groupId): ManualGroupsState`
- Produces: `clearTabManualGroup(state, tabId): ManualGroupsState`
- Produces: `pruneManualGroups(state, openTabIds): ManualGroupsState`
- Produces: `getActiveWorkspaceState()`, `updateActiveWorkspaceState(partial)`

- [ ] **Step 1: Write failing manual group tests**

Create `apps/extension/src/features/active-tabs/manual-groups.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  addManualGroup,
  assignTabToManualGroup,
  clearTabManualGroup,
  normalizeManualGroupsState,
  pruneManualGroups,
} from './manual-groups';

describe('manual active tab groups', () => {
  it('normalizes invalid state to empty state', () => {
    expect(normalizeManualGroupsState({ groups: [{ id: '', name: '' }], assignments: { 1: '' } })).toEqual({
      groups: [],
      assignments: {},
    });
  });

  it('adds a group with a deterministic id factory', () => {
    const result = addManualGroup({ groups: [], assignments: {} }, 'Launch', () => 'manual-1');

    expect(result.group).toEqual({ id: 'manual-1', name: 'Launch', createdAt: expect.any(String) });
    expect(result.state.groups).toHaveLength(1);
  });

  it('assigns and clears tabs', () => {
    const state = { groups: [{ id: 'manual-1', name: 'Launch', createdAt: '2026-07-06T00:00:00.000Z' }], assignments: {} };
    expect(assignTabToManualGroup(state, 4, 'manual-1').assignments).toEqual({ '4': 'manual-1' });
    expect(clearTabManualGroup({ ...state, assignments: { '4': 'manual-1' } }, 4).assignments).toEqual({});
  });

  it('prunes closed tab assignments and empty groups', () => {
    const state = {
      groups: [
        { id: 'manual-1', name: 'Launch', createdAt: '2026-07-06T00:00:00.000Z' },
        { id: 'manual-2', name: 'Closed', createdAt: '2026-07-06T00:00:00.000Z' },
      ],
      assignments: { '4': 'manual-1', '5': 'manual-2' },
    };

    expect(pruneManualGroups(state, [4])).toEqual({
      groups: [{ id: 'manual-1', name: 'Launch', createdAt: '2026-07-06T00:00:00.000Z' }],
      assignments: { '4': 'manual-1' },
    });
  });
});
```

- [ ] **Step 2: Implement manual group helpers**

Create `apps/extension/src/features/active-tabs/manual-groups.ts`:

```ts
import type { ManualGroupsState, ManualTabGroup } from './types';

const EMPTY_STATE: ManualGroupsState = { groups: [], assignments: {} };

export function normalizeManualGroupsState(input: unknown): ManualGroupsState {
  if (!input || typeof input !== 'object') return EMPTY_STATE;
  const candidate = input as Partial<ManualGroupsState>;
  const groups = Array.isArray(candidate.groups)
    ? candidate.groups
        .filter((group): group is ManualTabGroup => Boolean(group?.id && group?.name))
        .map((group) => ({
          id: String(group.id),
          name: String(group.name).trim(),
          createdAt: group.createdAt || new Date().toISOString(),
        }))
        .filter((group) => group.id.length > 0 && group.name.length > 0)
    : [];

  const groupIds = new Set(groups.map((group) => group.id));
  const assignments = Object.fromEntries(
    Object.entries(candidate.assignments ?? {})
      .map(([tabId, groupId]) => [String(tabId), String(groupId)])
      .filter(([tabId, groupId]) => tabId.length > 0 && groupIds.has(groupId)),
  );

  return { groups, assignments };
}

export function addManualGroup(
  state: ManualGroupsState,
  name: string,
  createId: () => string = () => crypto.randomUUID(),
): { state: ManualGroupsState; group: ManualTabGroup } {
  const normalized = normalizeManualGroupsState(state);
  const cleanName = name.trim();
  if (!cleanName) throw new Error('Group name is required.');
  if (normalized.groups.some((group) => group.name.toLowerCase() === cleanName.toLowerCase())) {
    throw new Error('A group with that name already exists.');
  }

  const group = { id: createId(), name: cleanName, createdAt: new Date().toISOString() };
  return { group, state: { ...normalized, groups: [...normalized.groups, group] } };
}

export function assignTabToManualGroup(
  state: ManualGroupsState,
  tabId: number,
  groupId: string,
): ManualGroupsState {
  const normalized = normalizeManualGroupsState(state);
  if (!normalized.groups.some((group) => group.id === groupId)) throw new Error('Group not found.');
  return { ...normalized, assignments: { ...normalized.assignments, [String(tabId)]: groupId } };
}

export function clearTabManualGroup(state: ManualGroupsState, tabId: number): ManualGroupsState {
  const normalized = normalizeManualGroupsState(state);
  const assignments = { ...normalized.assignments };
  delete assignments[String(tabId)];
  return { ...normalized, assignments };
}

export function pruneManualGroups(state: ManualGroupsState, openTabIds: number[]): ManualGroupsState {
  const normalized = normalizeManualGroupsState(state);
  const openIds = new Set(openTabIds.map(String));
  const assignments = Object.fromEntries(
    Object.entries(normalized.assignments).filter(([tabId]) => openIds.has(tabId)),
  );
  const activeGroupIds = new Set(Object.values(assignments));
  return {
    groups: normalized.groups.filter((group) => activeGroupIds.has(group.id)),
    assignments,
  };
}
```

- [ ] **Step 3: Write failing storage tests**

Create `apps/extension/src/features/active-tabs/active-workspace-storage.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const storageMocks = vi.hoisted(() => ({
  getItem: vi.fn(),
  setItem: vi.fn(),
}));

vi.mock('#imports', () => ({
  storage: storageMocks,
}));

describe('active workspace storage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns default local-only active workspace state', async () => {
    storageMocks.getItem.mockResolvedValue(null);

    const { getActiveWorkspaceState } = await import('./active-workspace-storage');
    await expect(getActiveWorkspaceState()).resolves.toEqual({
      manualGroups: { groups: [], assignments: {} },
      order: { groupOrder: [], pinnedGroupKeys: [], groupTabOrder: {} },
      chromeTabGroups: { enabled: false, mappings: [] },
    });
  });

  it('merges partial updates', async () => {
    storageMocks.getItem.mockResolvedValue(null);

    const { updateActiveWorkspaceState } = await import('./active-workspace-storage');
    const result = await updateActiveWorkspaceState({
      order: { groupOrder: ['domain:example.com'], pinnedGroupKeys: [], groupTabOrder: {} },
    });

    expect(storageMocks.setItem).toHaveBeenCalledWith('local:tabstow-active-workspace', result);
    expect(result.order.groupOrder).toEqual(['domain:example.com']);
  });
});
```

- [ ] **Step 4: Implement active workspace storage**

Create `apps/extension/src/features/active-tabs/active-workspace-storage.ts`:

```ts
import { storage } from '#imports';
import { normalizeManualGroupsState } from './manual-groups';
import type { ActiveWorkspaceOrderState, ManualGroupsState } from './types';

const ACTIVE_WORKSPACE_KEY = 'local:tabstow-active-workspace';

export type ChromeTabGroupMapping = {
  virtualGroupKey: string;
  windowId: number;
  chromeGroupId: number;
};

export type ChromeTabGroupsState = {
  enabled: boolean;
  mappings: ChromeTabGroupMapping[];
};

export type ActiveWorkspaceState = {
  manualGroups: ManualGroupsState;
  order: ActiveWorkspaceOrderState;
  chromeTabGroups: ChromeTabGroupsState;
};

const DEFAULT_STATE: ActiveWorkspaceState = {
  manualGroups: { groups: [], assignments: {} },
  order: { groupOrder: [], pinnedGroupKeys: [], groupTabOrder: {} },
  chromeTabGroups: { enabled: false, mappings: [] },
};

function normalizeOrder(input: Partial<ActiveWorkspaceOrderState> | undefined): ActiveWorkspaceOrderState {
  return {
    groupOrder: Array.isArray(input?.groupOrder) ? input.groupOrder.map(String).filter(Boolean) : [],
    pinnedGroupKeys: Array.isArray(input?.pinnedGroupKeys) ? input.pinnedGroupKeys.map(String).filter(Boolean) : [],
    groupTabOrder: input?.groupTabOrder && typeof input.groupTabOrder === 'object'
      ? Object.fromEntries(
          Object.entries(input.groupTabOrder).map(([key, ids]) => [
            key,
            Array.isArray(ids) ? ids.map(String).filter(Boolean) : [],
          ]),
        )
      : {},
  };
}

function normalizeChromeGroups(input: Partial<ChromeTabGroupsState> | undefined): ChromeTabGroupsState {
  return {
    enabled: Boolean(input?.enabled),
    mappings: Array.isArray(input?.mappings)
      ? input.mappings
          .filter((mapping) => mapping.virtualGroupKey && Number.isInteger(mapping.windowId) && Number.isInteger(mapping.chromeGroupId))
          .map((mapping) => ({
            virtualGroupKey: String(mapping.virtualGroupKey),
            windowId: Number(mapping.windowId),
            chromeGroupId: Number(mapping.chromeGroupId),
          }))
      : [],
  };
}

export function normalizeActiveWorkspaceState(input: Partial<ActiveWorkspaceState> | null | undefined): ActiveWorkspaceState {
  return {
    manualGroups: normalizeManualGroupsState(input?.manualGroups),
    order: normalizeOrder(input?.order),
    chromeTabGroups: normalizeChromeGroups(input?.chromeTabGroups),
  };
}

export async function getActiveWorkspaceState(): Promise<ActiveWorkspaceState> {
  return normalizeActiveWorkspaceState(await storage.getItem<Partial<ActiveWorkspaceState>>(ACTIVE_WORKSPACE_KEY));
}

export async function updateActiveWorkspaceState(
  partial: Partial<ActiveWorkspaceState>,
): Promise<ActiveWorkspaceState> {
  const current = await getActiveWorkspaceState();
  const next = normalizeActiveWorkspaceState({
    ...current,
    ...partial,
    manualGroups: partial.manualGroups ?? current.manualGroups,
    order: partial.order ?? current.order,
    chromeTabGroups: partial.chromeTabGroups ?? current.chromeTabGroups,
  });
  await storage.setItem(ACTIVE_WORKSPACE_KEY, next);
  return next;
}
```

- [ ] **Step 5: Run task tests**

Run:

```bash
bun --cwd apps/extension run test -- src/features/active-tabs/manual-groups.test.ts src/features/active-tabs/active-workspace-storage.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/extension/src/features/active-tabs/manual-groups.ts apps/extension/src/features/active-tabs/manual-groups.test.ts apps/extension/src/features/active-tabs/active-workspace-storage.ts apps/extension/src/features/active-tabs/active-workspace-storage.test.ts
git commit -m "feat(active-tabs): add manual workspace state"
```

---

### Task 5: Native Chrome Tab Groups

**Files:**
- Create: `apps/extension/src/features/chrome-tab-groups/chrome-tab-groups.ts`
- Create: `apps/extension/src/features/chrome-tab-groups/chrome-tab-groups.test.ts`
- Modify: `apps/extension/src/lib/messages.ts`
- Modify: `apps/extension/src/entrypoints/background.ts`
- Modify: `apps/extension/src/tests/background.test.ts`

**Interfaces:**
- Consumes: `ActiveTabGroup[]`, `ChromeTabGroupsState`
- Produces: `syncChromeTabGroups(groups, state): Promise<AppResult<ChromeTabGroupsState>>`
- Produces: `importChromeTabGroups(tabs, manualGroups, state): Promise<AppResult<ImportedChromeGroupsResult>>`
- Produces: `collapseChromeTabGroups(windowId): Promise<AppResult<{ collapsed: true; groupCount: number }>>`
- Produces message types: `chrome-tab-groups:sync`, `chrome-tab-groups:import`, `chrome-tab-groups:collapse-window`

- [ ] **Step 1: Write failing Chrome group tests**

Create `apps/extension/src/features/chrome-tab-groups/chrome-tab-groups.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActiveTabGroup } from '@/features/active-tabs/types';

const browserMocks = vi.hoisted(() => ({
  tabGroups: {
    query: vi.fn(),
    update: vi.fn(),
  },
  tabs: {
    group: vi.fn(),
    query: vi.fn(),
  },
}));

vi.mock('@/lib/browser', () => ({
  browser: browserMocks,
}));

const groups: ActiveTabGroup[] = [
  {
    key: 'manual:launch',
    kind: 'manual',
    title: 'Launch',
    pinned: false,
    tabs: [
      { id: 10, windowId: 2, index: 0, active: false, pinned: false, url: 'https://example.com/a' },
      { id: 11, windowId: 2, index: 1, active: false, pinned: false, url: 'https://example.com/b' },
    ],
  },
];

describe('chrome tab groups', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('groups tabs and stores mapping metadata', async () => {
    browserMocks.tabs.group.mockResolvedValue(99);

    const { syncChromeTabGroups } = await import('./chrome-tab-groups');
    const result = await syncChromeTabGroups(groups, { enabled: true, mappings: [] });

    expect(browserMocks.tabs.group).toHaveBeenCalledWith({ tabIds: [10, 11] });
    expect(browserMocks.tabGroups.update).toHaveBeenCalledWith(99, { title: 'Launch', collapsed: true });
    expect(result).toEqual({
      ok: true,
      data: { enabled: true, mappings: [{ virtualGroupKey: 'manual:launch', windowId: 2, chromeGroupId: 99 }] },
    });
  });

  it('does nothing when native tab-group sync is disabled', async () => {
    const { syncChromeTabGroups } = await import('./chrome-tab-groups');
    const result = await syncChromeTabGroups(groups, { enabled: false, mappings: [] });

    expect(browserMocks.tabs.group).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true, data: { enabled: false, mappings: [] } });
  });

  it('collapses all groups in a window', async () => {
    browserMocks.tabGroups.query.mockResolvedValue([{ id: 3, windowId: 7 }, { id: 4, windowId: 8 }]);

    const { collapseChromeTabGroups } = await import('./chrome-tab-groups');
    const result = await collapseChromeTabGroups(7);

    expect(browserMocks.tabGroups.update).toHaveBeenCalledWith(3, { collapsed: true });
    expect(browserMocks.tabGroups.update).not.toHaveBeenCalledWith(4, expect.anything());
    expect(result).toEqual({ ok: true, data: { collapsed: true, groupCount: 1 } });
  });

  it('imports existing Chrome groups into manual groups', async () => {
    browserMocks.tabGroups.query.mockResolvedValue([{ id: 31, windowId: 7, title: 'Reading' }]);

    const { importChromeTabGroups } = await import('./chrome-tab-groups');
    const result = await importChromeTabGroups(
      [
        { id: 1, windowId: 7, groupId: 31, index: 0, active: false, pinned: false, url: 'https://example.com' },
      ],
      { groups: [], assignments: {} },
      { enabled: true, mappings: [] },
      () => 'manual-31',
    );

    expect(result).toEqual({
      ok: true,
      data: {
        manualGroups: {
          groups: [{ id: 'manual-31', name: 'Reading', createdAt: expect.any(String) }],
          assignments: { '1': 'manual-31' },
        },
        chromeTabGroups: {
          enabled: true,
          mappings: [{ virtualGroupKey: 'manual:manual-31', windowId: 7, chromeGroupId: 31 }],
        },
      },
    });
  });
});
```

- [ ] **Step 2: Implement Chrome group service**

Create `apps/extension/src/features/chrome-tab-groups/chrome-tab-groups.ts`:

```ts
import {
  addManualGroup,
  assignTabToManualGroup,
} from '@/features/active-tabs/manual-groups';
import type {
  ActiveBrowserTab,
  ActiveTabGroup,
  ManualGroupsState,
} from '@/features/active-tabs/types';
import type { ChromeTabGroupsState } from '@/features/active-tabs/active-workspace-storage';
import { browser } from '@/lib/browser';
import { err, ok, toErrorMessage, type AppResult } from '@/lib/errors';

export type ImportedChromeGroupsResult = {
  manualGroups: ManualGroupsState;
  chromeTabGroups: ChromeTabGroupsState;
};

function getTabIds(group: ActiveTabGroup): number[] {
  return group.tabs.map((tab) => tab.id).filter((id): id is number => typeof id === 'number');
}

export async function syncChromeTabGroups(
  groups: ActiveTabGroup[],
  state: ChromeTabGroupsState,
): Promise<AppResult<ChromeTabGroupsState>> {
  if (!state.enabled) return ok(state);

  try {
    const nextMappings: ChromeTabGroupsState['mappings'] = [];

    for (const group of groups.filter((item) => item.kind === 'manual')) {
      const tabIds = getTabIds(group);
      const firstWindowId = group.tabs.find((tab) => typeof tab.windowId === 'number')?.windowId;
      if (tabIds.length === 0 || typeof firstWindowId !== 'number') continue;

      const existing = state.mappings.find(
        (mapping) => mapping.virtualGroupKey === group.key && mapping.windowId === firstWindowId,
      );
      const chromeGroupId = existing?.chromeGroupId ?? await browser.tabs.group({ tabIds });
      if (existing) {
        await browser.tabs.group({ groupId: chromeGroupId, tabIds });
      }
      await browser.tabGroups.update(chromeGroupId, { title: group.title, collapsed: true });
      nextMappings.push({ virtualGroupKey: group.key, windowId: firstWindowId, chromeGroupId });
    }

    return ok({ enabled: true, mappings: nextMappings });
  } catch (error) {
    return err('chrome-tabs-error', toErrorMessage(error));
  }
}

export async function collapseChromeTabGroups(
  windowId: number,
): Promise<AppResult<{ collapsed: true; groupCount: number }>> {
  try {
    const groups = await browser.tabGroups.query({});
    const matchingGroups = groups.filter((group) => group.windowId === windowId);
    await Promise.all(matchingGroups.map((group) => browser.tabGroups.update(group.id, { collapsed: true })));
    return ok({ collapsed: true, groupCount: matchingGroups.length });
  } catch (error) {
    return err('chrome-tabs-error', toErrorMessage(error));
  }
}

export async function importChromeTabGroups(
  tabs: ActiveBrowserTab[],
  manualGroups: ManualGroupsState,
  state: ChromeTabGroupsState,
  createId: () => string = () => crypto.randomUUID(),
): Promise<AppResult<ImportedChromeGroupsResult>> {
  try {
    const chromeGroups = await browser.tabGroups.query({});
    let nextManualGroups = manualGroups;
    const mappings = [...state.mappings];

    for (const chromeGroup of chromeGroups) {
      const groupTabs = tabs.filter((tab) => tab.groupId === chromeGroup.id && typeof tab.id === 'number');
      if (groupTabs.length === 0) continue;

      const existingMapping = mappings.find((mapping) => mapping.chromeGroupId === chromeGroup.id);
      let manualGroupId = existingMapping?.virtualGroupKey.replace(/^manual:/, '') ?? '';

      if (!manualGroupId || !nextManualGroups.groups.some((group) => group.id === manualGroupId)) {
        const baseName = chromeGroup.title?.trim() || `Chrome group ${chromeGroup.id}`;
        const name = nextManualGroups.groups.some((group) => group.name.toLowerCase() === baseName.toLowerCase())
          ? `${baseName} ${chromeGroup.id}`
          : baseName;
        const created = addManualGroup(nextManualGroups, name, createId);
        nextManualGroups = created.state;
        manualGroupId = created.group.id;
      }

      for (const tab of groupTabs) {
        nextManualGroups = assignTabToManualGroup(nextManualGroups, tab.id as number, manualGroupId);
      }

      if (!existingMapping) {
        mappings.push({
          virtualGroupKey: `manual:${manualGroupId}`,
          windowId: chromeGroup.windowId,
          chromeGroupId: chromeGroup.id,
        });
      }
    }

    return ok({
      manualGroups: nextManualGroups,
      chromeTabGroups: { enabled: state.enabled, mappings },
    });
  } catch (error) {
    return err('chrome-tabs-error', toErrorMessage(error));
  }
}
```

- [ ] **Step 3: Extend messages and background routes**

Add to `ExtensionMessage` in `apps/extension/src/lib/messages.ts`:

```ts
  | { type: 'chrome-tab-groups:sync'; groups: ActiveTabGroup[]; state: ChromeTabGroupsState }
  | { type: 'chrome-tab-groups:import'; tabs: ActiveBrowserTab[]; manualGroups: ManualGroupsState; state: ChromeTabGroupsState }
  | { type: 'chrome-tab-groups:collapse-window'; windowId: number }
```

Add imports:

```ts
import type { ActiveBrowserTab, ActiveTabGroup, ManualGroupsState } from '@/features/active-tabs/types';
import type { ChromeTabGroupsState } from '@/features/active-tabs/active-workspace-storage';
import type { ImportedChromeGroupsResult } from '@/features/chrome-tab-groups/chrome-tab-groups';
```

Add response variants:

```ts
  | AppResult<ChromeTabGroupsState>
  | AppResult<ImportedChromeGroupsResult>
  | AppResult<{ collapsed: true; groupCount: number }>;
```

In `apps/extension/src/entrypoints/background.ts`, import:

```ts
import {
  collapseChromeTabGroups,
  importChromeTabGroups,
  syncChromeTabGroups,
} from '@/features/chrome-tab-groups/chrome-tab-groups';
```

Add switch cases:

```ts
      case 'chrome-tab-groups:sync':
        return syncChromeTabGroups(message.groups, message.state);
      case 'chrome-tab-groups:import':
        return importChromeTabGroups(message.tabs, message.manualGroups, message.state);
      case 'chrome-tab-groups:collapse-window':
        return collapseChromeTabGroups(message.windowId);
```

- [ ] **Step 4: Add background routing coverage**

Add mocks in `apps/extension/src/tests/background.test.ts`:

```ts
const chromeTabGroupMocks = vi.hoisted(() => ({
  collapseChromeTabGroups: vi.fn(),
  importChromeTabGroups: vi.fn(),
  syncChromeTabGroups: vi.fn(),
}));

vi.mock('@/features/chrome-tab-groups/chrome-tab-groups', () => chromeTabGroupMocks);
```

Add test:

```ts
it('routes chrome tab group sync messages', async () => {
  chromeTabGroupMocks.syncChromeTabGroups.mockResolvedValue({
    ok: true,
    data: { enabled: true, mappings: [] },
  });

  await import('../entrypoints/background');

  const listener = browserMocks.runtime.onMessage.addListener.mock.calls[0]?.[0];
  await listener?.({
    type: 'chrome-tab-groups:sync',
    groups: [],
    state: { enabled: true, mappings: [] },
  }, {});

  expect(chromeTabGroupMocks.syncChromeTabGroups).toHaveBeenCalledWith([], { enabled: true, mappings: [] });
});

it('routes chrome tab group import messages', async () => {
  chromeTabGroupMocks.importChromeTabGroups.mockResolvedValue({
    ok: true,
    data: {
      manualGroups: { groups: [], assignments: {} },
      chromeTabGroups: { enabled: true, mappings: [] },
    },
  });

  await import('../entrypoints/background');

  const listener = browserMocks.runtime.onMessage.addListener.mock.calls[0]?.[0];
  const payload = {
    tabs: [],
    manualGroups: { groups: [], assignments: {} },
    state: { enabled: true, mappings: [] },
  };
  await listener?.({ type: 'chrome-tab-groups:import', ...payload }, {});

  expect(chromeTabGroupMocks.importChromeTabGroups).toHaveBeenCalledWith(payload.tabs, payload.manualGroups, payload.state);
});
```

- [ ] **Step 5: Run task tests**

Run:

```bash
bun --cwd apps/extension run test -- src/features/chrome-tab-groups/chrome-tab-groups.test.ts src/tests/background.test.ts src/tests/manifest.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/extension/src/features/chrome-tab-groups/chrome-tab-groups.ts apps/extension/src/features/chrome-tab-groups/chrome-tab-groups.test.ts apps/extension/src/lib/messages.ts apps/extension/src/entrypoints/background.ts apps/extension/src/tests/background.test.ts
git commit -m "feat(tab-groups): add native chrome group sync"
```

---

### Task 6: Quick Links

**Files:**
- Create: `apps/extension/src/features/quick-links/quick-links.ts`
- Create: `apps/extension/src/features/quick-links/quick-links.test.ts`
- Create: `apps/extension/src/features/quick-links/quick-links-storage.ts`
- Create: `apps/extension/src/features/quick-links/quick-links-storage.test.ts`

**Interfaces:**
- Produces: `QuickLink`
- Produces: `normalizeQuickLinks(input): QuickLink[]`
- Produces: `createQuickLink(input, idFactory): QuickLink`
- Produces: `reorderQuickLinks(links, orderedIds): QuickLink[]`
- Produces: `getQuickLinks()`, `saveQuickLinks(links)`

- [ ] **Step 1: Write failing quick link tests**

Create `apps/extension/src/features/quick-links/quick-links.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createQuickLink, normalizeQuickLinks, reorderQuickLinks } from './quick-links';

describe('quick links', () => {
  it('normalizes valid links and drops invalid links', () => {
    expect(normalizeQuickLinks([{ id: 'a', url: 'https://example.com', label: 'Example' }, { id: '', url: 'bad' }])).toEqual([
      { id: 'a', url: 'https://example.com/', label: 'Example', icon: null, createdAt: expect.any(String) },
    ]);
  });

  it('creates a quick link with deterministic id', () => {
    expect(createQuickLink({ url: 'https://openai.com', label: 'OpenAI' }, () => 'q-1')).toEqual({
      id: 'q-1',
      url: 'https://openai.com/',
      label: 'OpenAI',
      icon: null,
      createdAt: expect.any(String),
    });
  });

  it('reorders by id and appends missing links', () => {
    const links = [
      { id: 'a', url: 'https://a.example/', label: 'A', icon: null, createdAt: '2026-07-06T00:00:00.000Z' },
      { id: 'b', url: 'https://b.example/', label: 'B', icon: null, createdAt: '2026-07-06T00:00:00.000Z' },
    ];

    expect(reorderQuickLinks(links, ['b'])).toEqual([links[1], links[0]]);
  });
});
```

- [ ] **Step 2: Implement quick link helpers**

Create `apps/extension/src/features/quick-links/quick-links.ts`:

```ts
export type QuickLinkIcon =
  | { kind: 'emoji'; value: string }
  | { kind: 'image'; value: string }
  | { kind: 'site'; value: null };

export type QuickLink = {
  id: string;
  url: string;
  label: string;
  icon: QuickLinkIcon | null;
  createdAt: string;
};

function normalizeUrl(value: string): string | null {
  try {
    return new URL(value).toString();
  } catch {
    return null;
  }
}

export function normalizeQuickLinks(input: unknown): QuickLink[] {
  if (!Array.isArray(input)) return [];

  return input
    .map((item) => {
      const candidate = item as Partial<QuickLink>;
      const url = normalizeUrl(String(candidate.url ?? ''));
      const id = String(candidate.id ?? '');
      if (!id || !url) return null;
      return {
        id,
        url,
        label: String(candidate.label ?? '').trim() || new URL(url).hostname.replace(/^www\./, ''),
        icon: candidate.icon ?? null,
        createdAt: candidate.createdAt ?? new Date().toISOString(),
      };
    })
    .filter((item): item is QuickLink => Boolean(item));
}

export function createQuickLink(
  input: { url: string; label?: string; icon?: QuickLinkIcon | null },
  createId: () => string = () => crypto.randomUUID(),
): QuickLink {
  const url = normalizeUrl(input.url);
  if (!url) throw new Error('Quick link URL is invalid.');
  return {
    id: createId(),
    url,
    label: input.label?.trim() || new URL(url).hostname.replace(/^www\./, ''),
    icon: input.icon ?? null,
    createdAt: new Date().toISOString(),
  };
}

export function reorderQuickLinks(links: QuickLink[], orderedIds: string[]): QuickLink[] {
  const normalized = normalizeQuickLinks(links);
  const byId = new Map(normalized.map((link) => [link.id, link]));
  const ordered = orderedIds.map((id) => byId.get(id)).filter((link): link is QuickLink => Boolean(link));
  const orderedSet = new Set(ordered.map((link) => link.id));
  return [...ordered, ...normalized.filter((link) => !orderedSet.has(link.id))];
}
```

- [ ] **Step 3: Write and implement storage**

Create `apps/extension/src/features/quick-links/quick-links-storage.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const storageMocks = vi.hoisted(() => ({
  getItem: vi.fn(),
  setItem: vi.fn(),
}));

vi.mock('#imports', () => ({
  storage: storageMocks,
}));

describe('quick link storage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads normalized links', async () => {
    storageMocks.getItem.mockResolvedValue([{ id: 'a', url: 'https://example.com', label: 'Example' }]);

    const { getQuickLinks } = await import('./quick-links-storage');
    expect(await getQuickLinks()).toEqual([
      { id: 'a', url: 'https://example.com/', label: 'Example', icon: null, createdAt: expect.any(String) },
    ]);
  });
});
```

Create `apps/extension/src/features/quick-links/quick-links-storage.ts`:

```ts
import { storage } from '#imports';
import { normalizeQuickLinks, type QuickLink } from './quick-links';

const QUICK_LINKS_KEY = 'local:tabstow-quick-links';

export async function getQuickLinks(): Promise<QuickLink[]> {
  return normalizeQuickLinks(await storage.getItem<QuickLink[]>(QUICK_LINKS_KEY));
}

export async function saveQuickLinks(links: QuickLink[]): Promise<QuickLink[]> {
  const normalized = normalizeQuickLinks(links);
  await storage.setItem(QUICK_LINKS_KEY, normalized);
  return normalized;
}
```

- [ ] **Step 4: Run task tests**

Run:

```bash
bun --cwd apps/extension run test -- src/features/quick-links/quick-links.test.ts src/features/quick-links/quick-links-storage.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/extension/src/features/quick-links/quick-links.ts apps/extension/src/features/quick-links/quick-links.test.ts apps/extension/src/features/quick-links/quick-links-storage.ts apps/extension/src/features/quick-links/quick-links-storage.test.ts
git commit -m "feat(quick-links): add local quick links"
```

---

### Task 7: Todos

**Files:**
- Create: `apps/extension/src/features/todos/todos.ts`
- Create: `apps/extension/src/features/todos/todos.test.ts`
- Create: `apps/extension/src/features/todos/todos-storage.ts`
- Create: `apps/extension/src/features/todos/todos-storage.test.ts`

**Interfaces:**
- Produces: `TodoItem`
- Produces: `createTodo`, `completeTodo`, `dismissTodo`, `clearCompletedTodos`, `searchTodos`, `reorderTodos`
- Produces: `getTodos()`, `saveTodos(todos)`

- [ ] **Step 1: Write failing todo tests**

Create `apps/extension/src/features/todos/todos.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { clearCompletedTodos, completeTodo, createTodo, dismissTodo, normalizeTodos, reorderTodos, searchTodos } from './todos';

describe('todos', () => {
  it('creates active todos', () => {
    expect(createTodo([], { title: 'Ship migration', description: 'Keep scope tight' }, () => 'todo-1')).toEqual([
      {
        id: 'todo-1',
        title: 'Ship migration',
        description: 'Keep scope tight',
        createdAt: expect.any(String),
        completed: false,
        completedAt: null,
        dismissed: false,
      },
    ]);
  });

  it('completes, dismisses, and clears completed todos', () => {
    const todos = normalizeTodos([{ id: 'a', title: 'Done', completed: false }]);
    const completed = completeTodo(todos, 'a');
    expect(completed[0].completed).toBe(true);
    expect(dismissTodo(completed, 'a')[0].dismissed).toBe(true);
    expect(clearCompletedTodos(completed)[0].dismissed).toBe(true);
  });

  it('searches title and description', () => {
    const todos = normalizeTodos([{ id: 'a', title: 'Review', description: 'Chrome groups' }]);
    expect(searchTodos(todos, 'groups')).toHaveLength(1);
  });

  it('reorders todos by id', () => {
    const todos = normalizeTodos([{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }]);
    expect(reorderTodos(todos, ['b', 'a']).map((todo) => todo.id)).toEqual(['b', 'a']);
  });
});
```

- [ ] **Step 2: Implement todos helpers**

Create `apps/extension/src/features/todos/todos.ts`:

```ts
export type TodoItem = {
  id: string;
  title: string;
  description: string;
  createdAt: string;
  completed: boolean;
  completedAt: string | null;
  dismissed: boolean;
};

export function normalizeTodos(input: unknown): TodoItem[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((todo) => todo && typeof todo === 'object')
    .map((todo) => todo as Partial<TodoItem>)
    .filter((todo) => todo.id && todo.title)
    .map((todo) => ({
      id: String(todo.id),
      title: String(todo.title).trim(),
      description: String(todo.description ?? ''),
      createdAt: todo.createdAt ?? new Date().toISOString(),
      completed: Boolean(todo.completed),
      completedAt: todo.completedAt ?? null,
      dismissed: Boolean(todo.dismissed),
    }));
}

export function createTodo(
  todos: TodoItem[],
  payload: { title: string; description?: string },
  createId: () => string = () => crypto.randomUUID(),
): TodoItem[] {
  const title = payload.title.trim();
  if (!title) throw new Error('Todo title is required.');
  return [
    ...normalizeTodos(todos),
    {
      id: createId(),
      title,
      description: payload.description?.trim() ?? '',
      createdAt: new Date().toISOString(),
      completed: false,
      completedAt: null,
      dismissed: false,
    },
  ];
}

export function completeTodo(todos: TodoItem[], id: string): TodoItem[] {
  return normalizeTodos(todos).map((todo) => todo.id === id
    ? { ...todo, completed: true, completedAt: new Date().toISOString() }
    : todo);
}

export function dismissTodo(todos: TodoItem[], id: string): TodoItem[] {
  return normalizeTodos(todos).map((todo) => todo.id === id ? { ...todo, dismissed: true } : todo);
}

export function clearCompletedTodos(todos: TodoItem[]): TodoItem[] {
  return normalizeTodos(todos).map((todo) => todo.completed ? { ...todo, dismissed: true } : todo);
}

export function searchTodos(todos: TodoItem[], query: string): TodoItem[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return normalizeTodos(todos);
  return normalizeTodos(todos).filter(
    (todo) => todo.title.toLowerCase().includes(needle) || todo.description.toLowerCase().includes(needle),
  );
}

export function reorderTodos(todos: TodoItem[], orderedIds: string[]): TodoItem[] {
  const normalized = normalizeTodos(todos);
  const byId = new Map(normalized.map((todo) => [todo.id, todo]));
  const ordered = orderedIds.map((id) => byId.get(id)).filter((todo): todo is TodoItem => Boolean(todo));
  const orderedSet = new Set(ordered.map((todo) => todo.id));
  return [...ordered, ...normalized.filter((todo) => !orderedSet.has(todo.id))];
}
```

- [ ] **Step 3: Write and implement todo storage**

Create `apps/extension/src/features/todos/todos-storage.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const storageMocks = vi.hoisted(() => ({
  getItem: vi.fn(),
  setItem: vi.fn(),
}));

vi.mock('#imports', () => ({
  storage: storageMocks,
}));

describe('todo storage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads normalized todos', async () => {
    storageMocks.getItem.mockResolvedValue([{ id: 'a', title: 'Review' }]);
    const { getTodos } = await import('./todos-storage');
    expect(await getTodos()).toEqual([
      {
        id: 'a',
        title: 'Review',
        description: '',
        createdAt: expect.any(String),
        completed: false,
        completedAt: null,
        dismissed: false,
      },
    ]);
  });
});
```

Create `apps/extension/src/features/todos/todos-storage.ts`:

```ts
import { storage } from '#imports';
import { normalizeTodos, type TodoItem } from './todos';

const TODOS_KEY = 'local:tabstow-todos';

export async function getTodos(): Promise<TodoItem[]> {
  return normalizeTodos(await storage.getItem<TodoItem[]>(TODOS_KEY));
}

export async function saveTodos(todos: TodoItem[]): Promise<TodoItem[]> {
  const normalized = normalizeTodos(todos);
  await storage.setItem(TODOS_KEY, normalized);
  return normalized;
}
```

- [ ] **Step 4: Run task tests**

Run:

```bash
bun --cwd apps/extension run test -- src/features/todos/todos.test.ts src/features/todos/todos-storage.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/extension/src/features/todos/todos.ts apps/extension/src/features/todos/todos.test.ts apps/extension/src/features/todos/todos-storage.ts apps/extension/src/features/todos/todos-storage.test.ts
git commit -m "feat(todos): add local todo storage"
```

---

### Task 8: Theme And Localization

**Files:**
- Create: `apps/extension/src/features/theme/theme-preferences.ts`
- Create: `apps/extension/src/features/theme/theme-preferences.test.ts`
- Create: `apps/extension/src/features/i18n/i18n.ts`
- Create: `apps/extension/src/features/i18n/i18n.test.ts`

**Interfaces:**
- Produces: `ThemePreferences`, `getThemePreferences()`, `saveThemePreferences(preferences)`
- Produces: `LanguagePreference`, `resolveLocale(preference, browserLanguage)`, `t(locale, key, vars?)`

- [ ] **Step 1: Write failing tests**

Create `apps/extension/src/features/theme/theme-preferences.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { normalizeThemePreferences } from './theme-preferences';

describe('theme preferences', () => {
  it('normalizes theme preferences', () => {
    expect(normalizeThemePreferences({ mode: 'dark', paletteId: 'sage', surfaceOpacity: 84 })).toEqual({
      mode: 'dark',
      paletteId: 'sage',
      surfaceOpacity: 84,
      customBackground: null,
    });
  });

  it('clamps surface opacity', () => {
    expect(normalizeThemePreferences({ surfaceOpacity: 1 }).surfaceOpacity).toBe(35);
    expect(normalizeThemePreferences({ surfaceOpacity: 101 }).surfaceOpacity).toBe(100);
  });
});
```

Create `apps/extension/src/features/i18n/i18n.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { resolveLocale, t } from './i18n';

describe('i18n', () => {
  it('resolves automatic Simplified Chinese locale', () => {
    expect(resolveLocale('auto', 'zh-CN')).toBe('zh-CN');
  });

  it('falls back to English messages', () => {
    expect(t('en', 'stowCurrentWindow')).toBe('Stow current window');
    expect(t('zh-CN', 'stowCurrentWindow')).toBe('收起当前窗口');
  });
});
```

- [ ] **Step 2: Implement theme preferences**

Create `apps/extension/src/features/theme/theme-preferences.ts`:

```ts
import { storage } from '#imports';

const THEME_KEY = 'local:tabstow-theme-preferences';
const VALID_MODES = new Set(['system', 'light', 'dark']);
const VALID_PALETTES = new Set(['paper', 'sage', 'mist', 'blush']);

export type ThemeMode = 'system' | 'light' | 'dark';
export type ThemePaletteId = 'paper' | 'sage' | 'mist' | 'blush';

export type ThemePreferences = {
  mode: ThemeMode;
  paletteId: ThemePaletteId;
  surfaceOpacity: number;
  customBackground: string | null;
};

export function normalizeThemePreferences(input: Partial<ThemePreferences> | null | undefined): ThemePreferences {
  const mode = VALID_MODES.has(String(input?.mode)) ? input?.mode as ThemeMode : 'system';
  const paletteId = VALID_PALETTES.has(String(input?.paletteId)) ? input?.paletteId as ThemePaletteId : 'paper';
  const surfaceOpacity = Math.min(100, Math.max(35, Number(input?.surfaceOpacity ?? 92)));
  const customBackground = typeof input?.customBackground === 'string' && input.customBackground.startsWith('data:image/')
    ? input.customBackground
    : null;
  return { mode, paletteId, surfaceOpacity, customBackground };
}

export async function getThemePreferences(): Promise<ThemePreferences> {
  return normalizeThemePreferences(await storage.getItem<Partial<ThemePreferences>>(THEME_KEY));
}

export async function saveThemePreferences(preferences: Partial<ThemePreferences>): Promise<ThemePreferences> {
  const normalized = normalizeThemePreferences(preferences);
  await storage.setItem(THEME_KEY, normalized);
  return normalized;
}
```

- [ ] **Step 3: Implement localization helper**

Create `apps/extension/src/features/i18n/i18n.ts`:

```ts
import { storage } from '#imports';

const LANGUAGE_KEY = 'local:tabstow-language';

export type LanguagePreference = 'auto' | 'en' | 'zh-CN';
export type Locale = 'en' | 'zh-CN';

const messages = {
  en: {
    activeTabs: 'Active tabs',
    addQuickLink: 'Add quick link',
    quickLinks: 'Quick links',
    searchTheWeb: 'Search the web',
    stowCurrentWindow: 'Stow current window',
    stowedSessions: 'Stowed sessions',
    todos: 'Todos',
  },
  'zh-CN': {
    activeTabs: '打开的标签页',
    addQuickLink: '添加快捷链接',
    quickLinks: '快捷链接',
    searchTheWeb: '搜索网页',
    stowCurrentWindow: '收起当前窗口',
    stowedSessions: '已收起的标签页',
    todos: '待办',
  },
} as const;

export type MessageKey = keyof typeof messages.en;

export function normalizeLanguagePreference(input: unknown): LanguagePreference {
  return input === 'en' || input === 'zh-CN' || input === 'auto' ? input : 'auto';
}

export function resolveLocale(preference: LanguagePreference, browserLanguage: string): Locale {
  if (preference === 'zh-CN' || preference === 'en') return preference;
  return browserLanguage.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
}

export function t(locale: Locale, key: MessageKey): string {
  return messages[locale][key] ?? messages.en[key];
}

export async function getLanguagePreference(): Promise<LanguagePreference> {
  return normalizeLanguagePreference(await storage.getItem<LanguagePreference>(LANGUAGE_KEY));
}

export async function saveLanguagePreference(preference: LanguagePreference): Promise<LanguagePreference> {
  const normalized = normalizeLanguagePreference(preference);
  await storage.setItem(LANGUAGE_KEY, normalized);
  return normalized;
}
```

- [ ] **Step 4: Run task tests**

Run:

```bash
bun --cwd apps/extension run test -- src/features/theme/theme-preferences.test.ts src/features/i18n/i18n.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/extension/src/features/theme/theme-preferences.ts apps/extension/src/features/theme/theme-preferences.test.ts apps/extension/src/features/i18n/i18n.ts apps/extension/src/features/i18n/i18n.test.ts
git commit -m "feat(ui): add theme and localization state"
```

---

### Task 9: New Tab UI Structure

**Files:**
- Modify: `apps/extension/src/entrypoints/newtab/App.tsx`
- Create: `apps/extension/src/entrypoints/newtab/components/StowedSessions.tsx`
- Create: `apps/extension/src/entrypoints/newtab/components/SearchBox.tsx`
- Modify: `apps/extension/src/entrypoints/newtab/styles.css`

**Interfaces:**
- Consumes: existing `sendExtensionMessage`, `TabSession`, `StowResult`, `SyncResult`
- Produces: `StowedSessions` component
- Produces: `SearchBox` component

- [ ] **Step 1: Extract stowed sessions component**

Create `apps/extension/src/entrypoints/newtab/components/StowedSessions.tsx` by moving the current session list, stats, restore, delete, pull, push, and stow interactions from `App.tsx` into this component:

```tsx
import { Archive, RefreshCcw, RotateCcw, Settings, Trash2, UploadCloud } from 'lucide-react';
import { useMemo } from 'react';
import type { TabSession } from '@tabstow/core';
import type { AppResult } from '@/lib/errors';
import { sendExtensionMessage, type StowResult, type SyncResult } from '@/lib/messages';
import { StatusMessage } from '@/components/StatusMessage';

type StatusState = {
  tone: 'info' | 'success' | 'error';
  message: string | null;
};

type Props = {
  busyAction: string | null;
  sessions: TabSession[];
  status: StatusState;
  onOpenOptions: () => void;
  onRunAction: <T>(actionId: string, action: () => Promise<AppResult<T>>, success: (data: T) => string) => Promise<void>;
};
```

Keep the current helper functions `formatDate`, `domainFromUrl`, and `sessionPreview` inside this component file. The JSX should preserve the existing stowed session buttons and status behavior.

- [ ] **Step 2: Create search component**

Create `apps/extension/src/entrypoints/newtab/components/SearchBox.tsx`:

```tsx
import { Search } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import type { AppResult } from '@/lib/errors';
import { sendExtensionMessage } from '@/lib/messages';

type Props = {
  disabled?: boolean;
  onStatus: (tone: 'success' | 'error', message: string) => void;
};

export function SearchBox({ disabled = false, onStatus }: Props) {
  const [query, setQuery] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const response = await sendExtensionMessage<AppResult<{ searched: true }>>({
      type: 'active-tabs:search',
      query,
    });
    if (response.ok) {
      setQuery('');
      onStatus('success', 'Search opened.');
      return;
    }
    onStatus('error', response.error.message);
  }

  return (
    <form className="dashboard-search" onSubmit={(event) => void submit(event)}>
      <Search size={16} aria-hidden="true" />
      <input
        aria-label="Search the web"
        disabled={disabled}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search with your default engine"
        type="search"
        value={query}
      />
    </form>
  );
}
```

- [ ] **Step 3: Recompose App**

Modify `apps/extension/src/entrypoints/newtab/App.tsx` so it owns shared state and renders:

```tsx
return (
  <main className="newtab-shell dashboard-shell">
    <section className="dashboard-topbar">
      <div>
        <h1 id="tabstow-title">Tabstow</h1>
        <p>Stow, organize, and restore your browser tabs.</p>
      </div>
      <SearchBox
        disabled={busyAction !== null}
        onStatus={(tone, message) => setStatus({ tone, message })}
      />
    </section>

    <StowedSessions
      busyAction={busyAction}
      onOpenOptions={openOptions}
      onRunAction={runAction}
      sessions={sessions}
      status={status}
    />
  </main>
);
```

Remove duplicated JSX from `App.tsx` after it exists in `StowedSessions.tsx`.

- [ ] **Step 4: Add layout CSS**

Add to `apps/extension/src/entrypoints/newtab/styles.css`:

```css
.dashboard-shell {
  display: grid;
  gap: 24px;
}

.dashboard-topbar {
  align-items: center;
  display: grid;
  gap: 16px;
  grid-template-columns: minmax(0, 1fr) minmax(260px, 420px);
}

.dashboard-search {
  align-items: center;
  background: var(--surface, #ffffff);
  border: 1px solid var(--border, #d7dde6);
  border-radius: 8px;
  display: flex;
  gap: 8px;
  min-height: 42px;
  padding: 0 12px;
}

.dashboard-search input {
  background: transparent;
  border: 0;
  color: inherit;
  flex: 1;
  font: inherit;
  min-width: 0;
  outline: 0;
}

@media (max-width: 760px) {
  .dashboard-topbar {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 5: Run tests and typecheck for UI extraction**

Run:

```bash
bun --cwd apps/extension run typecheck
bun --cwd apps/extension run test -- src/tests/background.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/extension/src/entrypoints/newtab/App.tsx apps/extension/src/entrypoints/newtab/components/StowedSessions.tsx apps/extension/src/entrypoints/newtab/components/SearchBox.tsx apps/extension/src/entrypoints/newtab/styles.css
git commit -m "refactor(newtab): split stowed session dashboard"
```

---

### Task 10: Active Workspace UI

**Files:**
- Create: `apps/extension/src/entrypoints/newtab/components/ActiveWorkspace.tsx`
- Create: `apps/extension/src/entrypoints/newtab/components/GroupNav.tsx`
- Modify: `apps/extension/src/entrypoints/newtab/App.tsx`
- Modify: `apps/extension/src/entrypoints/newtab/styles.css`

**Interfaces:**
- Consumes: `active-tabs:list`, `active-tabs:focus`, `active-tabs:close`
- Consumes: active workspace storage helpers
- Consumes: `buildActiveTabGroups`, `findDuplicateTabGroups`, manual group helpers
- Produces: active workspace dashboard section

- [ ] **Step 1: Create group navigation component**

Create `apps/extension/src/entrypoints/newtab/components/GroupNav.tsx`:

```tsx
import type { ActiveTabGroup } from '@/features/active-tabs/types';

type Props = {
  groups: ActiveTabGroup[];
  onJump: (groupKey: string) => void;
};

export function GroupNav({ groups, onJump }: Props) {
  if (groups.length === 0) return null;

  return (
    <nav className="group-nav" aria-label="Active tab groups">
      {groups.map((group) => (
        <button key={group.key} type="button" onClick={() => onJump(group.key)}>
          <span>{group.title}</span>
          <strong>{group.tabs.length}</strong>
        </button>
      ))}
    </nav>
  );
}
```

- [ ] **Step 2: Create active workspace component**

Create `apps/extension/src/entrypoints/newtab/components/ActiveWorkspace.tsx`:

```tsx
import { Archive, ExternalLink, Layers, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  buildActiveTabGroups,
  findDuplicateTabGroups,
} from '@/features/active-tabs/active-tab-groups';
import {
  getActiveWorkspaceState,
  updateActiveWorkspaceState,
  type ActiveWorkspaceState,
} from '@/features/active-tabs/active-workspace-storage';
import {
  addManualGroup,
  assignTabToManualGroup,
  clearTabManualGroup,
  pruneManualGroups,
} from '@/features/active-tabs/manual-groups';
import { getTabLabel } from '@/features/active-tabs/tab-labels';
import type { ActiveBrowserTab } from '@/features/active-tabs/types';
import type { AppResult } from '@/lib/errors';
import { sendExtensionMessage } from '@/lib/messages';
import { GroupNav } from './GroupNav';

type Props = {
  onStatus: (tone: 'success' | 'error', message: string) => void;
};
```

Implement component behavior:

```tsx
export function ActiveWorkspace({ onStatus }: Props) {
  const [tabs, setTabs] = useState<ActiveBrowserTab[]>([]);
  const [workspace, setWorkspace] = useState<ActiveWorkspaceState | null>(null);
  const groupRefs = useRef(new Map<string, HTMLElement>());

  async function refresh() {
    const [tabsResponse, state] = await Promise.all([
      sendExtensionMessage<AppResult<ActiveBrowserTab[]>>({ type: 'active-tabs:list' }),
      getActiveWorkspaceState(),
    ]);

    if (!tabsResponse.ok) {
      onStatus('error', tabsResponse.error.message);
      return;
    }

    const openIds = tabsResponse.data.map((tab) => tab.id).filter((id): id is number => typeof id === 'number');
    const prunedManualGroups = pruneManualGroups(state.manualGroups, openIds);
    const nextState = JSON.stringify(prunedManualGroups) === JSON.stringify(state.manualGroups)
      ? state
      : await updateActiveWorkspaceState({ manualGroups: prunedManualGroups });

    setTabs(tabsResponse.data);
    setWorkspace(nextState);
  }

  useEffect(() => {
    void refresh();
  }, []);

  const groups = useMemo(
    () => workspace ? buildActiveTabGroups(tabs, workspace.manualGroups, workspace.order) : [],
    [tabs, workspace],
  );
  const duplicateGroups = useMemo(() => findDuplicateTabGroups(tabs), [tabs]);

  async function closeTabs(tabIds: number[]) {
    const response = await sendExtensionMessage<AppResult<{ closed: true; tabCount: number }>>({
      type: 'active-tabs:close',
      tabIds,
    });
    if (response.ok) {
      onStatus('success', `Closed ${response.data.tabCount} tabs.`);
      await refresh();
      return;
    }
    onStatus('error', response.error.message);
  }

  async function focusTab(tab: ActiveBrowserTab) {
    if (typeof tab.id !== 'number' || typeof tab.windowId !== 'number') return;
    const response = await sendExtensionMessage<AppResult<{ focused: true }>>({
      type: 'active-tabs:focus',
      tabId: tab.id,
      windowId: tab.windowId,
    });
    if (!response.ok) onStatus('error', response.error.message);
  }
```

Render group cards with buttons for focus, close, stow current window hint, manual grouping, and duplicate cleanup. Use icon buttons with `aria-label`:

```tsx
  return (
    <section className="active-workspace" aria-labelledby="active-tabs-title">
      <div className="section-header">
        <h2 id="active-tabs-title">Active tabs</h2>
        <span>{tabs.length} open</span>
      </div>

      <GroupNav
        groups={groups}
        onJump={(groupKey) => groupRefs.current.get(groupKey)?.scrollIntoView({ block: 'start', behavior: 'smooth' })}
      />

      {duplicateGroups.length > 0 && (
        <button
          type="button"
          className="secondary-button"
          onClick={() => void closeTabs(duplicateGroups.flatMap((group) => group.duplicateTabIds))}
        >
          <Layers size={16} aria-hidden="true" />
          Close {duplicateGroups.reduce((count, group) => count + group.duplicateTabIds.length, 0)} duplicates
        </button>
      )}

      <div className="active-group-list">
        {groups.map((group) => (
          <article
            className="active-group"
            key={group.key}
            ref={(node) => {
              if (node) groupRefs.current.set(group.key, node);
            }}
          >
            <header>
              <h3>{group.title}</h3>
              <button
                type="button"
                className="icon-button"
                aria-label={`Close ${group.title} tabs`}
                onClick={() => void closeTabs(group.tabs.map((tab) => tab.id).filter((id): id is number => typeof id === 'number'))}
              >
                <X size={16} aria-hidden="true" />
              </button>
            </header>
            <div className="active-tab-list">
              {group.tabs.map((tab) => (
                <div className="active-tab-row" key={tab.id ?? tab.url}>
                  <button type="button" onClick={() => void focusTab(tab)}>
                    <ExternalLink size={14} aria-hidden="true" />
                    <span>{getTabLabel(tab)}</span>
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Close ${getTabLabel(tab)}`}
                    onClick={() => typeof tab.id === 'number' && void closeTabs([tab.id])}
                  >
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Add manual group actions**

Extend `ActiveWorkspace.tsx` with two local actions:

```tsx
  async function createManualGroupForTab(tab: ActiveBrowserTab) {
    if (!workspace || typeof tab.id !== 'number') return;
    const name = window.prompt('Group name');
    if (!name) return;
    const created = addManualGroup(workspace.manualGroups, name);
    const manualGroups = assignTabToManualGroup(created.state, tab.id, created.group.id);
    setWorkspace(await updateActiveWorkspaceState({ manualGroups }));
  }

  async function removeTabFromManualGroup(tab: ActiveBrowserTab) {
    if (!workspace || typeof tab.id !== 'number') return;
    setWorkspace(await updateActiveWorkspaceState({
      manualGroups: clearTabManualGroup(workspace.manualGroups, tab.id),
    }));
  }
```

Add row buttons:

```tsx
<button type="button" className="icon-button" aria-label="Move to manual group" onClick={() => void createManualGroupForTab(tab)}>
  <Archive size={14} aria-hidden="true" />
</button>
{group.kind === 'manual' && (
  <button type="button" className="icon-button" aria-label="Move to domain group" onClick={() => void removeTabFromManualGroup(tab)}>
    <X size={14} aria-hidden="true" />
  </button>
)}
```

- [ ] **Step 4: Render active workspace in App**

Modify `App.tsx`:

```tsx
import { ActiveWorkspace } from './components/ActiveWorkspace';
```

Render it above stowed sessions:

```tsx
<ActiveWorkspace onStatus={(tone, message) => setStatus({ tone, message })} />
```

- [ ] **Step 5: Add active workspace CSS**

Add to `styles.css`:

```css
.active-workspace,
.stowed-sessions {
  display: grid;
  gap: 16px;
}

.group-nav {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding-bottom: 4px;
}

.group-nav button,
.active-tab-row,
.active-group {
  border: 1px solid var(--border, #d7dde6);
  border-radius: 8px;
}

.group-nav button {
  align-items: center;
  background: var(--surface, #ffffff);
  color: inherit;
  display: flex;
  gap: 8px;
  min-height: 36px;
  padding: 0 10px;
}

.active-group-list {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
}

.active-group {
  background: var(--surface, #ffffff);
  display: grid;
  gap: 10px;
  padding: 12px;
}

.active-group header,
.active-tab-row {
  align-items: center;
  display: flex;
  justify-content: space-between;
}

.active-tab-row {
  gap: 8px;
  min-height: 40px;
  padding: 6px;
}

.active-tab-row button:first-child {
  align-items: center;
  background: transparent;
  border: 0;
  color: inherit;
  display: flex;
  flex: 1;
  gap: 8px;
  min-width: 0;
  text-align: left;
}

.active-tab-row span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

- [ ] **Step 6: Run task verification**

Run:

```bash
bun --cwd apps/extension run typecheck
bun --cwd apps/extension run test -- src/features/active-tabs/active-tab-groups.test.ts src/features/active-tabs/manual-groups.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/extension/src/entrypoints/newtab/App.tsx apps/extension/src/entrypoints/newtab/components/ActiveWorkspace.tsx apps/extension/src/entrypoints/newtab/components/GroupNav.tsx apps/extension/src/entrypoints/newtab/styles.css
git commit -m "feat(newtab): add active tabs workspace"
```

---

### Task 11: Chrome Group Controls In UI

**Files:**
- Modify: `apps/extension/src/entrypoints/newtab/components/ActiveWorkspace.tsx`
- Modify: `apps/extension/src/entrypoints/newtab/styles.css`

**Interfaces:**
- Consumes: `chrome-tab-groups:sync`
- Consumes: `chrome-tab-groups:collapse-window`
- Consumes: `updateActiveWorkspaceState`
- Produces: UI toggle for native Chrome tab groups

- [ ] **Step 1: Add sync action**

In `ActiveWorkspace.tsx`, add:

```tsx
  async function toggleChromeTabGroups() {
    if (!workspace) return;
    const nextState = {
      ...workspace.chromeTabGroups,
      enabled: !workspace.chromeTabGroups.enabled,
    };
    const response = await sendExtensionMessage<AppResult<ActiveWorkspaceState['chromeTabGroups']>>({
      type: 'chrome-tab-groups:sync',
      groups,
      state: nextState,
    });
    if (response.ok) {
      setWorkspace(await updateActiveWorkspaceState({ chromeTabGroups: response.data }));
      onStatus('success', response.data.enabled ? 'Chrome tab groups enabled.' : 'Chrome tab groups disabled.');
      return;
    }
    onStatus('error', response.error.message);
  }
```

- [ ] **Step 2: Add import action**

In `ActiveWorkspace.tsx`, add:

```tsx
  async function importExistingChromeGroups() {
    if (!workspace) return;
    const response = await sendExtensionMessage<AppResult<{
      manualGroups: ActiveWorkspaceState['manualGroups'];
      chromeTabGroups: ActiveWorkspaceState['chromeTabGroups'];
    }>>({
      type: 'chrome-tab-groups:import',
      tabs,
      manualGroups: workspace.manualGroups,
      state: workspace.chromeTabGroups,
    });
    if (response.ok) {
      setWorkspace(await updateActiveWorkspaceState({
        manualGroups: response.data.manualGroups,
        chromeTabGroups: response.data.chromeTabGroups,
      }));
      onStatus('success', 'Imported Chrome tab groups.');
      return;
    }
    onStatus('error', response.error.message);
  }
```

- [ ] **Step 3: Add collapse action**

In `ActiveWorkspace.tsx`, add:

```tsx
  async function collapseCurrentWindowGroups() {
    const windowId = tabs.find((tab) => tab.active && typeof tab.windowId === 'number')?.windowId
      ?? tabs.find((tab) => typeof tab.windowId === 'number')?.windowId;
    if (typeof windowId !== 'number') return;

    const response = await sendExtensionMessage<AppResult<{ collapsed: true; groupCount: number }>>({
      type: 'chrome-tab-groups:collapse-window',
      windowId,
    });
    if (response.ok) {
      onStatus('success', `Collapsed ${response.data.groupCount} Chrome groups.`);
      return;
    }
    onStatus('error', response.error.message);
  }
```

- [ ] **Step 4: Render controls**

Render controls below the active workspace header:

```tsx
<div className="active-workspace-controls">
  <label className="toggle-row">
    <input
      checked={Boolean(workspace?.chromeTabGroups.enabled)}
      onChange={() => void toggleChromeTabGroups()}
      type="checkbox"
    />
    <span>Sync manual groups to Chrome tab groups</span>
  </label>
  <button type="button" className="secondary-button" onClick={() => void collapseCurrentWindowGroups()}>
    <Layers size={16} aria-hidden="true" />
    Collapse Chrome groups
  </button>
  <button type="button" className="secondary-button" onClick={() => void importExistingChromeGroups()}>
    <Layers size={16} aria-hidden="true" />
    Import Chrome groups
  </button>
</div>
```

- [ ] **Step 5: Add CSS**

Add:

```css
.active-workspace-controls,
.toggle-row {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.toggle-row {
  font-size: 0.92rem;
}
```

- [ ] **Step 6: Run verification**

Run:

```bash
bun --cwd apps/extension run typecheck
bun --cwd apps/extension run test -- src/features/chrome-tab-groups/chrome-tab-groups.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/extension/src/entrypoints/newtab/components/ActiveWorkspace.tsx apps/extension/src/entrypoints/newtab/styles.css
git commit -m "feat(tab-groups): add dashboard chrome group controls"
```

---

### Task 12: Quick Links, Todos, Theme, And Language UI

**Files:**
- Create: `apps/extension/src/entrypoints/newtab/components/QuickLinks.tsx`
- Create: `apps/extension/src/entrypoints/newtab/components/TodosPanel.tsx`
- Create: `apps/extension/src/entrypoints/newtab/components/ThemeControls.tsx`
- Modify: `apps/extension/src/entrypoints/newtab/App.tsx`
- Modify: `apps/extension/src/entrypoints/newtab/styles.css`

**Interfaces:**
- Consumes: quick link, todo, theme, and localization helpers from Tasks 6-8
- Produces: utility panels integrated into new tab dashboard

- [ ] **Step 1: Create QuickLinks component**

Create `apps/extension/src/entrypoints/newtab/components/QuickLinks.tsx`:

```tsx
import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { getTabLabel } from '@/features/active-tabs/tab-labels';
import type { ActiveBrowserTab } from '@/features/active-tabs/types';
import { createQuickLink, type QuickLink } from '@/features/quick-links/quick-links';
import { getQuickLinks, saveQuickLinks } from '@/features/quick-links/quick-links-storage';
import type { AppResult } from '@/lib/errors';
import { sendExtensionMessage } from '@/lib/messages';

export function QuickLinks() {
  const [links, setLinks] = useState<QuickLink[]>([]);

  async function load() {
    setLinks(await getQuickLinks());
  }

  useEffect(() => {
    void load();
  }, []);

  async function addByUrl() {
    const url = window.prompt('Quick link URL');
    if (!url) return;
    const label = window.prompt('Quick link label') ?? '';
    setLinks(await saveQuickLinks([...links, createQuickLink({ url, label })]));
  }

  async function addFromOpenTabs() {
    const response = await sendExtensionMessage<AppResult<ActiveBrowserTab[]>>({ type: 'active-tabs:list' });
    if (!response.ok) return;
    const choices = response.data
      .filter((tab) => tab.url)
      .map((tab, index) => ({ index: index + 1, tab }));
    const menu = choices.map((choice) => `${choice.index}. ${getTabLabel(choice.tab)}`).join('\n');
    const selected = Number(window.prompt(`Choose an open tab:\n${menu}`));
    const tab = choices.find((choice) => choice.index === selected)?.tab;
    if (!tab?.url) return;
    setLinks(await saveQuickLinks([...links, createQuickLink({ url: tab.url, label: getTabLabel(tab) })]));
  }

  async function remove(id: string) {
    setLinks(await saveQuickLinks(links.filter((link) => link.id !== id)));
  }

  return (
    <section className="utility-panel" aria-labelledby="quick-links-title">
      <header>
        <h2 id="quick-links-title">Quick links</h2>
        <button type="button" className="icon-button" aria-label="Add quick link" onClick={() => void addByUrl()}>
          <Plus size={16} aria-hidden="true" />
        </button>
        <button type="button" className="secondary-button" onClick={() => void addFromOpenTabs()}>
          Add open tab
        </button>
      </header>
      <div className="quick-link-grid">
        {links.map((link) => (
          <div className="quick-link" key={link.id}>
            <a href={link.url}>{link.label}</a>
            <button type="button" className="icon-button" aria-label={`Remove ${link.label}`} onClick={() => void remove(link.id)}>
              <Trash2 size={14} aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Create TodosPanel component**

Create `apps/extension/src/entrypoints/newtab/components/TodosPanel.tsx`:

```tsx
import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { clearCompletedTodos, completeTodo, createTodo, dismissTodo, reorderTodos, searchTodos, type TodoItem } from '@/features/todos/todos';
import { getTodos, saveTodos } from '@/features/todos/todos-storage';

export function TodosPanel() {
  const [query, setQuery] = useState('');
  const [todos, setTodos] = useState<TodoItem[]>([]);

  async function load() {
    setTodos(await getTodos());
  }

  useEffect(() => {
    void load();
  }, []);

  const visibleTodos = useMemo(() => searchTodos(todos, query).filter((todo) => !todo.dismissed), [todos, query]);

  async function addTodo() {
    const title = window.prompt('Todo title');
    if (!title) return;
    const description = window.prompt('Todo details') ?? '';
    setTodos(await saveTodos(createTodo(todos, { title, description })));
  }

  async function moveTodo(id: string, direction: -1 | 1) {
    const visibleIds = visibleTodos.map((todo) => todo.id);
    const index = visibleIds.indexOf(id);
    const nextIndex = index + direction;
    if (index === -1 || nextIndex < 0 || nextIndex >= visibleIds.length) return;
    const nextIds = [...visibleIds];
    [nextIds[index], nextIds[nextIndex]] = [nextIds[nextIndex], nextIds[index]];
    setTodos(await saveTodos(reorderTodos(todos, nextIds)));
  }

  return (
    <section className="utility-panel" aria-labelledby="todos-title">
      <header>
        <h2 id="todos-title">Todos</h2>
        <button type="button" className="icon-button" aria-label="Add todo" onClick={() => void addTodo()}>
          <Plus size={16} aria-hidden="true" />
        </button>
      </header>
      <input aria-label="Search todos" type="search" value={query} onChange={(event) => setQuery(event.target.value)} />
      <div className="todo-list">
        {visibleTodos.map((todo) => (
          <div className="todo-row" key={todo.id}>
            <label>
              <input
                checked={todo.completed}
                onChange={() => void saveTodos(completeTodo(todos, todo.id)).then(setTodos)}
                type="checkbox"
              />
              <span>{todo.title}</span>
            </label>
            <button type="button" className="icon-button" aria-label={`Delete ${todo.title}`} onClick={() => void saveTodos(dismissTodo(todos, todo.id)).then(setTodos)}>
              <Trash2 size={14} aria-hidden="true" />
            </button>
            <button type="button" className="secondary-button" onClick={() => void moveTodo(todo.id, -1)}>Up</button>
            <button type="button" className="secondary-button" onClick={() => void moveTodo(todo.id, 1)}>Down</button>
          </div>
        ))}
      </div>
      <button type="button" className="secondary-button" onClick={() => void saveTodos(clearCompletedTodos(todos)).then(setTodos)}>
        Clear completed
      </button>
    </section>
  );
}
```

- [ ] **Step 3: Create ThemeControls component**

Create `apps/extension/src/entrypoints/newtab/components/ThemeControls.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { getLanguagePreference, saveLanguagePreference, type LanguagePreference } from '@/features/i18n/i18n';
import { getThemePreferences, saveThemePreferences, type ThemePreferences } from '@/features/theme/theme-preferences';

export function ThemeControls() {
  const [language, setLanguage] = useState<LanguagePreference>('auto');
  const [theme, setTheme] = useState<ThemePreferences | null>(null);

  useEffect(() => {
    void Promise.all([getThemePreferences(), getLanguagePreference()]).then(([themePreferences, languagePreference]) => {
      setTheme(themePreferences);
      setLanguage(languagePreference);
    });
  }, []);

  async function updateTheme(partial: Partial<ThemePreferences>) {
    const next = await saveThemePreferences({ ...(theme ?? {}), ...partial });
    setTheme(next);
    document.documentElement.dataset.themeMode = next.mode;
    document.documentElement.dataset.themePalette = next.paletteId;
    document.documentElement.style.setProperty('--surface-opacity', `${next.surfaceOpacity / 100}`);
  }

  async function updateLanguage(nextLanguage: LanguagePreference) {
    setLanguage(await saveLanguagePreference(nextLanguage));
  }

  async function updateBackground(file: File | undefined) {
    if (!file) return;
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener('load', () => resolve(String(reader.result ?? '')));
      reader.addEventListener('error', () => reject(new Error('Could not read background image.')));
      reader.readAsDataURL(file);
    });
    await updateTheme({ customBackground: dataUrl });
  }

  if (!theme) return null;

  return (
    <section className="utility-panel compact-controls" aria-label="Appearance">
      <select aria-label="Theme mode" value={theme.mode} onChange={(event) => void updateTheme({ mode: event.target.value as ThemePreferences['mode'] })}>
        <option value="system">System</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
      <select aria-label="Palette" value={theme.paletteId} onChange={(event) => void updateTheme({ paletteId: event.target.value as ThemePreferences['paletteId'] })}>
        <option value="paper">Paper</option>
        <option value="sage">Sage</option>
        <option value="mist">Mist</option>
        <option value="blush">Blush</option>
      </select>
      <input
        aria-label="Surface transparency"
        max={100}
        min={35}
        onChange={(event) => void updateTheme({ surfaceOpacity: Number(event.target.value) })}
        type="range"
        value={theme.surfaceOpacity}
      />
      <select aria-label="Language" value={language} onChange={(event) => void updateLanguage(event.target.value as LanguagePreference)}>
        <option value="auto">Auto</option>
        <option value="en">English</option>
        <option value="zh-CN">简体中文</option>
      </select>
      <input
        accept="image/*"
        aria-label="Custom background"
        onChange={(event) => void updateBackground(event.target.files?.[0])}
        type="file"
      />
    </section>
  );
}
```

- [ ] **Step 4: Render utility components**

Modify `App.tsx`:

```tsx
import { QuickLinks } from './components/QuickLinks';
import { ThemeControls } from './components/ThemeControls';
import { TodosPanel } from './components/TodosPanel';
```

Add:

```tsx
<section className="utility-grid" aria-label="Utilities">
  <QuickLinks />
  <TodosPanel />
  <ThemeControls />
</section>
```

- [ ] **Step 5: Add CSS**

Add:

```css
.utility-grid {
  display: grid;
  gap: 16px;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
}

.utility-panel {
  background: var(--surface, #ffffff);
  border: 1px solid var(--border, #d7dde6);
  border-radius: 8px;
  display: grid;
  gap: 12px;
  padding: 14px;
}

.utility-panel header,
.quick-link,
.todo-row,
.todo-row label {
  align-items: center;
  display: flex;
  gap: 8px;
}

.utility-panel header,
.quick-link,
.todo-row {
  justify-content: space-between;
}

.quick-link-grid,
.todo-list,
.compact-controls {
  display: grid;
  gap: 8px;
}
```

- [ ] **Step 6: Run task verification**

Run:

```bash
bun --cwd apps/extension run typecheck
bun --cwd apps/extension run test -- src/features/quick-links/quick-links.test.ts src/features/todos/todos.test.ts src/features/theme/theme-preferences.test.ts src/features/i18n/i18n.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/extension/src/entrypoints/newtab/App.tsx apps/extension/src/entrypoints/newtab/components/QuickLinks.tsx apps/extension/src/entrypoints/newtab/components/TodosPanel.tsx apps/extension/src/entrypoints/newtab/components/ThemeControls.tsx apps/extension/src/entrypoints/newtab/styles.css
git commit -m "feat(newtab): add utility panels"
```

---

### Task 13: Final Styling, Documentation, And Full Verification

**Files:**
- Modify: `apps/extension/src/entrypoints/newtab/styles.css`
- Modify: `README.md`

**Interfaces:**
- Consumes: all prior tasks
- Produces: verified build and updated manual QA notes

- [ ] **Step 1: Finish responsive dashboard styling**

Revise `styles.css` so the final screen keeps these stable regions:

```css
.newtab-shell {
  color: var(--ink, #17202a);
  margin: 0 auto;
  max-width: 1320px;
  min-height: 100vh;
  padding: clamp(16px, 3vw, 32px);
}

.dashboard-shell {
  grid-template-areas:
    "topbar topbar"
    "active active"
    "utilities stowed";
  grid-template-columns: minmax(0, 0.9fr) minmax(320px, 1.1fr);
}

.dashboard-topbar {
  grid-area: topbar;
}

.active-workspace {
  grid-area: active;
}

.utility-grid {
  grid-area: utilities;
}

.stowed-sessions {
  grid-area: stowed;
}

@media (max-width: 980px) {
  .dashboard-shell {
    grid-template-areas:
      "topbar"
      "active"
      "utilities"
      "stowed";
    grid-template-columns: 1fr;
  }
}
```

Keep cards at `8px` border radius or less.

- [ ] **Step 2: Update README manual QA**

Modify `README.md` manual QA list to include:

```markdown
- Click the extension toolbar icon and confirm the current window's eligible tabs are stowed and no popup opens.
- Confirm active tabs group by domain and homepage-style tabs appear in the Homepages group.
- Create a manual group from an active tab and move the tab back to its domain group.
- Enable Chrome tab-group sync and confirm manual groups become native Chrome tab groups.
- Collapse Chrome tab groups from the dashboard.
- Close one tab, close a group, and close duplicates.
- Add and open a quick link.
- Create, complete, search, and clear todos.
- Change theme mode, palette, transparency, and language preference.
- Run dashboard search with the default search provider.
- Push and pull Gist sync and confirm only stowed sessions sync.
```

- [ ] **Step 3: Run full automated verification**

Run:

```bash
bun run test
bun run typecheck
bun run build
```

Expected: all commands exit successfully.

- [ ] **Step 4: Inspect generated manifest**

Run:

```bash
rtk sed -n '1,220p' apps/extension/.output/chrome-mv3/manifest.json
```

Expected:

- `action` has `default_title`.
- `action` does not have `default_popup`.
- `permissions` contains `tabs`, `storage`, `contextMenus`, `tabGroups`, and `search`.
- `permissions` does not contain `clipboardRead`.

- [ ] **Step 5: Commit**

```bash
git add apps/extension/src/entrypoints/newtab/styles.css README.md
git commit -m "docs(readme): add tab harbor migration qa"
```

---

## Final Review Checklist

- [ ] `bun run test` passes.
- [ ] `bun run typecheck` passes.
- [ ] `bun run build` passes.
- [ ] Toolbar icon stows the current window and opens no popup.
- [ ] Stowed sessions still restore, delete, push, and pull through Gist.
- [ ] Active tabs are local-only.
- [ ] Quick links, todos, theme, and language preferences are local-only.
- [ ] `tabGroups` and `search` are present.
- [ ] `clipboardRead` is absent.
- [ ] No content scripts were added.
- [ ] No direct Tab Harbor plain JavaScript runtime was copied into Tabstow.
