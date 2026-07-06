# Final Review Fix Report

Date: 2026-07-07

## Files changed

- `packages/core/src/schemas.ts`
- `packages/core/src/sync-document.ts`
- `packages/core/src/schemas.test.ts`
- `packages/core/src/sync-document.test.ts`
- `apps/extension/src/features/sync/sync-service.test.ts`
- `apps/extension/src/features/active-tabs/active-tabs-service.ts`
- `apps/extension/src/features/active-tabs/active-tabs-service.test.ts`
- `apps/extension/src/features/i18n/i18n.ts`
- `apps/extension/src/features/i18n/i18n.test.ts`
- `apps/extension/src/features/quick-links/quick-links.ts`
- `apps/extension/src/features/quick-links/quick-links.test.ts`
- `apps/extension/src/features/quick-links/quick-links-storage.test.ts`
- `apps/extension/src/entrypoints/newtab/App.tsx`
- `apps/extension/src/entrypoints/newtab/App.test.tsx`
- `apps/extension/src/entrypoints/newtab/components/ActiveWorkspace.tsx`
- `apps/extension/src/entrypoints/newtab/components/QuickLinks.tsx`
- `apps/extension/src/entrypoints/newtab/components/SearchBox.tsx`
- `apps/extension/src/entrypoints/newtab/components/StowedSessions.tsx`
- `apps/extension/src/entrypoints/newtab/components/ThemeControls.tsx`
- `apps/extension/src/entrypoints/newtab/components/TodosPanel.tsx`

## Findings addressed

1. Gist sync included legacy `settings.theme`.
   - `SafeSyncSettings` now omits `theme` as well as `githubToken`.
   - `syncDocumentSchema` accepts legacy sync documents with `settings.theme`, strips it during parse, and continues rejecting unknown sensitive fields such as `githubToken`.
   - `toSafeSyncSettings` and `toImportableSettings` explicitly omit/ignore `theme`.
   - Sync service tests now assert pushed documents omit `settings.theme`.

2. Active tab listing returned extension/internal tabs.
   - `listActiveTabs` now reuses `isBlockedTabUrl` from the existing tab filter.
   - Added active-tabs service coverage for `chrome://`, `about:`, `chrome-extension://`, and missing URL filtering.

3. Language selection only updated `document.documentElement.lang`.
   - Added dashboard i18n keys for the migrated primary surfaces and controls.
   - `App` now owns language preference loading and passes the resolved locale to migrated dashboard components.
   - Active tabs, stowed sessions, search, quick links, todos, appearance/theme/language/background controls, and common Chrome/manual group control labels now render through `t(locale, key)`.
   - Added App coverage proving `zh-CN` renders visible Chinese labels, not only the document `lang` attribute.

4. Quick links lacked edit label/icon metadata and reorder.
   - Added `updateQuickLink` helper.
   - Quick links UI now supports prompt-based label edit and icon metadata edit. Blank icon prompt resets to site icon metadata.
   - Quick links UI now has up/down reorder controls backed by `reorderQuickLinks`.
   - Added helper/storage/App tests for edit metadata and reorder.

5. Chrome tab-group sync was one-shot.
   - Manual group create and clear paths now persist local manual state first, then, when Chrome tab-group sync is enabled, send the latest derived groups through `chrome-tab-groups:sync`.
   - Returned Chrome mapping state is persisted separately.
   - Sync failures surface an error status without rolling back or corrupting local manual group state.
   - Added App tests for manual group create and clear triggering sync when enabled.

6. Chrome group controls were enabled before initial workspace load.
   - Chrome group sync/import controls are disabled while workspace state is `null`.
   - Collapse is additionally disabled when no tab/window id is available.
   - Added App tests for initial loading disablement and no-window collapse disablement.

## Tests and outputs

- `bun run --cwd apps/extension test -- src/entrypoints/newtab/App.test.tsx src/features/active-tabs/active-tabs-service.test.ts`
  - Passed: 2 files, 33 tests.
- `bun run --cwd packages/core test -- src/sync-document.test.ts src/schemas.test.ts`
  - Passed: 2 files, 9 tests.
- `bun run test`
  - Passed: core 6 files / 18 tests; extension 21 files / 118 tests.
- `bun run typecheck`
  - Passed: core `tsc --noEmit`; extension `wxt prepare` and `tsc --noEmit`.
- `bun run build`
  - Passed: core TypeScript build and Chrome MV3 WXT production build.

## Self-review

- Confirmed no content scripts, clipboard permissions, eval, `new Function`, CDN loading, or broad permissions were introduced.
- Confirmed custom background bytes remain in the existing local cache path, not extension storage sync or Gist.
- Confirmed active workspace/utility preferences remain local-only; only stowed sessions continue through Gist sync.
- Kept the quick-link edit path prompt-based to avoid clipboard APIs and scope creep.
- Kept local manual group state authoritative when Chrome group sync fails.

## Concerns

- The localization pass covers the requested migrated dashboard labels and common controls, but not every dynamic status message. Some success/error strings remain English where the review explicitly allowed keeping scope sane.
