# Task 5 Report

Implemented the background message wiring and the Tabstow context menu for the MVP.

## What changed

- Added `apps/extension/src/features/context-menu/context-menu.ts` to register the `tabstow-stow-current-window` menu item and invoke `saveCurrentWindowAsSession()` on click.
- Updated `apps/extension/src/entrypoints/background.ts` to:
  - create the context menu on install and startup
  - register the context menu click handler
  - handle `sessions:list`, `sessions:stow-current-window`, `sessions:restore`, `sessions:delete`, `settings:get`, `settings:update`, `sync:push`, and `sync:pull`

## Verification

- `rtk bun run typecheck`
- `rtk bun run build`

## Notes

- I did not need to change `apps/extension/src/lib/messages.ts`.
- TypeScript required a local widening of the background handler return type to keep the owned-file change isolated.
