# Saved Tabs History, Deduplication, And Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add globally deduplicated Saved for later sessions, recoverable History behavior, persistent saved drag-and-drop, shared tab search, and real favicons while removing redundant Active tabs controls.

**Architecture:** Extend the existing core session model with deterministic URL deduplication and explicit ordering, then upgrade the Dexie database to store local-only History and expose atomic Saved/History mutations. Keep all persistence and Chrome tab creation behind typed background messages; the new-tab and History entrypoints consume those operations through focused components and pure filtering/drag helpers.

**Tech Stack:** TypeScript, React, WXT Manifest V3, Chrome Extensions APIs, Dexie/IndexedDB, Zod, Vitest/jsdom, Bun.

## Global Constraints

- Use Bun for package management and scripts in this repository. Do not use pnpm, npm, npx, or yarn commands.
- Chrome extension runtime code must not use Bun-only or Node-only APIs.
- Keep Manifest V3 permissions minimal; do not add content scripts, eval, `new Function`, remote executable code, CDN scripts, or broad host permissions.
- Store durable sessions and History in IndexedDB; History is local-only and must not enter the Gist sync document.
- Primary and middle clicks must open background Chrome tabs and leave the Tabstow extension page active.
- Saved delete actions are recoverable; only History performs permanent deletion.
- Disable Saved drag-and-drop while local tab search is active.
- Preserve the existing topbar web search as a separate feature.
- Commit messages use `type(scope): msg`.

---

## File Structure

### Core session rules

- Modify `packages/core/src/schemas.ts` — backward-compatible optional persisted `sortOrder`.
- Modify `packages/core/src/tab-session.ts` — URL normalization, deterministic URL deduplication, and saved ordering helpers.
- Modify `packages/core/src/tab-session.test.ts` and `packages/core/src/schemas.test.ts` — core contracts.

### Durable Saved and History state

- Create `apps/extension/src/features/history/types.ts` — local-only History types.
- Modify `apps/extension/src/db/db.ts` — IndexedDB v2 migration and atomic Saved/History operations.
- Create `apps/extension/src/db/db.test.ts` — migration, deduplication, ordering, move, restore, and delete tests.
- Modify `apps/extension/package.json` and `bun.lock` — add `fake-indexeddb` for real Dexie tests.

### Chrome/background behavior

- Modify `apps/extension/src/features/tabs/session-service.ts` and `.test.ts` — consuming/non-consuming opens and restore-all safety.
- Modify `apps/extension/src/lib/messages.ts` and `.test.ts` — typed Saved/History/reorder messages.
- Modify `apps/extension/src/entrypoints/background.ts` and `apps/extension/src/tests/background.test.ts` — route high-level operations.
- Modify `apps/extension/src/features/sync/sync-service.ts` and `.test.ts` — deduplicate merged sessions on push and pull.

### Shared UI behavior

- Create `apps/extension/src/components/TabFavicon.tsx` and `.test.tsx` — saved/active/history favicon cascade.
- Modify `apps/extension/src/entrypoints/newtab/components/ActiveWindowSection.tsx` — render shared favicon.
- Modify `apps/extension/src/entrypoints/newtab/components/ActiveWorkspace.tsx` — remove redundant controls and apply local filtering.
- Create `apps/extension/src/features/tab-search/tab-search.ts` and `.test.ts` — pure Active/Saved filtering.
- Create `apps/extension/src/entrypoints/newtab/components/WorkspaceSearch.tsx` — local search and History link.
- Modify `apps/extension/src/entrypoints/newtab/App.tsx` — own query and wrap the two panels.
- Create `apps/extension/src/entrypoints/newtab/components/saved-tabs-dnd.ts` and `.test.ts` — Saved-only drag payload and drop request.
- Modify `apps/extension/src/entrypoints/newtab/components/StowedSessions.tsx` — click semantics, recoverable delete, and drag UI.
- Modify `apps/extension/src/entrypoints/newtab/App.test.tsx` and `styles.css` — interaction and layout coverage.

### History entrypoint

- Create `apps/extension/src/entrypoints/saved-history/index.html`.
- Create `apps/extension/src/entrypoints/saved-history/main.tsx`.
- Create `apps/extension/src/entrypoints/saved-history/HistoryApp.tsx` and `.test.tsx`.
- Create `apps/extension/src/entrypoints/saved-history/styles.css`.
- Create `apps/extension/scripts/verify-built-extension.ts` — reject generated native History overrides, content scripts, permission drift, and reserved output names.
- Modify `apps/extension/package.json` and `tsconfig.json` — run and typecheck built-output verification.
- Modify `apps/extension/src/tests/manifest.test.ts` — verify the packaged History page is extension-local and permissions remain unchanged.

---

### Task 1: Core Saved URL Identity And Ordering

**Files:**
- Modify: `packages/core/src/schemas.ts`
- Modify: `packages/core/src/tab-session.ts`
- Modify: `packages/core/src/tab-session.test.ts`
- Modify: `packages/core/src/schemas.test.ts`

**Interfaces:**
- Produces: `normalizeSavedTabUrl(url: string): string | null`
- Produces: `deduplicateIncomingTabs(tabs: SavedTab[]): SavedTab[]`
- Produces: `deduplicateSessionsByUrl(sessions: TabSession[]): TabSession[]`
- Produces: `sortSessionsForDisplay(sessions: TabSession[]): TabSession[]`
- Changes: `TabSession.sortOrder?: number`

- [ ] **Step 1: Write failing core tests for normalization and newest-copy-wins deduplication**

Add focused cases to `packages/core/src/tab-session.test.ts` using concrete sessions:

```ts
import {
  deduplicateSessionsByUrl,
  deduplicateIncomingTabs,
  normalizeSavedTabUrl,
  sortSessionsForDisplay,
} from './tab-session';

it('normalizes URL identity without collapsing distinct queries', () => {
  expect(normalizeSavedTabUrl('HTTPS://Example.COM:443/a?x=1#first')).toBe(
    'https://example.com/a?x=1',
  );
  expect(normalizeSavedTabUrl('https://example.com/a?x=2')).toBe(
    'https://example.com/a?x=2',
  );
  expect(normalizeSavedTabUrl('not a url')).toBeNull();
});

it('keeps the newest saved copy and removes emptied sessions', () => {
  const older = session('older', '2026-07-10T00:00:00.000Z', [
    tab('old-copy', 'https://example.com/read#old', '2026-07-10T00:00:00.000Z'),
  ]);
  const newer = session('newer', '2026-07-11T00:00:00.000Z', [
    tab('new-copy', 'https://example.com/read#new', '2026-07-11T00:00:00.000Z'),
  ]);

  expect(deduplicateSessionsByUrl([older, newer])).toEqual([newer]);
});

it('keeps the last duplicate in one incoming save batch', () => {
  expect(
    deduplicateIncomingTabs([
      tab('first', 'https://example.com/read#one', '2026-07-11T00:00:00.000Z'),
      tab('last', 'https://example.com/read#two', '2026-07-11T00:00:00.000Z'),
    ]).map(({ id }) => id),
  ).toEqual(['last']);
});

it('sorts explicit session order before the created-at fallback', () => {
  expect(
    sortSessionsForDisplay([
      { ...baseSession, id: 'second', sortOrder: 1 },
      { ...baseSession, id: 'first', sortOrder: 0 },
    ]).map(({ id }) => id),
  ).toEqual(['first', 'second']);
});
```

Also add a schema case proving a v1 session without `sortOrder` still parses and a v2 session with a nonnegative integer order parses.

- [ ] **Step 2: Run the tests and verify the new imports/field fail**

Run: `bun run test --cwd packages/core -- src/tab-session.test.ts src/schemas.test.ts`

Expected: FAIL because the four helpers and `sortOrder` do not exist.

- [ ] **Step 3: Implement the minimal core rules**

Add this field to `tabSessionSchema`:

```ts
sortOrder: z.number().int().nonnegative().optional(),
```

Implement the exported helpers in `tab-session.ts`. The dedupe traversal must rank sessions by `updatedAt`, then tabs by `createdAt`, then stable IDs; it must preserve tab array order for surviving tabs and return no empty sessions:

```ts
export function normalizeSavedTabUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return null;
  }
}

export function sortSessionsForDisplay(sessions: TabSession[]): TabSession[] {
  return [...sessions].sort((a, b) => {
    if (a.sortOrder != null && b.sortOrder != null) return a.sortOrder - b.sortOrder;
    if (a.sortOrder != null) return -1;
    if (b.sortOrder != null) return 1;
    return b.createdAt.localeCompare(a.createdAt);
  });
}
```

Implement `deduplicateIncomingTabs` by scanning from the end, keeping the first unseen normalized key, then restoring winner order. Implement `deduplicateSessionsByUrl` with a `Map<string, { sessionId; tabId }>` of ranked winners, filter each session to winner tabs, then call `sortSessionsForDisplay`.

- [ ] **Step 4: Run core tests**

Run: `bun run test --cwd packages/core -- src/tab-session.test.ts src/schemas.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/schemas.ts packages/core/src/tab-session.ts packages/core/src/tab-session.test.ts packages/core/src/schemas.test.ts
git commit -m "feat(core): add saved tab deduplication"
```

### Task 2: IndexedDB V2 Migration And Ordered Deduplicated Sessions

**Files:**
- Modify: `apps/extension/package.json`
- Modify: `bun.lock`
- Modify: `apps/extension/src/db/db.ts`
- Create: `apps/extension/src/db/db.test.ts`

**Interfaces:**
- Consumes: `deduplicateIncomingTabs`, `deduplicateSessionsByUrl`, `sortSessionsForDisplay`
- Changes: `createSession(session: TabSession): Promise<TabSession>` now inserts the newest globally deduplicated session.
- Produces: `reorderSessions(orderedIds: string[]): Promise<TabSession[]>`
- Changes: `importSessions` replaces the authoritative merged set after deduplication instead of only `bulkPut`-ing it.

- [ ] **Step 1: Add the IndexedDB test runtime**

Run: `bun add --dev fake-indexeddb --cwd apps/extension`

Expected: `apps/extension/package.json` and `bun.lock` include `fake-indexeddb`; no runtime dependency is added.

- [ ] **Step 2: Write failing real-Dexie tests**

Create `db.test.ts` with `import 'fake-indexeddb/auto'`, delete the `tabstow` database before each test, and dynamically import/reset the database module. Cover:

```ts
it('migrates existing sessions to explicit display order', async () => {
  await seedVersionOne([newerSession, olderSession]);
  const { listSessions } = await import('./db');
  expect((await listSessions()).map(({ id, sortOrder }) => [id, sortOrder])).toEqual([
    ['newer', 0],
    ['older', 1],
  ]);
});

it('deduplicates old sessions when saving a newest copy', async () => {
  const { createSession, listSessions } = await import('./db');
  await createSession(oldSessionWithHashedUrl);
  await createSession(newSessionWithSameNormalizedUrl);
  expect((await listSessions()).map(({ id }) => id)).toEqual(['new']);
});

it('persists explicit session reorder', async () => {
  const { createSession, reorderSessions, listSessions } = await import('./db');
  await createSession(first);
  await createSession(second);
  await reorderSessions(['first', 'second']);
  expect((await listSessions()).map(({ id }) => id)).toEqual(['first', 'second']);
});

it('replaces stale rows when importing a deduplicated merged set', async () => {
  const { createSession, importSessions, listSessions } = await import('./db');
  await createSession(stale);
  await importSessions([replacement]);
  expect((await listSessions()).map(({ id }) => id)).toEqual(['replacement']);
});
```

- [ ] **Step 3: Run the DB tests and verify they fail on the v1 schema/APIs**

Run: `bun run test --cwd apps/extension -- src/db/db.test.ts`

Expected: FAIL because v2 migration, deterministic create dedupe, and reorder do not exist.

- [ ] **Step 4: Implement database version 2 and ordered session helpers**

Keep version 1 unchanged, then add:

```ts
this.version(2)
  .stores({
    sessions: 'id, createdAt, updatedAt, deviceId, sortOrder',
    history: 'id, movedAt, sourceSessionId, reason',
  })
  .upgrade(async (transaction) => {
    const table = transaction.table<TabSession, string>('sessions');
    const sessions = sortSessionsNewestFirst(await table.toArray());
    await table.bulkPut(sessions.map((session, sortOrder) => ({ ...session, sortOrder })));
  });
```

Make `createSession` batch-deduplicate `parsed.tabs`, then call a transaction helper that loads all sessions, removes every existing tab with an incoming normalized URL, drops emptied sessions, inserts `{ ...parsed, tabs: uniqueIncomingTabs, sortOrder: 0 }`, and resequences survivors to `1..n`. Implement reorder by validating that `orderedIds` contains every current session ID exactly once, then rewriting only `sortOrder`. Make `importSessions` deduplicate, resequence, clear, and replace within one transaction.

- [ ] **Step 5: Run DB and full core/extension unit tests**

Run: `bun run test --cwd apps/extension -- src/db/db.test.ts`

Expected: PASS.

Run: `bun run test`

Expected: PASS after updating only fixture assertions whose session objects now contain `sortOrder`.

- [ ] **Step 6: Commit**

```bash
git add apps/extension/package.json bun.lock apps/extension/src/db/db.ts apps/extension/src/db/db.test.ts
git commit -m "feat(storage): deduplicate and order saved sessions"
```

### Task 3: Local History And Atomic Saved Mutations

**Files:**
- Create: `apps/extension/src/features/history/types.ts`
- Modify: `apps/extension/src/db/db.ts`
- Modify: `apps/extension/src/db/db.test.ts`

**Interfaces:**
- Produces: `HistoryReason = 'opened' | 'restored' | 'deleted'`
- Produces: `HistoryEntry`
- Produces: `listHistory`, `getHistoryEntry`, `moveSavedTabToHistory`, `moveSessionToHistory`, `restoreHistoryEntry`, `deleteHistoryEntry`, `moveSavedTab`
- Produces request: `{ sourceSessionId; tabId; destinationSessionId; destinationIndex }`

- [ ] **Step 1: Write failing transaction tests**

Add separate tests proving:

```ts
const moved = await moveSavedTabToHistory('source', 'tab-1', 'opened');
expect(moved.tabs.map(({ id }) => id)).toEqual(['tab-1']);
expect((await getSession('source'))?.tabs.map(({ id }) => id)).toEqual(['tab-2']);
expect((await listHistory()).map(({ id }) => id)).toEqual([moved.id]);

await moveSessionToHistory('source', 'deleted');
expect(await getSession('source')).toBeUndefined();
expect((await listHistory())[0]?.reason).toBe('deleted');

const restored = await restoreHistoryEntry(historyId);
expect(restored.tabs.map(({ url }) => url)).toEqual(['https://example.com/read']);
expect(await getHistoryEntry(historyId)).toBeUndefined();

await moveSavedTab({
  sourceSessionId: 'source',
  tabId: 'tab-2',
  destinationSessionId: 'destination',
  destinationIndex: 1,
});
expect((await getSession('destination'))?.tabs.map(({ id }) => id)).toEqual([
  'destination-tab',
  'tab-2',
]);
```

Also test: the source session is deleted when emptied; a transaction abort leaves both tables unchanged; restore deduplicates existing Saved URLs; permanent delete affects only History; same-session reorder preserves exact requested order.

- [ ] **Step 2: Run and verify RED**

Run: `bun run test --cwd apps/extension -- src/db/db.test.ts`

Expected: FAIL on missing History types/table accessors and move functions.

- [ ] **Step 3: Implement History types**

Create:

```ts
import type { SavedTab } from '@tabstow/core';

export type HistoryReason = 'opened' | 'restored' | 'deleted';

export type HistoryEntry = {
  id: string;
  sourceSessionId: string;
  sourceTitle: string;
  tabs: SavedTab[];
  originalCreatedAt: string;
  movedAt: string;
  reason: HistoryReason;
  deviceId: string;
};

export type MoveSavedTabRequest = {
  sourceSessionId: string;
  tabId: string;
  destinationSessionId: string;
  destinationIndex: number;
};
```

- [ ] **Step 4: Implement atomic History and move operations**

Add `history!: Table<HistoryEntry, string>` to `TabstowDatabase`. Each operation must use `db.transaction('rw', db.sessions, db.history, async () => ...)`, throw typed `Error` messages for missing IDs/invalid destination indexes, and update `updatedAt` on every modified session. Build History entries from the source session with `crypto.randomUUID()` and `new Date().toISOString()`.

`restoreHistoryEntry` must insert one new session with a new session ID, original title/tabs, `createdAt` and `updatedAt` set to restore time, `sortOrder: 0`, then run the same dedupe/resequence helper before deleting History.

- [ ] **Step 5: Run tests**

Run: `bun run test --cwd apps/extension -- src/db/db.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/extension/src/features/history/types.ts apps/extension/src/db/db.ts apps/extension/src/db/db.test.ts
git commit -m "feat(history): add local saved tab recycle bin"
```

### Task 4: Chrome Tab Open/Consume Services And Typed Background Messages

**Files:**
- Modify: `apps/extension/src/features/tabs/session-service.ts`
- Modify: `apps/extension/src/features/tabs/session-service.test.ts`
- Modify: `apps/extension/src/lib/messages.ts`
- Modify: `apps/extension/src/lib/messages.test.ts`
- Modify: `apps/extension/src/lib/errors.ts`
- Modify: `apps/extension/src/entrypoints/background.ts`
- Modify: `apps/extension/src/tests/background.test.ts`
- Modify: `apps/extension/src/entrypoints/newtab/components/StowedSessions.tsx`

**Interfaces:**
- Produces: `openSavedTab(sessionId, tabId, consume): Promise<AppResult<{ opened: true; consumed: boolean }>>`
- Changes: `restoreSession(sessionId)` opens every tab in the background and consumes to History only after all creates succeed.
- Message additions: `sessions:open-tab`, `sessions:delete-tab`, `sessions:reorder`, `sessions:move-tab`, `history:list`, `history:open-tab`, `history:restore`, `history:delete`.

- [ ] **Step 1: Write failing service tests for primary, middle, restore-all, and partial failure**

Extend DB mocks with the new operations and add:

```ts
it('opens a saved tab in the background before consuming it', async () => {
  dbMocks.getSession.mockResolvedValue(sessionWithTwoTabs);
  browserMocks.tabs.create.mockResolvedValue({ id: 91 });
  dbMocks.moveSavedTabToHistory.mockResolvedValue(historyEntry);

  await expect(openSavedTab('session-1', 'tab-1', true)).resolves.toEqual({
    ok: true,
    data: { opened: true, consumed: true },
  });
  expect(browserMocks.tabs.create).toHaveBeenCalledWith({
    url: 'https://example.com/one',
    active: false,
  });
  expect(browserMocks.tabs.create).toHaveBeenCalledBefore(
    dbMocks.moveSavedTabToHistory,
  );
});

it('does not consume a middle-click open', async () => {
  await openSavedTab('session-1', 'tab-1', false);
  expect(dbMocks.moveSavedTabToHistory).not.toHaveBeenCalled();
});

it('keeps the session when one restore-all tab create fails', async () => {
  browserMocks.tabs.create
    .mockResolvedValueOnce({ id: 1 })
    .mockRejectedValueOnce(new Error('create failed'));
  const result = await restoreSession('session-1');
  expect(result.ok).toBe(false);
  expect(dbMocks.moveSessionToHistory).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Add failing message union/routing tests**

In `background.test.ts`, assert each new message forwards the exact IDs/request and returns the service/DB result. In `messages.test.ts`, send one `sessions:move-tab` and one `history:restore` result through `sendExtensionMessage` to prove both are accepted unchanged.

- [ ] **Step 3: Run and verify RED**

Run: `bun run test --cwd apps/extension -- src/features/tabs/session-service.test.ts src/lib/messages.test.ts src/tests/background.test.ts`

Expected: FAIL because functions/messages/routes are missing.

- [ ] **Step 4: Implement service behavior and message types**

`openSavedTab` must locate the tab by session/tab ID, reject missing or blocked URLs, call `browser.tabs.create({ url, active: false })`, then conditionally call `moveSavedTabToHistory(..., 'opened')`.

Update both stow paths to use the `TabSession` returned by `createSession` as the authoritative deduplicated session. Return `savedTabCount: session.tabs.length`, while still attempting to close every eligible live Chrome tab that was included in the save request.

Remove `RestoreMode` and the obsolete new-window restore branch. Loop in original tab order with `{ url, active: false, pinned: tab.pinned || undefined }`; after the loop completes call `moveSessionToHistory(sessionId, 'restored')`. Update `StowedSessions` to stop sending `mode` before running the typecheck.

Use these message shapes:

```ts
| { type: 'sessions:open-tab'; sessionId: string; tabId: string; consume: boolean }
| { type: 'sessions:restore'; sessionId: string }
| { type: 'sessions:delete-tab'; sessionId: string; tabId: string }
| { type: 'sessions:reorder'; orderedIds: string[] }
| { type: 'sessions:move-tab'; request: MoveSavedTabRequest }
| { type: 'history:list' }
| { type: 'history:open-tab'; historyId: string; tabId: string }
| { type: 'history:restore'; historyId: string }
| { type: 'history:delete'; historyId: string }
```

Change `sessions:delete` routing from hard delete to `moveSessionToHistory(id, 'deleted')`. Route History open through a small `openHistoryTab` service that validates the History entry, then creates `{ active: false }` without mutating it.

Add `saved-tab-not-found`, `history-entry-not-found`, `invalid-tab-url`, and `invalid-saved-move` to `AppErrorCode` in `errors.ts`. Validate IDs and destination indexes in the service/DB boundary and return those structured errors instead of allowing malformed new messages to mutate state.

- [ ] **Step 5: Run focused and full tests**

Run: `bun run test --cwd apps/extension -- src/features/tabs/session-service.test.ts src/lib/messages.test.ts src/tests/background.test.ts`

Expected: PASS.

Run: `bun run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/extension/src/features/tabs/session-service.ts apps/extension/src/features/tabs/session-service.test.ts apps/extension/src/lib/messages.ts apps/extension/src/lib/messages.test.ts apps/extension/src/lib/errors.ts apps/extension/src/entrypoints/background.ts apps/extension/src/tests/background.test.ts apps/extension/src/entrypoints/newtab/components/StowedSessions.tsx
git commit -m "feat(history): route saved restore operations"
```

### Task 5: Enforce Deduplication At The Gist Boundary

**Files:**
- Modify: `apps/extension/src/features/sync/sync-service.ts`
- Modify: `apps/extension/src/features/sync/sync-service.test.ts`
- Modify: `packages/core/src/sync-document.test.ts`

**Interfaces:**
- Consumes: `deduplicateSessionsByUrl`
- Preserves: sync schema version 1 and History exclusion.

- [ ] **Step 1: Write failing sync tests**

Add a push case where local and remote different session IDs contain URLs differing only by hash; assert the pushed document contains only the newer local copy. Add a pull case asserting `importSessions` receives a deduplicated array. Add a sync-document fixture with `sortOrder` and assert parsing works, while asserting the serialized document has no `history` key.

```ts
expect(pushedDocument.sessions.flatMap((session: TabSession) => session.tabs)).toEqual([
  expect.objectContaining({ id: 'new-copy' }),
]);
expect(dbMocks.importSessions).toHaveBeenCalledWith([
  expect.objectContaining({ id: 'new-session' }),
]);
expect(pushedDocument).not.toHaveProperty('history');
```

- [ ] **Step 2: Run and verify RED**

Run: `bun run test --cwd apps/extension -- src/features/sync/sync-service.test.ts`

Expected: FAIL because merged sessions are not deduplicated by URL.

- [ ] **Step 3: Apply dedupe after merge on push and pull**

Import `deduplicateSessionsByUrl` from core and wrap both merge sites:

```ts
sessionsToPush = deduplicateSessionsByUrl(
  mergeSessionsById(remoteDocument.sessions, localSessions),
);

const merged = deduplicateSessionsByUrl(
  mergeSessionsById(await listSessions(), document.sessions),
);
```

Do not add History to `buildSyncDocument`, `SyncDocument`, or sync result counts.

- [ ] **Step 4: Run sync and core tests**

Run: `bun run test --cwd apps/extension -- src/features/sync/sync-service.test.ts`

Run: `bun run test --cwd packages/core -- src/sync-document.test.ts src/tab-session.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/extension/src/features/sync/sync-service.ts apps/extension/src/features/sync/sync-service.test.ts packages/core/src/sync-document.test.ts
git commit -m "fix(sync): deduplicate saved tab urls"
```

### Task 6: Shared Favicon Rendering And Active Control Cleanup

**Files:**
- Create: `apps/extension/src/components/TabFavicon.tsx`
- Create: `apps/extension/src/components/TabFavicon.test.tsx`
- Modify: `apps/extension/src/entrypoints/newtab/components/ActiveWindowSection.tsx`
- Modify: `apps/extension/src/entrypoints/newtab/components/StowedSessions.tsx`
- Modify: `apps/extension/src/entrypoints/newtab/components/ActiveWorkspace.tsx`
- Modify: `apps/extension/src/entrypoints/newtab/App.test.tsx`
- Modify: `apps/extension/src/entrypoints/newtab/styles.css`

**Interfaces:**
- Produces: `<TabFavicon title pageUrl favIconUrl? className? />`
- Removes from UI only: `Refresh from Chrome`, `Collapse Chrome groups`.

- [ ] **Step 1: Write failing favicon and control-removal tests**

Test the favicon source cascade:

```tsx
render(<TabFavicon title="Example" pageUrl="https://example.com/a" favIconUrl="https://example.com/favicon.ico" />);
expect(screen.getByRole('img', { hidden: true })).toHaveAttribute(
  'src',
  'https://example.com/favicon.ico',
);
fireEvent.error(screen.getByRole('img', { hidden: true }));
expect(screen.getByRole('img', { hidden: true })).toHaveAttribute(
  'src',
  'chrome-extension://tabstow-test/_favicon/?pageUrl=https%3A%2F%2Fexample.com%2Fa&size=32',
);
fireEvent.error(screen.getByRole('img', { hidden: true }));
expect(screen.getByText('E')).not.toBeNull();
```

In `App.test.tsx`, assert an active tab with `favIconUrl` renders an image, and replace assertions that query the two controls with assertions that both labels are absent. Keep the event-coalescing refresh test unchanged.

- [ ] **Step 2: Run and verify RED**

Run: `bun run test --cwd apps/extension -- src/components/TabFavicon.test.tsx src/entrypoints/newtab/App.test.tsx`

Expected: FAIL because the shared component is missing and the buttons still render.

- [ ] **Step 3: Implement shared favicon and remove only the toolbar UI**

`TabFavicon` maintains a candidate index over safe `favIconUrl`, the Chrome `/_favicon/` URL for safe HTTP/HTTPS `pageUrl`, then the text initial. Reset the index when either URL changes. Never fetch page HTML.

Use it in Active and Saved tab rows. Remove the `Layers` import only where unused, `collapseCurrentWindowGroups`, `currentWindowId`, and the Active action `<div>`. Do not remove `refresh`, the Chrome event subscription, or the background collapse route/service.

- [ ] **Step 4: Run tests**

Run: `bun run test --cwd apps/extension -- src/components/TabFavicon.test.tsx src/entrypoints/newtab/App.test.tsx`

Expected: PASS, including automatic refresh tests.

- [ ] **Step 5: Commit**

```bash
git add apps/extension/src/components/TabFavicon.tsx apps/extension/src/components/TabFavicon.test.tsx apps/extension/src/entrypoints/newtab/components/ActiveWindowSection.tsx apps/extension/src/entrypoints/newtab/components/StowedSessions.tsx apps/extension/src/entrypoints/newtab/components/ActiveWorkspace.tsx apps/extension/src/entrypoints/newtab/App.test.tsx apps/extension/src/entrypoints/newtab/styles.css
git commit -m "feat(tabs): show favicons and simplify active controls"
```

### Task 7: Shared Workspace Search

**Files:**
- Create: `apps/extension/src/features/tab-search/tab-search.ts`
- Create: `apps/extension/src/features/tab-search/tab-search.test.ts`
- Create: `apps/extension/src/entrypoints/newtab/components/WorkspaceSearch.tsx`
- Modify: `apps/extension/src/entrypoints/newtab/App.tsx`
- Modify: `apps/extension/src/entrypoints/newtab/components/ActiveWorkspace.tsx`
- Modify: `apps/extension/src/entrypoints/newtab/components/ActiveWindowSection.tsx`
- Modify: `apps/extension/src/entrypoints/newtab/components/StowedSessions.tsx`
- Modify: `apps/extension/src/features/i18n/i18n.ts`
- Modify: `apps/extension/src/features/i18n/i18n.test.ts`
- Modify: `apps/extension/src/entrypoints/newtab/App.test.tsx`
- Modify: `apps/extension/src/entrypoints/newtab/styles.css`

**Interfaces:**
- Produces: `filterActiveTabsSnapshot(snapshot, query)`
- Produces: `filterSavedSessions(sessions, query)`
- Changes props: `ActiveWorkspace.query`, `StowedSessions.query`, and `ActiveWindowSection.dragDisabled`.

- [ ] **Step 1: Write failing pure filtering tests**

Cover case-insensitive title/URL matches, retained Chrome group/window metadata, removed empty windows/groups, retained session shell for matching saved tabs, and identity-equivalent output for blank queries:

```ts
expect(filterSavedSessions([reading, work], 'DOCS')).toEqual([
  { ...work, tabs: [work.tabs[1]] },
]);
expect(filterActiveTabsSnapshot(snapshot, 'github').tabs.map(({ id }) => id)).toEqual([22]);
expect(filterActiveTabsSnapshot(snapshot, 'github').chromeGroups.map(({ id }) => id)).toEqual([31]);
```

- [ ] **Step 2: Write failing App integration test**

Render active and saved fixtures, type in `Search active and saved tabs`, and assert only matching rows/groups remain. Assert the topbar `Search the web` input is still present and no `active-tabs:search` message is sent by the local search.

- [ ] **Step 3: Run and verify RED**

Run: `bun run test --cwd apps/extension -- src/features/tab-search/tab-search.test.ts src/entrypoints/newtab/App.test.tsx`

Expected: FAIL because filters/container/input do not exist.

- [ ] **Step 4: Implement pure filters and workspace container**

`App` owns `const [tabQuery, setTabQuery] = useState('')`. Render:

```tsx
<section className="workspace-container" aria-label="Tab workspace">
  <WorkspaceSearch value={tabQuery} onChange={setTabQuery} />
  <section className="workspace-grid">
    <ActiveWorkspace query={tabQuery} {...activeProps} />
    <StowedSessions query={tabQuery} {...savedProps} />
  </section>
</section>
```

`WorkspaceSearch` uses a controlled `type="search"` input and an extension URL link from `chrome.runtime.getURL('/saved-history.html')`. Active computes windows from the filtered snapshot; Saved maps the filtered sessions. Counts should describe the visible filtered items when query is nonblank.

Pass `dragDisabled={controlsDisabled || query.trim() !== ''}` from `ActiveWorkspace` to `ActiveWindowSection`. Use it only for active drag handles/drop targets; keep tab focus, close, and stow controlled by the existing `disabled` prop. Add English and Simplified Chinese strings for the local-search placeholder, clear action, and History link without changing the topbar web-search copy.

Style the outer panel/header without changing the existing responsive two-column breakpoint.

- [ ] **Step 5: Run tests**

Run: `bun run test --cwd apps/extension -- src/features/tab-search/tab-search.test.ts src/entrypoints/newtab/App.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/extension/src/features/tab-search apps/extension/src/entrypoints/newtab/components/WorkspaceSearch.tsx apps/extension/src/entrypoints/newtab/App.tsx apps/extension/src/entrypoints/newtab/components/ActiveWorkspace.tsx apps/extension/src/entrypoints/newtab/components/ActiveWindowSection.tsx apps/extension/src/entrypoints/newtab/components/StowedSessions.tsx apps/extension/src/features/i18n/i18n.ts apps/extension/src/features/i18n/i18n.test.ts apps/extension/src/entrypoints/newtab/App.test.tsx apps/extension/src/entrypoints/newtab/styles.css
git commit -m "feat(search): filter active and saved tabs"
```

### Task 8: Saved Tab Clicks, Recoverable Delete, And Persistent Drag

**Files:**
- Create: `apps/extension/src/entrypoints/newtab/components/saved-tabs-dnd.ts`
- Create: `apps/extension/src/entrypoints/newtab/components/saved-tabs-dnd.test.ts`
- Modify: `apps/extension/src/entrypoints/newtab/components/StowedSessions.tsx`
- Modify: `apps/extension/src/entrypoints/newtab/App.tsx`
- Modify: `apps/extension/src/entrypoints/newtab/App.test.tsx`
- Modify: `apps/extension/src/entrypoints/newtab/styles.css`
- Modify: `apps/extension/src/features/i18n/i18n.ts`
- Modify: `apps/extension/src/features/i18n/i18n.test.ts`

**Interfaces:**
- Produces drag source union: session or `{ sessionId; tabId }`.
- Produces drop request: session reorder IDs or `MoveSavedTabRequest`.
- Consumes background messages from Task 4.

- [ ] **Step 1: Write failing Saved DnD helper tests**

Model semantic targets instead of DOM indices:

```ts
expect(resolveSavedDrop(sourceTab, beforeTabTarget)).toEqual({
  kind: 'tab',
  request: {
    sourceSessionId: 'source',
    tabId: 'tab-2',
    destinationSessionId: 'destination',
    destinationIndex: 0,
  },
});
expect(resolveSavedDrop(sourceSession, sessionOrderTarget)).toEqual({
  kind: 'sessions',
  orderedIds: ['session-2', 'session-1'],
});
expect(resolveSavedDrop(sourceTab, target, { searchActive: true })).toBeNull();
```

Also test DataTransfer serialization rejects malformed/external payloads.

- [ ] **Step 2: Write failing click/delete/drag integration tests**

In `App.test.tsx`:

```ts
await click(savedRow); // primary
expect(sendExtensionMessage).toHaveBeenCalledWith({
  type: 'sessions:open-tab',
  sessionId: 'session-1',
  tabId: 'saved-tab-1',
  consume: true,
});

await auxClick(savedRow, 1);
expect(sendExtensionMessage).toHaveBeenCalledWith({
  type: 'sessions:open-tab',
  sessionId: 'session-1',
  tabId: 'saved-tab-1',
  consume: false,
});
```

Assert both events are default-prevented, the page URL does not change, tab delete sends `sessions:delete-tab`, session delete still sends `sessions:delete` but copy/status says moved to History, cross-session drop sends `sessions:move-tab`, and session reorder sends `sessions:reorder`. With a nonblank search, every saved drag handle is disabled.

- [ ] **Step 3: Run and verify RED**

Run: `bun run test --cwd apps/extension -- src/entrypoints/newtab/components/saved-tabs-dnd.test.ts src/entrypoints/newtab/App.test.tsx`

Expected: FAIL because Saved rows are links without controlled click/drag actions.

- [ ] **Step 4: Implement Saved interactions**

Convert each safe saved row to a controlled button/row. Handle only unmodified primary click and middle `onAuxClick`; call `preventDefault()` and `stopPropagation()` for both. Ignore right click and modified primary clicks.

Add a tab drag handle and trailing trash action. Add a session drag handle in each session header. Render insertion targets before/after sessions and tabs. Use the helper to resolve the exact persistence request. Await `onRunAction`, reload sessions, and clear drag state after every drop. Disable all Saved drag behavior when `query.trim()` is nonempty or another action is busy.

Change success strings to `Moved tab to History.`, `Moved saved session to History.`, and `Restored N tabs and moved the session to History.`

Update the English and Simplified Chinese saved-session subtitle and action labels so no copy still claims restore keeps a Saved copy.

- [ ] **Step 5: Run tests**

Run: `bun run test --cwd apps/extension -- src/entrypoints/newtab/components/saved-tabs-dnd.test.ts src/entrypoints/newtab/App.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/extension/src/entrypoints/newtab/components/saved-tabs-dnd.ts apps/extension/src/entrypoints/newtab/components/saved-tabs-dnd.test.ts apps/extension/src/entrypoints/newtab/components/StowedSessions.tsx apps/extension/src/entrypoints/newtab/App.tsx apps/extension/src/entrypoints/newtab/App.test.tsx apps/extension/src/entrypoints/newtab/styles.css apps/extension/src/features/i18n/i18n.ts apps/extension/src/features/i18n/i18n.test.ts
git commit -m "feat(saved-tabs): add restore and drag interactions"
```

### Task 9: Simple History Recycle Bin Page

**Files:**
- Create: `apps/extension/src/entrypoints/saved-history/index.html`
- Create: `apps/extension/src/entrypoints/saved-history/main.tsx`
- Create: `apps/extension/src/entrypoints/saved-history/HistoryApp.tsx`
- Create: `apps/extension/src/entrypoints/saved-history/HistoryApp.test.tsx`
- Create: `apps/extension/src/entrypoints/saved-history/styles.css`
- Create: `apps/extension/scripts/verify-built-extension.ts`
- Modify: `apps/extension/package.json`
- Modify: `apps/extension/tsconfig.json`
- Modify: `apps/extension/src/tests/manifest.test.ts`
- Modify: `apps/extension/src/features/i18n/i18n.ts`
- Modify: `apps/extension/src/features/i18n/i18n.test.ts`

**Interfaces:**
- Consumes messages: `history:list`, `history:open-tab`, `history:restore`, `history:delete`.
- Consumes: shared `TabFavicon`.

- [ ] **Step 1: Write failing History UI tests**

Mock `sendExtensionMessage` and cover loading/list/error/empty states plus all actions:

```ts
expect(await screen.findByRole('heading', { name: 'History' })).not.toBeNull();
expect(screen.getByText('Opened from Saved for later')).not.toBeNull();

await user.click(screen.getByRole('button', { name: 'Open Example in background' }));
expect(sendExtensionMessage).toHaveBeenCalledWith({
  type: 'history:open-tab',
  historyId: 'history-1',
  tabId: 'tab-1',
});

await user.click(screen.getByRole('button', { name: 'Restore to Saved for later' }));
expect(sendExtensionMessage).toHaveBeenCalledWith({
  type: 'history:restore',
  historyId: 'history-1',
});

vi.spyOn(window, 'confirm').mockReturnValue(true);
await user.click(screen.getByRole('button', { name: 'Delete permanently' }));
expect(sendExtensionMessage).toHaveBeenCalledWith({
  type: 'history:delete',
  historyId: 'history-1',
});
```

- [ ] **Step 2: Run and verify RED**

Run: `bun run --cwd apps/extension test -- src/entrypoints/saved-history/HistoryApp.test.tsx`

Expected: FAIL because the History entrypoint does not exist.

- [ ] **Step 3: Build the extension-local History page**

Use the same React bootstrap pattern as newtab. `HistoryApp` owns `entries`, `busyAction`, and structured status. Load `history:list` on mount and reload after successful restore/delete. Background-open does not remove the entry. Permanent delete must call `window.confirm('Delete this History entry permanently?')` before messaging.

Render a compact page shell with a Back to Tabstow link from `chrome.runtime.getURL('/newtab.html')`, entry timestamp/reason/source title, shared favicon tab rows, and only the approved three actions. Do not add search, drag, grouping, sync, or bulk-empty controls.

Add English and Simplified Chinese strings for History title, empty state, reasons, Open, Restore to Saved for later, Delete permanently, confirmation, and Back to Tabstow. Resolve the saved language preference on mount just as the new-tab entrypoint does.

- [ ] **Step 4: Add WXT/manifest coverage**

Extend `manifest.test.ts` to assert the permissions remain exactly `tabs`, `storage`, `contextMenus`, `tabGroups`, `search`, and `favicon`, assert no content scripts appear, and reject the reserved `history` entrypoint name. Keep generated-manifest verification in the build so it asserts the new-tab override remains, no native History override or content scripts appear, and WXT emits `saved-history.html` but not `history.html`.

- [ ] **Step 5: Run tests**

Run: `bun run --cwd apps/extension test -- src/entrypoints/saved-history/HistoryApp.test.tsx src/tests/manifest.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/extension/src/entrypoints/saved-history apps/extension/src/tests/manifest.test.ts apps/extension/src/features/i18n/i18n.ts apps/extension/src/features/i18n/i18n.test.ts
git commit -m "feat(history): add recycle bin page"
```

### Task 10: Full Verification And Manual Chrome QA

**Files:**
- Modify only files required to fix failures introduced by Tasks 1-9.
- Modify: `README.md` only if the manual QA list would otherwise instruct users to use removed controls or describe restore as non-consuming.

**Interfaces:**
- Verifies every requirement in `docs/superpowers/specs/2026-07-11-saved-tabs-history-search-design.md`.

- [ ] **Step 1: Run formatting/diff hygiene checks**

Run: `git diff --check`

Expected: exit 0 with no whitespace errors.

- [ ] **Step 2: Run the complete automated test suite**

Run: `bun run test`

Expected: all core and extension tests PASS with zero unhandled errors or warnings.

- [ ] **Step 3: Run type checking**

Run: `bun run typecheck`

Expected: exit 0 for core and extension.

- [ ] **Step 4: Build the Chrome extension**

Run: `bun run build`

Expected: exit 0; `apps/extension/.output/chrome-mv3/saved-history.html` exists alongside `newtab.html`; `history.html`, `chrome_url_overrides.history`, and content scripts are absent.

- [ ] **Step 5: Inspect the final diff against the approved design**

Run: `git diff --stat 8bd1598..HEAD && git status --short`

Expected: only the planned core, extension, tests, lockfile, optional README, design, and plan files are changed; worktree is clean after commits.

Check each requirement explicitly:

```text
[ ] Redundant Active controls absent; event refresh retained
[ ] Global newest-copy URL dedupe for local save and Gist merge
[ ] Primary consumes to History; middle does not consume
[ ] Restore all and Saved deletes move to History
[ ] History restore/open/permanent delete work locally
[ ] Search filters Active and Saved without invoking web search
[ ] Active favicons fall back safely
[ ] Session/tab reorder and cross-session moves persist
[ ] Drag disabled under search
[ ] No History sync or new extension permissions
```

- [ ] **Step 6: Perform manual Chrome QA**

Load `apps/extension/.output/chrome-mv3` as unpacked and execute the manual checklist in the design spec. Pay special attention to primary vs middle click, extension focus retention, partial restore failure messaging, persistence after extension reload, and History remaining unchanged after Gist pull.

- [ ] **Step 7: Update README only for stale instructions, then rerun verification**

If README still mentions either removed button or non-consuming restore, edit only those lines. Then rerun:

```bash
bun run test
bun run typecheck
bun run build
git diff --check
```

Expected: every command exits 0.

- [ ] **Step 8: Commit verification/doc adjustments if any**

```bash
git add README.md
git commit -m "docs(saved-tabs): update history workflow qa"
```

Skip this commit when README required no change.
