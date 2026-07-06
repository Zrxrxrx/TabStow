# Task 2 Report: Active Tab Domain Model And Grouping Helpers

## Summary

Implemented the pure active-tab domain model, label helpers, and grouping helpers described in the task brief.

## RED

### Test written first

- Added `apps/extension/src/features/active-tabs/active-tab-groups.test.ts` before any production files existed.

### Failure evidence

- Brief command attempted:
  - `rtk bun --cwd apps/extension run test -- src/features/active-tabs/active-tab-groups.test.ts`
  - Result: Bun printed `bun run` usage instead of running the script in this environment.
- Equivalent working Bun command used to verify RED:
  - `rtk bun run --cwd apps/extension test -- src/features/active-tabs/active-tab-groups.test.ts`
  - Result: failed suite with `Failed to resolve import "./active-tab-groups"` because the active-tab files did not exist yet.

## GREEN

### Production files added

- `apps/extension/src/features/active-tabs/types.ts`
- `apps/extension/src/features/active-tabs/tab-labels.ts`
- `apps/extension/src/features/active-tabs/active-tab-groups.ts`

### Passing test evidence

- Command:
  - `rtk bun run --cwd apps/extension test -- src/features/active-tabs/active-tab-groups.test.ts`
- Result:
  - `Test Files  1 passed (1)`
  - `Tests  5 passed (5)`

## Files Changed

- `apps/extension/src/features/active-tabs/active-tab-groups.test.ts`
- `apps/extension/src/features/active-tabs/types.ts`
- `apps/extension/src/features/active-tabs/tab-labels.ts`
- `apps/extension/src/features/active-tabs/active-tab-groups.ts`

## Commit

- `feat(active-tabs): add grouping helpers`

## Self-Review

- Matched the task brief file list and exported types/helpers exactly.
- Kept the implementation pure and limited to the new active-tabs feature directory.
- Preserved the required grouping precedence: manual assignment, landing pages, then domain grouping.
- Verified duplicate handling keeps the first indexed tab as the retained tab.

## Concerns

- The literal Bun command in the brief printed usage in this Bun version; an equivalent Bun invocation was required to execute the RED/GREEN test cycle.

---

# Task 2 Review Fix: Multi-window Tab Ordering

## Fix

- Replaced fallback tab ordering in `apps/extension/src/features/active-tabs/active-tab-groups.ts` with deterministic `windowId` -> `index` -> `id` sorting.
- Applied the same ordering to duplicate retention so exact-URL matches spanning multiple Chrome windows keep the earliest deterministic tab.
- Added a targeted test covering duplicate URLs across different `windowId`s and verifying grouped tab order.

## Verification

- `rtk bun run --cwd apps/extension test -- src/features/active-tabs/active-tab-groups.test.ts`
- Result: `1 passed`, `6 tests passed`
