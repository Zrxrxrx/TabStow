# Task 3 Report: Local History And Atomic Saved Mutations

## Outcome

Implemented the local-only History data model and atomic Saved/History mutations described by `.superpowers/sdd/task-3-brief.md`.

Changed only the requested production and test files:

- `apps/extension/src/features/history/types.ts`
- `apps/extension/src/db/db.ts`
- `apps/extension/src/db/db.test.ts`

History remains local to IndexedDB. Existing Saved export/import and Gist sync shapes still contain sessions only.

## Assumptions and success criteria

- `destinationIndex` is the tab's final zero-based index after removal from its source.
- Mutation errors are ordinary typed `Error` instances with ID/index-specific messages.
- Deleted source sessions do not need their `updatedAt` changed because the row no longer survives; every surviving modified session does receive a fresh `updatedAt`.
- Success required focused transaction tests, full tests, typecheck, clean diff validation, self-review, and an independent read-only review.

## RED 1: missing History and move APIs

Added nine focused tests before production changes for:

- moving one saved tab to History while retaining the remaining source tab;
- deleting the source session when its final tab moves to History;
- moving a complete session to History;
- rolling back Saved and History when the transaction aborts;
- restoring History as a newest Saved session while deduplicating existing Saved URLs;
- permanently deleting only a History entry;
- moving a tab between sessions at the requested index;
- same-session exact-index reorder;
- invalid-index rejection without changing either table.

Command, run from `apps/extension`:

```bash
rtk bun run test -- src/db/db.test.ts
```

Expected RED result:

```text
Test Files  1 failed (1)
Tests       9 failed | 7 passed (16)
```

All nine failures were caused by the intended missing exports:

```text
TypeError: moveSavedTabToHistory is not a function
TypeError: moveSessionToHistory is not a function
TypeError: moveSavedTab is not a function
```

This confirmed the tests exercised the new API boundary rather than failing because of test setup or syntax errors.

## GREEN 1: minimal implementation

Implemented:

- `HistoryReason`, `HistoryEntry`, and `MoveSavedTabRequest`;
- the typed Dexie `history` table accessor for the existing v2 schema;
- newest-first `listHistory` and `getHistoryEntry`;
- atomic `moveSavedTabToHistory` and `moveSessionToHistory`;
- atomic `restoreHistoryEntry` using the existing newest-session URL dedupe/resequence path;
- atomic `deleteHistoryEntry`;
- atomic same-session reorder and cross-session `moveSavedTab`;
- missing session/tab/History and invalid-index `Error` messages;
- empty-source cleanup and `updatedAt` changes for surviving modified sessions.

Focused result:

```text
Test Files  1 passed (1)
Tests       16 passed (16)
```

## RED 2: self-review regression for restore timestamps

Self-review found that restoring History shortened/resequenced existing Saved sessions without refreshing their `updatedAt`, contrary to the task requirement that every modified surviving session receive a new timestamp.

Added a focused assertion first:

```ts
expect((await getSession('existing'))?.updatedAt).not.toBe(existing.updatedAt);
```

Focused RED result:

```text
Test Files  1 failed (1)
Tests       1 failed | 15 passed (16)
AssertionError: expected '2026-07-02T00:00:00.000Z' not to be '2026-07-02T00:00:00.000Z'
```

## GREEN 2: restore updates survivors

Extended the in-transaction newest-session helper with an optional survivor timestamp and supplied the restore time from `restoreHistoryEntry`. This keeps the Task 2 create-session behavior unchanged while ensuring every surviving session modified by restore gets the restore timestamp.

Focused result:

```text
Test Files  1 passed (1)
Tests       16 passed (16)
```

The UUID collision rollback test also restores its `crypto.randomUUID` spy in `beforeEach`, preventing state leakage into later tests.

## Atomicity evidence

The rollback test forces two History inserts to use the same primary key. The second operation changes its Saved source before the History insert raises a constraint error. Assertions prove Dexie rolls the Saved mutation back and leaves both stores byte-for-byte equal to their pre-transaction state.

All five mutation APIs open a read-write Dexie transaction spanning both `db.sessions` and `db.history`:

- `moveSavedTabToHistory`
- `moveSessionToHistory`
- `restoreHistoryEntry`
- `deleteHistoryEntry`
- `moveSavedTab`

## Final verification

Fresh focused database verification:

```text
Test Files  1 passed (1)
Tests       16 passed (16)
```

Fresh full repository tests:

```bash
rtk bun run test
```

```text
Core:      3 files passed, 19 tests passed
Extension: 25 files passed, 218 tests passed
Total:     28 files passed, 237 tests passed
```

Fresh repository typecheck:

```bash
rtk bun run typecheck
```

```text
Core TypeScript: exit 0
WXT prepare: finished
Extension TypeScript: exit 0
```

Diff validation:

```bash
rtk git diff --check
```

Result: exit 0 with no whitespace errors.

## Self-review and independent review

Self-review checked the task brief line by line, transaction store scopes, mutation ordering, rollback behavior, exact insertion indexes, empty-source cleanup, URL dedupe/resequence reuse, timestamp updates, History sync exclusion, and MV3-safe runtime APIs.

An independent read-only reviewer found no Critical or Important issues and assessed the change as merge-ready. It noted two optional test-hardening opportunities: table-driven coverage for every missing-ID/error-message branch and an explicit two-entry newest-first History ordering assertion. The production paths are implemented; these additions were not required to correct a defect in this task.

## Concerns

No production blocker remains. The only open concerns are the two non-blocking test-hardening opportunities noted above.

## Reviewer fix: duplicate saved-tab IDs

The approval review found that `moveSavedTabToHistory` located one matching tab but removed every tab with the same ID. Because the current schema/import boundary accepts duplicate tab IDs, tabs with distinct URLs could be silently discarded without reaching History.

### RED

Added a regression test with two source tabs sharing `source-tab` while using different URLs. The test selects the first occurrence and requires the second occurrence to remain in Saved.

Command:

```bash
rtk bun run --cwd apps/extension test -- src/db/db.test.ts
```

Observed the intended failure:

```text
Test Files  1 failed (1)
Tests       1 failed | 16 passed (17)
AssertionError: expected undefined to deeply equal [ 'https://example.com/duplicate-id' ]
```

The source session was `undefined`, confirming the implementation removed both same-ID tabs and then deleted the emptied session.

### GREEN

Changed `moveSavedTabToHistory` to locate the selected array index and remove exactly one element with `splice`. No schema, import, or unrelated move behavior changed.

Reran the same command:

```text
Test Files  1 passed (1)
Tests       17 passed (17)
```

### Final verification after the fix

```text
Full tests: 28 files passed, 238 tests passed
- Core: 3 files, 19 tests
- Extension: 25 files, 219 tests
Typecheck: core and extension passed
git diff --check: passed
```

Self-review confirmed the change removes exactly the array element returned by the existing first-match selection semantics, preserves the other same-ID tab and its distinct URL, and leaves the surrounding transaction and empty-source behavior unchanged.
