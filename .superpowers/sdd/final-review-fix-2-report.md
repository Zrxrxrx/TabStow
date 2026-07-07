## Fixes

- Passed `disabled={busyAction !== null}` from `App` into `QuickLinks`.
- Disabled quick-link mutation controls while busy, including add/edit/remove/reorder/upload and open-tab save actions.
- Guarded quick-link write paths so dialog submits and other write handlers no-op once sync work has started.
- Added App coverage proving quick-link mutation controls disable during `sync:pull` and that a dialog submit cannot write while pull is in progress.

## Commands

1. `PATH="$HOME/.bun/bin:$PATH" rtk bash -lc 'cd apps/extension && bun run test -- src/entrypoints/newtab/App.test.tsx -t "disables quick-link writes while a sync pull is running"'`
2. `PATH="$HOME/.bun/bin:$PATH" rtk bun run test`
3. `PATH="$HOME/.bun/bin:$PATH" rtk bun run typecheck`

## Results

- Targeted App test: passed.
- Full test suite: passed.
- Typecheck: passed.
