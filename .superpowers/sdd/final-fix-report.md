# Final Review Fix Report

Base: `5962b24`

## Outcome

Every Critical and Important item in `final-review-findings.md` is addressed. The four low-risk minors were also completed. Keyboard drag-and-drop for Saved remains intentionally outside this fix wave, as required.

## Finding-to-code/test map

### 1. Critical — atomic Gist pull merge/replace

- `apps/extension/src/db/db.ts`
  - Added `mergeRemoteSessions`.
  - Remote sessions are parsed before mutation.
  - A single Dexie `rw` transaction now reads current sessions, applies ID merge with remote precedence, globally deduplicates URLs, resequences, clears, and bulk-writes.
- `apps/extension/src/features/sync/sync-service.ts`
  - Pull now calls the atomic DB operation rather than performing `listSessions` and `importSessions` separately.
- Tests:
  - `apps/extension/src/db/db.test.ts`: controlled deferred read interleaving starts a concurrent `createSession`; the local write is retained.
  - `apps/extension/src/features/sync/sync-service.test.ts`: pull delegates the fetched remote set directly to the atomic operation and never uses the former split calls.

### 2. Important — upgrade and empty/missing-Gist dedupe

- `apps/extension/src/db/db.ts`
  - v1→v2 upgrade now repairs tab IDs, globally deduplicates normalized URLs, removes empty sessions, and assigns contiguous `sortOrder` values.
  - Added v3 repair upgrade so already-created v2 databases receive the duplicate-ID/global-dedupe repair too.
- `apps/extension/src/features/sync/sync-service.ts`
  - Push initializes `sessionsToPush` with local deduplication before reading the remote file, covering both missing files and `{}`.
- Tests:
  - v1 migration global URL dedupe/resequence regression.
  - v2 duplicate-ID repair regression.
  - missing-file and empty-object push dedupe regressions.

### 3. Important — duplicate tab-ID safety

- `packages/core/src/schemas.ts`
  - `tabSessionSchema` rejects duplicate tab IDs within a session, covering create/update/import and parsed sync boundaries.
- `packages/core/src/tab-session.ts`
  - Added deterministic `repairDuplicateTabIds` for legacy rows.
  - `deduplicateSessionsByUrl` now tracks winning occurrences by session/tab indexes rather than `{sessionId, tabId}` identity.
- `apps/extension/src/db/db.ts`
  - Migrations repair legacy IDs before global dedupe.
- Tests:
  - Core schema duplicate-ID rejection.
  - Same-ID/same-URL occurrence dedupe.
  - Same-ID/distinct-URL preservation.
  - v2 legacy repair without distinct-URL loss.
  - create/import duplicate-ID rejection.
  - malicious Gist fixture rejection before local mutation.

### 4. Important — positive URL allowlist at Chrome open boundaries

- `apps/extension/src/features/tabs/tab-filter.ts`
  - Added shared `isOpenableTabUrl`, accepting only successfully parsed `http:` and `https:` URLs.
- `apps/extension/src/features/tabs/session-service.ts`
  - Saved individual open, History individual open, and Restore all pre-validation use the shared validator.
- Tests:
  - `javascript:`, `data:`, `file:`, and `ftp:` imported fixtures are rejected at all three boundaries.
  - Assertions prove zero `browser.tabs.create` calls and no Saved/History consumption.

### 5. Important — cross-page consume/restore concurrency guard

- `apps/extension/src/features/tabs/session-service.ts`
  - Added service-worker-module-scoped restore-session and consuming-tab locks.
  - Locks cover lookup, Chrome creation, and DB consumption.
  - Restore conflicts with any consuming open in its session; duplicate consuming opens conflict per tab. Distinct-tab consuming operations and non-consuming opens remain independent.
  - Added structured `operation-in-progress` result.
- `apps/extension/src/lib/errors.ts`
  - Added the new error code.
- Tests:
  - Deferred Chrome-create promises prove two consuming opens produce one Chrome side effect.
  - Deferred restore proves a same-session consuming open conflicts and produces no additional Chrome side effect.

### 6. Important — History restore timestamp freshness

- `apps/extension/src/db/db.ts`
  - `insertNewestSessionInCurrentTransaction` now compares survivor tab counts and applies restore time only when URL dedupe changed that survivor’s tabs.
  - Pure resequencing retains `updatedAt`.
- Test:
  - One changed survivor receives a new timestamp while an untouched survivor keeps its original timestamp.

## Minor triage

- `TabFavicon` candidate identity now resets the effective cascade index during render; a `flushSync` regression verifies no stale candidate frame.
- Saved filtered session/tab counts and their combined accessible label now use English/Simplified Chinese i18n keys.
- Core tests cover legacy `createdAt` ordering, stable ID ordering under display ties, and stable IDs under full URL-dedupe ranking ties.
- DB tests reject duplicate and unknown session reorder ID lists without changing order.
- Remaining enhancement: keyboard-accessible Saved drag-and-drop. Pointer-native Saved DnD behavior and search-time drag disabling are unchanged.

## TDD evidence

### RED

Command:

```text
(cd packages/core && bun run test src/schemas.test.ts src/tab-session.test.ts)
```

Exit: `1`

Exact Vitest summary:

```text
Test Files  2 failed (2)
Tests  3 failed | 17 passed (20)
```

Expected failures:

```text
rejects sessions with duplicate saved-tab ids
deduplicates duplicate-id occurrences without retaining every matching occurrence
uses stable session ids when display ordering fully ties
```

Command:

```text
(cd apps/extension && bun run test src/db/db.test.ts src/features/sync/sync-service.test.ts src/features/tabs/session-service.test.ts src/components/TabFavicon.test.tsx src/features/i18n/i18n.test.ts)
```

Exit: `1`

Exact Vitest summary:

```text
Test Files  5 failed (5)
Tests  26 failed | 67 passed (93)
```

Expected failure groups:

```text
DB: migration global dedupe, v2 ID repair, import duplicate rejection,
    missing atomic merge operation, unchanged survivor timestamp preservation
Sync: missing/empty push dedupe, atomic pull delegation, malicious duplicate-ID fixture
Open boundaries: javascript/data/file/ftp rejected for Saved, History, and Restore all
Concurrency: consuming-open collision and restore-vs-consuming-open collision
UI: synchronous favicon reset and localized Saved count strings
```

### GREEN

Command:

```text
(cd packages/core && bun run test src/schemas.test.ts src/tab-session.test.ts)
```

Exit: `0`

```text
Test Files  2 passed (2)
Tests  20 passed (20)
```

Command:

```text
(cd apps/extension && bun run test src/db/db.test.ts src/features/sync/sync-service.test.ts src/features/tabs/session-service.test.ts src/components/TabFavicon.test.tsx src/features/i18n/i18n.test.ts)
```

Exit: `0`

```text
Test Files  5 passed (5)
Tests  93 passed (93)
```

The first full typecheck then caught the test-only Dexie mock return type:

```text
src/db/db.test.ts(339,7): error TS2741: Property 'timeout' is missing ...
```

The mock was typed as the table method’s `PromiseExtended` return and the DB regression was rerun:

```text
Test Files  1 passed (1)
Tests  27 passed (27)
```

## Final verification

Command: `bun run test`

Exit: `0`

```text
Core:      Test Files 6 passed (6); Tests 51 passed (51)
Extension: Test Files 30 passed (30); Tests 329 passed (329)
```

Command: `bun run typecheck`

Exit: `0`

```text
packages/core: tsc --noEmit -p tsconfig.json
apps/extension: wxt prepare && tsc --noEmit -p tsconfig.json
WXT: Finished in 66 ms
```

Command: `bun run build`

Exit: `0`

```text
packages/core: tsc -p tsconfig.json
apps/extension: Built chrome-mv3; total size 510.02 kB
Verified built Chrome manifest and saved-history entrypoint.
```

Command: `git diff --check`

Exit: `0`, no output.

## Self-review

- Remote precedence remains the existing `mergeSessionsById(local, remote)` contract.
- The atomic session merge contains the read and replacement in one `rw` transaction.
- History is absent from the sync document and sync flow.
- Primary Saved opens and Restore all consume only after Chrome opens; middle opens remain non-consuming/background.
- Hostile URLs are rejected before any Chrome call or Saved/History mutation.
- Lock cleanup occurs in `finally`, including Chrome/storage failures.
- Migrations preserve distinct URLs and deterministically repair only colliding IDs.
- Restore resequencing does not alter freshness for unchanged sessions.
- Manifest permissions and generated-manifest safeguards are unchanged; the build verifier passed.
- No content scripts, eval, `new Function`, remote executable code, CDN scripts, Bun-only runtime APIs, or Node-only runtime APIs were added.
- Saved search still disables drag, topbar web search is untouched, and approved open/delete/history UX remains intact.

## Concerns

- No correctness blockers remain.
- Keyboard Saved DnD remains the explicitly deferred accessibility enhancement.
- Implementer model selection was unavailable in this API; work used the platform model with the requested integration rigor.

## Compatibility follow-up

A subsequent integration review identified three compatibility gaps. Commit following this report update addresses all three without changing the approved interaction scope.

### Stow safety

- `isStowableTab` now uses the same positive `http:`/`https:` validator as Chrome open boundaries.
- Selected-tab stow also requires `isOpenableTabUrl`; the former negative browser-URL check is no longer used there.
- Current-window and selected-tab regressions cover `javascript:`, `data:`, `file:`, and `ftp:` URLs.
- Each fixture returns the existing `no-eligible-tabs` result and proves there is no persistence or Chrome removal; current-window tests also prove no survivor tab is created.

### Legacy v2 History duplicate IDs

- The v3 migration now repairs History tab IDs as well as Saved tab IDs while retaining tab order and every distinct URL.
- `prepareHistoryTabs` deterministically repairs IDs and parses every saved tab.
- Both new History writes and History restore use the helper, so current writes remain valid and post-migration malformed rows are repaired defensively.
- A real seeded v2 database verifies migrated History IDs, order, distinct URL preservation, and successful restore into Saved.
- A defensive v3-row fixture separately proves restore repairs duplicate IDs without URL loss.

### Localized singular/plural counts

- Added singular/plural Saved session and tab keys for English and Simplified Chinese.
- Visible counts select keys by count; the combined accessible name composes the same localized strings.
- i18n tests cover all keys. App tests verify English `1 session` / `1 tab` and Simplified Chinese visible/accessible count copy.

### Follow-up TDD evidence

RED command:

```text
(cd apps/extension && bun run test src/features/tabs/session-service.test.ts src/db/db.test.ts src/features/i18n/i18n.test.ts src/entrypoints/newtab/App.test.tsx)
```

Exit: `1`

```text
Test Files  4 failed (4)
Tests  13 failed | 127 passed (140)
```

Expected failures:

```text
8 stow fixtures saved/closed non-http URLs instead of returning no-eligible-tabs
2 History fixtures retained duplicate IDs through migration/restore
2 i18n suites lacked singular keys
1 App test rendered "1 sessions" / "1 tabs"
```

GREEN command:

```text
(cd apps/extension && bun run test src/features/tabs/session-service.test.ts src/db/db.test.ts src/features/i18n/i18n.test.ts src/entrypoints/newtab/App.test.tsx)
```

Exit: `0`

```text
Test Files  4 passed (4)
Tests  140 passed (140)
```

### Follow-up final verification

Command: `bun run test`

Exit: `0`

```text
Core:      Test Files 6 passed (6); Tests 52 passed (52)
Extension: Test Files 30 passed (30); Tests 339 passed (339)
```

Command: `bun run typecheck`

Exit: `0`

```text
packages/core: tsc --noEmit -p tsconfig.json
apps/extension: wxt prepare && tsc --noEmit -p tsconfig.json
WXT: Finished in 71 ms
```

Command: `bun run build`

Exit: `0`

```text
packages/core: tsc -p tsconfig.json
apps/extension: Built chrome-mv3; total size 510.42 kB
Verified built Chrome manifest and saved-history entrypoint.
```

Command: `git diff --check`

Exit: `0`, no output.

### Follow-up self-review

- Non-HTTP live tabs cannot enter Saved or the closure list in either stow path.
- Existing pinned-tab inclusion/closure behavior is unchanged for HTTP(S) tabs.
- History repair changes IDs only when they collide; URL data and ordering are preserved.
- History remains local-only and absent from Gist sync.
- New History entries parse their tab payload before persistence.
- Singular/plural selection changes count copy only; filtering, Saved drag disabling during search, and all topbar behavior are unchanged.
- Manifest permissions and build safeguards remain unchanged and passed verification.
