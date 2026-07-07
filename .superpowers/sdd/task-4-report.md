# Task 4 Report: Remove Active Workspace Hint

## What changed

- Removed the duplicate active workspace stow hint from `apps/extension/src/entrypoints/newtab/components/ActiveWorkspace.tsx`.
- Removed the `onStowCurrentWindow` prop from `ActiveWorkspace` and stopped passing it from `apps/extension/src/entrypoints/newtab/App.tsx`.
- Deleted the `.active-workspace-hint` styles from `apps/extension/src/entrypoints/newtab/styles.css`, including the mobile override.
- Updated `apps/extension/src/entrypoints/newtab/App.test.tsx` to assert that the duplicate hint no longer renders while preserving the top-right `Stow current window` button.

## Validation

- `rtk bun run --cwd apps/extension test src/entrypoints/newtab/App.test.tsx -t "duplicate stow hint"`
- `rtk bun run --cwd apps/extension test src/entrypoints/newtab/App.test.tsx -t "stow|workspace|hint"`

## Outcome

- The active workspace panel still renders Chrome group controls, duplicate cleanup, group navigation, and tab row actions.
- The top-right primary `Stow current window` button remains in `App`.
- The duplicate in-panel stow hint is gone from both the markup and the stylesheet.

## Files changed

- `apps/extension/src/entrypoints/newtab/components/ActiveWorkspace.tsx`
- `apps/extension/src/entrypoints/newtab/App.tsx`
- `apps/extension/src/entrypoints/newtab/styles.css`
- `apps/extension/src/entrypoints/newtab/App.test.tsx`

## Concerns

- None.
