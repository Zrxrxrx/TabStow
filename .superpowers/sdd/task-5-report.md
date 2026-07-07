# Task 5 Report: Chrome Sync UI And No Auto-Collapse

## Status

Completed.

## What changed

- Updated Chrome tab group sync so the default sync path no longer sends `collapsed: true` when renaming or creating synced Chrome groups.
- Added `chromeGroupsSynced` and `refreshChromeGroups` i18n keys in English and Simplified Chinese.
- Updated `ActiveWorkspace` to load `active-tabs:snapshot`, store `chromeGroups`, and build UI groups with `buildActiveTabGroups(tabs, manualState, orderState, chromeGroups)`.
- Replaced the old Chrome sync checkbox with a passive status pill plus a refresh button.
- Kept collapse/import controls, and made Chrome group import force `enabled: true`.
- Added the debounced Chrome tabs / tabGroups event refresh effect.
- Updated App and Chrome tab group tests to reflect the passive sync UI and non-collapsing sync behavior.

## TDD notes

### Red

1. Updated the targeted tests first:
   - `apps/extension/src/features/chrome-tab-groups/chrome-tab-groups.test.ts`
   - `apps/extension/src/entrypoints/newtab/App.test.tsx`
2. Ran:

```bash
PATH="$HOME/.bun/bin:$PATH" rtk bun run test -- src/features/chrome-tab-groups/chrome-tab-groups.test.ts src/entrypoints/newtab/App.test.tsx
```

3. Confirmed expected failures:
   - Chrome sync tests failed because the implementation still passed `collapsed: true`.
   - App tests failed because `ActiveWorkspace` still used `active-tabs:list` and rendered the sync checkbox.

### Green

Implemented the minimal production changes in:

- `apps/extension/src/features/chrome-tab-groups/chrome-tab-groups.ts`
- `apps/extension/src/entrypoints/newtab/components/ActiveWorkspace.tsx`
- `apps/extension/src/features/i18n/i18n.ts`

Then re-ran:

```bash
PATH="$HOME/.bun/bin:$PATH" rtk bun run test -- src/features/chrome-tab-groups/chrome-tab-groups.test.ts src/entrypoints/newtab/App.test.tsx
```

Result: 52/52 tests passed.

## Extra verification

Ran:

```bash
PATH="$HOME/.bun/bin:$PATH" rtk bun run typecheck
```

Result: passed.

## Self-review

- Confirmed only the five task files were changed.
- Checked the diff against the brief requirements:
  - passive status UI: yes
  - refresh button: yes
  - snapshot wiring: yes
  - no default auto-collapse during sync: yes
  - import forces enabled sync state: yes
  - debounced Chrome event refresh: yes
- No additional issues found during review.

## Commit

Created commit:

- `feat(newtab): default chrome group sync`

---

## Review finding follow-up: legacy disabled sync state

### What changed

- Migrated legacy `chromeTabGroups.enabled = false` to `true` during `ActiveWorkspace` refresh before the workspace state is stored back.
- Forced manual Tabstow grouping sync writes to send `chrome-tab-groups:sync` with `enabled: true`, even when the in-memory workspace still came from legacy persisted data.
- Added focused App coverage for both the load-time migration and a manual group change syncing with `enabled: true` from legacy state.

### Verification

Ran from `apps/extension`:

```bash
PATH="$HOME/.bun/bin:$PATH" rtk bun run test -- src/entrypoints/newtab/App.test.tsx
PATH="$HOME/.bun/bin:$PATH" rtk bun run typecheck
```

Results:

- `src/entrypoints/newtab/App.test.tsx`: passed (42 tests)
- `bun run typecheck`: passed

### Commit

- `fix(newtab): migrate legacy chrome sync state`
