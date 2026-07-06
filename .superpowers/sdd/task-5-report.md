# Task 5 Report

Implemented native Chrome tab-group import, sync, collapse, and background message routing for the extension.

## What changed

- Added [`apps/extension/src/features/chrome-tab-groups/chrome-tab-groups.ts`](</Users/zrx/Dev/tabstow/apps/extension/src/features/chrome-tab-groups/chrome-tab-groups.ts:1>) with:
  - `syncChromeTabGroups()` to create or reuse native Chrome groups for manual tab groups and persist mapping metadata
  - `importChromeTabGroups()` to import existing native Chrome groups into manual groups and assign tabs
  - `collapseChromeTabGroups()` to collapse all native groups in a specific window
- Added TDD coverage in [`apps/extension/src/features/chrome-tab-groups/chrome-tab-groups.test.ts`](</Users/zrx/Dev/tabstow/apps/extension/src/features/chrome-tab-groups/chrome-tab-groups.test.ts:1>) for sync, disabled sync, collapse, and import flows.
- Extended [`apps/extension/src/lib/messages.ts`](</Users/zrx/Dev/tabstow/apps/extension/src/lib/messages.ts:1>) with the new `chrome-tab-groups:*` message types and response unions.
- Updated [`apps/extension/src/entrypoints/background.ts`](</Users/zrx/Dev/tabstow/apps/extension/src/entrypoints/background.ts:1>) to route `chrome-tab-groups:sync`, `chrome-tab-groups:import`, and `chrome-tab-groups:collapse-window`.
- Added background routing coverage in [`apps/extension/src/tests/background.test.ts`](</Users/zrx/Dev/tabstow/apps/extension/src/tests/background.test.ts:1>) for the new sync and import messages.

## Verification

- `rtk bun run --cwd apps/extension test -- src/features/chrome-tab-groups/chrome-tab-groups.test.ts src/tests/background.test.ts src/tests/manifest.test.ts`
- Result: passed.

## Notes

- Sync is a no-op when native Chrome tab-group mirroring is disabled.
- Imported Chrome groups reuse existing mappings when possible and create uniquely named manual groups when needed.

## Review Fixes

- Split manual-group sync by `windowId` so cross-window groups mirror into separate native Chrome groups and persist one mapping per `{ virtualGroupKey, windowId }`.
- Updated import to overwrite stale mapping metadata when a mapped manual group no longer exists, so recreated manual groups become the new mapping target for the existing Chrome group.

## Review Verification

- `rtk bun run --cwd apps/extension test -- src/features/chrome-tab-groups/chrome-tab-groups.test.ts`
- Result: passed with 6 tests.
