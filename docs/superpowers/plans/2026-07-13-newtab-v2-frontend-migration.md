# New Tab V2 Frontend Migration Implementation Plan

Status: ready for `plan-eng-review`; implementation not started

> **For agentic workers:** Execute this plan task by task with the available `implement` workflow and collaboration subagents. If `superpowers:subagent-driven-development` is available in the execution session, prefer it; otherwise use the available subagent tools directly. Every implementation and review subagent must use `gpt5.5` with medium reasoning; fast models are not allowed. Track progress with the checkboxes in this document.

**Goal:** Replace the current New Tab presentation with the approved V2 desktop experience while preserving existing Chrome, Saved, Quick Link, Todos, History, and synchronization semantics, except for the explicitly retired visual-personalization data.

**Architecture:** Keep the existing MV3 background services, typed messages, IndexedDB repositories, and Chrome-authoritative Active Tab projection. Rebuild the React composition around a fixed three-region V2 shell, add only the minimum missing contracts (`audible`, `discarded`, stow preview, paused-incident acknowledgement), and reuse existing History and synchronization operations. V1 UI and CSS are removed in one cutover after the V2 slices are integrated and verified.

**Approved source:** `docs/superpowers/specs/2026-07-13-newtab-v2-frontend-migration-design.md`

**Visual source:** `design/v2/index.html`

**Tech stack:** TypeScript, React 19, WXT Manifest V3, Chrome Extensions APIs, Dexie/IndexedDB, WXT storage, Cache Storage, Lucide React, Vitest/jsdom, Bun.

## Global constraints

- Use Bun for all dependency and script commands. Do not use pnpm, npm, npx, or yarn.
- Commit messages use `type(scope): msg`.
- Do not add extension permissions, content scripts, broad host permissions, remote executable code, CDN assets, `eval`, `new Function`, Node-only APIs, or Bun-only APIs to runtime code.
- Preserve Chrome as the source of truth for Active Tabs, windows, groups, pinned state, and order.
- Preserve IndexedDB as the durable source for Saved for Later and device-local History.
- Preserve extension storage for lightweight language, light/dark mode, and paused-incident acknowledgement.
- Do not create a second History/Recovery data model or duplicate GitHub authorization and Gist-binding workflows in New Tab.
- Use real state or an explicit loading/empty/unavailable/error state. Never ship prototype sample accounts, dates, counters, progress, storage percentages, or simulated success.
- Reordering is mouse drag only in this version, including Quick Links. Ordinary buttons, links, search, and dialogs remain keyboard-operable.
- Keep Quick Links, Active Tabs, and Saved for Later visible as three regions at desktop widths down to 1024px. Do not add a mobile layout.
- Do not begin Task 1 until this plan passes `plan-eng-review`.

## Execution order

Tasks 1 and 2 establish independent low-level contracts and may be investigated in parallel, but write-heavy implementation should proceed in the numbered order because `App.tsx`, `App.test.tsx`, `styles.css`, and i18n are shared integration points.

1. Retire theme personalization and bootstrap fixed mode.
2. Add real tab-state and neutral favicon contracts.
3. Establish V2 modal, feedback, and shell foundations.
4. Add authoritative Stow Current Window preview and control states.
5. Replace the two searches with Unified Search.
6. Migrate Quick Links into the V2 rail.
7. Migrate Active Tabs and full-row Chrome drag surfaces.
8. Migrate Saved for Later and add Recovery Bin preview.
9. Add compact sync diagnostics and once-per-incident prompting.
10. Complete the one-cutover App composition, i18n, and V1 cleanup.
11. Run automated, build, and Chrome visual/interaction verification.

---

## Task 1: Retire Visual Personalization And Bootstrap Fixed Light/Dark Mode

**Files:**

- Modify: `apps/extension/src/features/theme/theme-preferences.ts`
- Modify: `apps/extension/src/features/theme/theme-preferences.test.ts`
- Modify: `apps/extension/src/features/theme/theme-background-cache.ts`
- Create: `apps/extension/src/features/theme/theme-background-cache.test.ts`
- Modify: `apps/extension/src/entrypoints/newtab/main.tsx`
- Modify: `apps/extension/src/entrypoints/newtab/App.tsx`
- Modify: `apps/extension/src/entrypoints/newtab/App.test.tsx`
- Delete: `apps/extension/src/entrypoints/newtab/components/ThemeControls.tsx`
- Modify: `apps/extension/src/entrypoints/newtab/styles.css`

**Interfaces:**

- Change `ThemePreferences` to `{ mode: 'light' | 'dark' }`.
- Add `clearThemeBackgroundCache(): Promise<void>` for the named `tabstow-theme-backgrounds` cache.
- Make the first theme read perform the approved destructive migration before React mounts.

- [ ] **Step 1: Write failing migration and bootstrap tests**

Cover all of these cases:

- A legacy dark preference containing `paletteId`, `surfaceOpacity`, and `customBackground` returns `{ mode: 'dark' }`, deletes the complete theme background cache, and rewrites storage with only `mode`.
- Invalid and legacy `system` values normalize to light.
- Cache deletion failure does not mark migration complete; the next load retries.
- Cache Storage being unavailable is a safe no-op.
- Saving a mode ignores extra legacy fields.
- New Tab sets `data-theme-mode` before rendering the React tree, and toggling persists only the mode.
- Extra no longer renders Appearance controls.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
bun --cwd apps/extension run test -- src/features/theme/theme-preferences.test.ts src/features/theme/theme-background-cache.test.ts src/entrypoints/newtab/App.test.tsx
```

Expected: FAIL on the legacy fields, missing cache-wide cleanup, pre-render bootstrap, and removed controls.

- [ ] **Step 3: Implement the minimum destructive migration**

- Keep the existing `local:tabstow-theme-preferences` key.
- Read and normalize the legacy mode, clear the full named cache, then overwrite storage with `{ mode }`.
- Do not erase the legacy storage marker before cache cleanup succeeds.
- If cleanup rejects, apply a safe light mode for the current page, mount the local features with a persistent migration error, and leave legacy storage intact so the next New Tab retries.
- Await initial mode loading in `main.tsx`, set `document.documentElement.dataset.themeMode`, then mount React. Gate the uninitialized document in CSS so a saved dark mode never flashes light.
- Move the small runtime toggle state into `App.tsx` or a New-Tab-specific hook; do not preserve palette/background controller code.
- Leave the Options surface and its separate legacy settings schema untouched; the approved destructive migration applies only to New Tab visual personalization.

- [ ] **Step 4: Run focused tests and typecheck**

```bash
bun --cwd apps/extension run test -- src/features/theme/theme-preferences.test.ts src/features/theme/theme-background-cache.test.ts src/entrypoints/newtab/App.test.tsx
bun --cwd apps/extension run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/extension/src/features/theme apps/extension/src/entrypoints/newtab
git commit -m "refactor(theme): retire new tab personalization"
```

---

## Task 2: Add Real Tab State And Neutral Favicon Fallbacks

**Files:**

- Modify: `apps/extension/src/features/active-tabs/types.ts`
- Modify: `apps/extension/src/features/active-tabs/active-tabs-service.test.ts`
- Modify: `apps/extension/src/features/active-tabs/active-tab-windows.test.ts`
- Modify: `apps/extension/src/components/TabFavicon.tsx`
- Modify: `apps/extension/src/components/TabFavicon.test.tsx`
- Modify: `apps/extension/src/entrypoints/newtab/components/QuickLinks.tsx`
- Modify: `apps/extension/src/entrypoints/newtab/App.test.tsx`

**Interfaces:**

- Extend `ActiveBrowserTab` with Chrome's `audible` and `discarded` fields.
- Export or reuse one neutral page/browser glyph fallback for Active, Saved, History preview, search suggestions, and Quick Links.

- [ ] **Step 1: Write failing contract and fallback tests**

- Prove `active-tabs:snapshot` preserves `audible` and `discarded` returned by `browser.tabs.query`.
- Prove the Active window projection does not drop those fields.
- Change favicon failure expectations from title/domain initials to the neutral glyph.
- Cover supplied favicon failure, Chrome favicon failure, missing URL, failed custom Quick Link image, and Quick Link site-icon failure.
- Preserve explicit Quick Link emoji and successfully resolved uploaded images.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
bun --cwd apps/extension run test -- src/features/active-tabs/active-tabs-service.test.ts src/features/active-tabs/active-tab-windows.test.ts src/components/TabFavicon.test.tsx src/entrypoints/newtab/App.test.tsx
```

Expected: FAIL because the snapshot type lacks the fields and fallback still renders initials.

- [ ] **Step 3: Implement the contract without new messages or permissions**

- Add the two Chrome fields to the existing snapshot type. The service already passes Chrome tab objects through, so do not add a mapper or background message.
- Keep the existing safe URL and data-image validation cascade.
- Replace generated initials with one `aria-hidden` neutral glyph in the existing favicon frame.
- Reuse that fallback in Quick Links rather than creating a second visual rule.

- [ ] **Step 4: Run focused tests and typecheck**

```bash
bun --cwd apps/extension run test -- src/features/active-tabs/active-tabs-service.test.ts src/features/active-tabs/active-tab-windows.test.ts src/components/TabFavicon.test.tsx src/entrypoints/newtab/App.test.tsx
bun --cwd apps/extension run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/extension/src/features/active-tabs apps/extension/src/components/TabFavicon.tsx apps/extension/src/components/TabFavicon.test.tsx apps/extension/src/entrypoints/newtab
git commit -m "feat(newtab): expose real tab state and favicon fallback"
```

---

## Task 3: Establish V2 Modal, Feedback, And Shell Foundations

**Files:**

- Create: `apps/extension/src/entrypoints/newtab/components/ModalDialog.tsx`
- Create: `apps/extension/src/entrypoints/newtab/components/ModalDialog.test.tsx`
- Modify: `apps/extension/src/entrypoints/newtab/components/FormDialog.tsx`
- Modify: `apps/extension/src/entrypoints/newtab/components/FormDialog.test.tsx`
- Create: `apps/extension/src/entrypoints/newtab/components/NewTabFeedback.tsx`
- Create: `apps/extension/src/entrypoints/newtab/components/NewTabFeedback.test.tsx`
- Modify: `apps/extension/src/entrypoints/newtab/App.tsx`
- Modify: `apps/extension/src/entrypoints/newtab/App.test.tsx`
- Modify: `apps/extension/src/entrypoints/newtab/styles.css`
- Modify: `apps/extension/src/features/i18n/i18n.ts`
- Modify: `apps/extension/src/features/i18n/i18n.test.ts`

**Interfaces:**

- Add one reusable modal shell for Recovery, Sync, Sleep Policy, and existing form dialogs.
- Establish the V2 shell slots: Quick Links rail, sticky top strip, independently scrolling Active column, and independently scrolling Saved column.

- [ ] **Step 1: Write failing modal and shell contract tests**

- Modal initial focus, Tab/Shift+Tab focus wrap, Escape close, backdrop close, busy close suppression, and focus restoration.
- `FormDialog` retains submit/cancel behavior while using the shared modal semantics.
- New-Tab-local success feedback is non-blocking; New-Tab-local errors use an alert/live region without changing shared History feedback.
- App renders V2 shell/rail/top-strip/workspace landmarks and no V1 `page-shell`, `topbar`, or full-width Quick Links panel contract.
- All icon-only controls have localized accessible names.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
bun --cwd apps/extension run test -- src/entrypoints/newtab/components/ModalDialog.test.tsx src/entrypoints/newtab/components/FormDialog.test.tsx src/entrypoints/newtab/components/NewTabFeedback.test.tsx src/entrypoints/newtab/App.test.tsx src/features/i18n/i18n.test.ts
```

Expected: FAIL because the generic modal and V2 shell do not exist.

- [ ] **Step 3: Implement the shared primitives and structural CSS**

- Keep `ModalDialog` narrowly focused on semantics, focus, header/body/actions, and close policy.
- Make `FormDialog` compose it rather than duplicating dialog behavior.
- Introduce the approved fixed dark/light tokens, grid background, square/miter icon language, typography stacks, 150px-to-compressed rail, top strip, and 372px-to-compressed Saved column.
- At 1024px, keep all three regions and allow the Active window-bank grid to become one internal column.
- Give Quick Links, Active, and Saved their own scroll containers. Do not add mobile drawers or stacked panels.
- Add `prefers-reduced-motion` handling with no decorative long transitions.

- [ ] **Step 4: Run focused tests and typecheck**

```bash
bun --cwd apps/extension run test -- src/entrypoints/newtab/components/ModalDialog.test.tsx src/entrypoints/newtab/components/FormDialog.test.tsx src/entrypoints/newtab/components/NewTabFeedback.test.tsx src/entrypoints/newtab/App.test.tsx src/features/i18n/i18n.test.ts
bun --cwd apps/extension run typecheck
```

Expected: PASS. Pixel-level verification remains in Task 11.

- [ ] **Step 5: Commit**

```bash
git add apps/extension/src/entrypoints/newtab apps/extension/src/features/i18n
git commit -m "feat(newtab): establish v2 shell and dialog system"
```

---

## Task 4: Add Authoritative Stow Preview And Top-Bar Control States

**Files:**

- Modify: `apps/extension/src/features/tabs/session-service.ts`
- Modify: `apps/extension/src/features/tabs/session-service.test.ts`
- Modify: `apps/extension/src/lib/messages.ts`
- Modify: `apps/extension/src/lib/messages.test.ts`
- Modify: `apps/extension/src/entrypoints/background.ts`
- Modify: `apps/extension/src/tests/background.test.ts`
- Create: `apps/extension/src/entrypoints/newtab/components/StowCurrentWindowButton.tsx`
- Create: `apps/extension/src/entrypoints/newtab/components/StowCurrentWindowButton.test.tsx`
- Modify: `apps/extension/src/entrypoints/newtab/components/ActiveWorkspace.tsx`
- Modify: `apps/extension/src/entrypoints/newtab/App.tsx`
- Modify: `apps/extension/src/entrypoints/newtab/App.test.tsx`
- Modify: `apps/extension/src/features/i18n/i18n.ts`

**Interfaces:**

- Add `StowPreview = { eligibleTabCount: number }`.
- Add `sessions:stow-current-window-preview` routed to the existing session service eligibility rules.

- [ ] **Step 1: Write failing preview and button tests**

- Preview and real stow both use `sender.tab.windowId` when available and fall back to the last-focused normal window only when the sender window is unavailable. Both apply the same `includePinnedTabs` and URL eligibility rules.
- Preview returns zero without creating or closing anything.
- Message validation and background routing return the typed preview.
- Button disables at zero, shows the real count, blocks duplicate submission, shows indeterminate busy copy, and reports returned saved/closed counts including saved-but-not-closed partial success.
- No fabricated `0 / N` progress appears.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
bun --cwd apps/extension run test -- src/features/tabs/session-service.test.ts src/lib/messages.test.ts src/tests/background.test.ts src/entrypoints/newtab/components/StowCurrentWindowButton.test.tsx src/entrypoints/newtab/App.test.tsx src/features/i18n/i18n.test.ts
```

Expected: FAIL on the missing preview message/service/component.

- [ ] **Step 3: Implement using one eligibility source**

- Extract or reuse the session service's existing eligibility calculation; do not duplicate it in React.
- Implement preview as `getCurrentWindowStowPreview(windowId?: number)` and have the background route pass `sender?.tab?.windowId` for both preview and real stow. Test sender-window selection and the missing-sender fallback separately.
- Add the `ActiveWorkspace` authoritative-snapshot callback in this task, then refresh preview on mount/focus, that callback, and a stow result. Task 5 reuses the same callback for Unified Search.
- Keep the existing persistence-before-close behavior unchanged.
- Scope button busy state to the stow mutation while continuing to prevent conflicting session mutations.

- [ ] **Step 4: Run focused tests and typecheck**

```bash
bun --cwd apps/extension run test -- src/features/tabs/session-service.test.ts src/lib/messages.test.ts src/tests/background.test.ts src/entrypoints/newtab/components/StowCurrentWindowButton.test.tsx src/entrypoints/newtab/App.test.tsx src/features/i18n/i18n.test.ts
bun --cwd apps/extension run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/extension/src/features/tabs apps/extension/src/lib/messages.ts apps/extension/src/lib/messages.test.ts apps/extension/src/entrypoints/background.ts apps/extension/src/tests/background.test.ts apps/extension/src/entrypoints/newtab apps/extension/src/features/i18n
git commit -m "feat(newtab): add authoritative stow preview"
```

---

## Task 5: Replace Separate Searches With Unified Search

**Files:**

- Modify: `apps/extension/src/features/tab-search/tab-search.ts`
- Modify: `apps/extension/src/features/tab-search/tab-search.test.ts`
- Create: `apps/extension/src/entrypoints/newtab/components/UnifiedSearch.tsx`
- Create: `apps/extension/src/entrypoints/newtab/components/UnifiedSearch.test.tsx`
- Modify: `apps/extension/src/entrypoints/newtab/components/ActiveWorkspace.tsx`
- Modify: `apps/extension/src/entrypoints/newtab/App.tsx`
- Modify: `apps/extension/src/entrypoints/newtab/App.test.tsx`
- Delete: `apps/extension/src/entrypoints/newtab/components/SearchBox.tsx`
- Delete: `apps/extension/src/entrypoints/newtab/components/WorkspaceSearch.tsx`
- Modify: `apps/extension/src/features/i18n/i18n.ts`
- Modify: `apps/extension/src/entrypoints/newtab/styles.css`

**Interfaces:**

- Add a pure suggestion model containing source kind and stable Active/Saved identifiers.
- Let `ActiveWorkspace` report its latest authoritative snapshot to App without moving Chrome ownership into App.

- [ ] **Step 1: Write failing pure and component tests**

- Non-empty queries rank title prefix, title contains, then URL contains; preserve source order for ties; cap at five.
- Blank query renders no suggestions.
- Search filters Active and Saved, hides empty groups/windows/sessions, and disables reorder while non-empty.
- `/` outside editable fields focuses the input; Escape clears/returns complete collections.
- Enter in the input always sends `active-tabs:search` and never activates a local suggestion.
- Active suggestion click sends focus with exact tab/window IDs.
- Saved suggestion click sends consuming background-open with exact session/tab IDs and refreshes Saved/results after success.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
bun --cwd apps/extension run test -- src/features/tab-search/tab-search.test.ts src/entrypoints/newtab/components/UnifiedSearch.test.tsx src/entrypoints/newtab/App.test.tsx src/features/i18n/i18n.test.ts
```

Expected: FAIL on suggestion ranking, single-input orchestration, and removed old components.

- [ ] **Step 3: Implement the single source of query state**

- Keep query in App and continue passing it to the existing pure Active/Saved filters.
- Receive the latest unfiltered Active snapshot through a callback from `ActiveWorkspace` for suggestions and stow-preview refresh only.
- Keep suggestions as focusable buttons; Enter behavior is scoped to the input as approved.
- Remove the old web-search and workspace-search components after all consumers move.

- [ ] **Step 4: Run focused tests and typecheck**

```bash
bun --cwd apps/extension run test -- src/features/tab-search/tab-search.test.ts src/entrypoints/newtab/components/UnifiedSearch.test.tsx src/entrypoints/newtab/App.test.tsx src/features/i18n/i18n.test.ts
bun --cwd apps/extension run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/extension/src/features/tab-search apps/extension/src/entrypoints/newtab apps/extension/src/features/i18n
git commit -m "feat(newtab): add unified tab and web search"
```

---

## Task 6: Migrate Quick Links Into The Complete V2 Rail

**Files:**

- Create: `apps/extension/src/entrypoints/newtab/components/quick-links-dnd.ts`
- Create: `apps/extension/src/entrypoints/newtab/components/quick-links-dnd.test.ts`
- Modify: `apps/extension/src/entrypoints/newtab/components/QuickLinks.tsx`
- Modify: `apps/extension/src/entrypoints/newtab/App.test.tsx`
- Modify: `apps/extension/src/features/i18n/i18n.ts`
- Modify: `apps/extension/src/entrypoints/newtab/styles.css`

**Interfaces:**

- Add a Quick-Link-specific drag payload carrying a stable link ID.
- Reuse `quick-links:reorder`; do not change storage or synchronization schemas.

- [ ] **Step 1: Write failing rail and DnD tests**

- Normal mode renders all links, opens on row click, and cannot drag.
- Pencil toggles Edit mode.
- Edit mode suppresses navigation, uses the full row as drag source, resolves before/end destinations by ID, and persists exactly one ordered-ID message.
- Malformed, external, stale, no-op, and duplicate in-flight drops do not mutate.
- Completion/cancellation suppresses accidental navigation.
- Move Up/Move Down buttons are absent.
- Upload icon, edit, remove, add-by-URL, add-from-open-tab, emoji, custom image, and neutral fallback remain functional.
- An arbitrary-count list scrolls inside the rail while brand/utility controls remain fixed.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
bun --cwd apps/extension run test -- src/entrypoints/newtab/components/quick-links-dnd.test.ts src/entrypoints/newtab/App.test.tsx
```

Expected: FAIL because Quick Links still use cards and move buttons.

- [ ] **Step 3: Implement the rail manager**

- Keep existing dialogs and icon cache behavior.
- Convert only the presentation and reorder gesture; do not rewrite Quick Link persistence.
- Exclude row action buttons and hidden file input from drag initiation.
- Reload authoritative links after success and failure, matching existing mutation safety.

- [ ] **Step 4: Run focused tests and typecheck**

```bash
bun --cwd apps/extension run test -- src/entrypoints/newtab/components/quick-links-dnd.test.ts src/entrypoints/newtab/App.test.tsx src/features/quick-links/quick-links-storage.test.ts src/features/quick-links/quick-links.test.ts src/features/i18n/i18n.test.ts
bun --cwd apps/extension run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/extension/src/entrypoints/newtab/components/QuickLinks.tsx apps/extension/src/entrypoints/newtab/components/quick-links-dnd.ts apps/extension/src/entrypoints/newtab/components/quick-links-dnd.test.ts apps/extension/src/entrypoints/newtab/App.test.tsx apps/extension/src/entrypoints/newtab/styles.css apps/extension/src/features/i18n/i18n.ts
git commit -m "feat(newtab): migrate quick links into v2 rail"
```

---

## Task 7: Migrate Active Tabs And Full-Row Chrome Drag Surfaces

**Files:**

- Modify: `apps/extension/src/entrypoints/newtab/components/ActiveWorkspace.tsx`
- Modify: `apps/extension/src/entrypoints/newtab/components/ActiveWindowSection.tsx`
- Create: `apps/extension/src/entrypoints/newtab/components/WindowFilter.tsx`
- Delete: `apps/extension/src/entrypoints/newtab/components/GroupNav.tsx`
- Modify: `apps/extension/src/entrypoints/newtab/App.test.tsx`
- Modify: `apps/extension/src/features/i18n/i18n.ts`
- Modify: `apps/extension/src/entrypoints/newtab/styles.css`

**Interfaces:**

- Preserve `active-tabs-dnd.ts` semantic request resolution and all background move services.
- Add a local window-filter state: All plus one button per real visible Chrome window.

- [ ] **Step 1: Write failing Active interaction tests**

- All/focused/other window filters show real counts and hide nonselected windows; many filters scroll horizontally.
- Pinned lane, native group title/color/collapse state, physical tab order, and Close Group remain.
- Close Duplicates appears only when duplicates exist.
- Full tab row is draggable; normal row click focuses the exact tab; dragging never focuses; child Save/Sleep/Close buttons never focus or drag.
- Full group header is draggable while Close Group is excluded.
- Existing cross-window, cross-group, ungroup/group, pinned, incognito, no-op, pending, refresh-race, and failure tests still pass.
- Save for Later persists first and retains existing close behavior.
- `audible === true` shows the audible state. Only `discarded === true` shows Sleeping.
- Sleep control, bulk sleep, and policy UI never send a discard/wake mutation. Clicking Sleeping focuses the existing tab.
- Filtered search disables Active reorder.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
bun --cwd apps/extension run test -- src/entrypoints/newtab/components/active-tabs-dnd.test.ts src/entrypoints/newtab/App.test.tsx src/features/active-tabs/active-tab-moves.test.ts src/features/active-tabs/active-tabs-events.test.ts
```

Expected: FAIL on window filtering, full-row/header drag, and sleep/audible presentation.

- [ ] **Step 3: Rebuild presentation around existing authoritative movement**

- Remove visual drag handles but keep the current payloads, compatible targets, in-flight lock, post-mutation refresh, and Chrome-event debounce.
- Use native `draggable` threshold behavior and explicit post-drag click suppression.
- Keep action controls as buttons with `stopPropagation`/drag exclusion.
- Render disabled Sleep and bulk controls with localized reasons; render the Policy modal as informational content through `ModalDialog`.
- Do not add Chrome mutation code outside the background worker.

- [ ] **Step 4: Run focused and service tests**

```bash
bun --cwd apps/extension run test -- src/entrypoints/newtab/components/active-tabs-dnd.test.ts src/entrypoints/newtab/App.test.tsx src/features/active-tabs/active-tab-moves.test.ts src/features/active-tabs/active-tabs-events.test.ts src/features/active-tabs/active-tabs-service.test.ts src/features/i18n/i18n.test.ts
bun --cwd apps/extension run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/extension/src/entrypoints/newtab/components/ActiveWorkspace.tsx apps/extension/src/entrypoints/newtab/components/ActiveWindowSection.tsx apps/extension/src/entrypoints/newtab/components/WindowFilter.tsx apps/extension/src/entrypoints/newtab/App.test.tsx apps/extension/src/entrypoints/newtab/styles.css apps/extension/src/features/i18n/i18n.ts
git rm apps/extension/src/entrypoints/newtab/components/GroupNav.tsx
git commit -m "feat(newtab): migrate active tabs to v2 interactions"
```

---

## Task 8: Migrate Saved For Later And Add Recovery Bin Preview

**Files:**

- Modify: `apps/extension/src/entrypoints/newtab/components/StowedSessions.tsx`
- Create: `apps/extension/src/entrypoints/newtab/components/RecoveryBinDialog.tsx`
- Create: `apps/extension/src/entrypoints/newtab/components/RecoveryBinDialog.test.tsx`
- Modify: `apps/extension/src/entrypoints/newtab/App.tsx`
- Modify: `apps/extension/src/entrypoints/newtab/App.test.tsx`
- Modify: `apps/extension/src/features/i18n/i18n.ts`
- Modify: `apps/extension/src/entrypoints/newtab/styles.css`

**Interfaces:**

- Reuse `history:list` and `history:restore`; select `entries.slice(0, 5)` in New Tab.
- Preserve the existing Saved DnD semantic resolver, session messages, and History transactions.

- [ ] **Step 1: Write failing Saved and Recovery tests**

- Saved row click opens in the background and consumes to History; middle click opens without consuming; modified/right click behavior remains unchanged.
- Saved row exposes only Move to Recovery Bin, not duplicate Restore/Open.
- Full Saved row drag never opens the URL; full Session header drag never triggers Restore All or Move Session.
- In-session, cross-session, session reorder, stale payload, failed move reload, and filtered-search disable behavior remain.
- Session header shows real title/date/count, Restore All, and Move Session to Recovery Bin; no fake session ID, verified label, or storage meter.
- Restore All opens into the current focused window and retains the existing keep-session-on-failure behavior without adding rollback semantics.
- Recovery modal loads History, sorts potentially unordered input by `movedAt` descending with a stable ID tie-break, then takes five. It renders reason/source/time/count, covers loading/empty/error, restores the complete entry with per-entry busy state, refreshes Saved/History, and links to `/saved-history.html`.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
bun --cwd apps/extension run test -- src/entrypoints/newtab/components/saved-tabs-dnd.test.ts src/entrypoints/newtab/components/RecoveryBinDialog.test.tsx src/entrypoints/newtab/App.test.tsx src/entrypoints/saved-history/HistoryApp.test.tsx
```

Expected: FAIL on full-row/header drag and the missing Recovery preview.

- [ ] **Step 3: Implement by reusing existing messages**

- Remove Saved drag handles and make the full row/header container draggable; reject drag initiation only when the event starts from an interactive descendant.
- Keep primary/middle click message payloads unchanged.
- Keep permanent delete exclusively on the complete History page.
- Let App refresh sessions after Recovery restore; let the dialog reload History after success.
- Do not add a recent-History database query or message unless profiling proves the existing list is unsuitable.

- [ ] **Step 4: Run focused and repository/service tests**

```bash
bun --cwd apps/extension run test -- src/entrypoints/newtab/components/saved-tabs-dnd.test.ts src/entrypoints/newtab/components/RecoveryBinDialog.test.tsx src/entrypoints/newtab/App.test.tsx src/entrypoints/saved-history/HistoryApp.test.tsx src/db/db.test.ts src/features/tabs/session-service.test.ts src/features/i18n/i18n.test.ts
bun --cwd apps/extension run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/extension/src/entrypoints/newtab apps/extension/src/features/i18n/i18n.ts
git commit -m "feat(newtab): add v2 saved vault and recovery preview"
```

---

## Task 9: Add Compact Sync Diagnostics And Once-Per-Incident Prompting

**Files:**

- Create: `apps/extension/src/features/sync/sync-incident-acknowledgement.ts`
- Create: `apps/extension/src/features/sync/sync-incident-acknowledgement.test.ts`
- Modify: `apps/extension/src/entrypoints/newtab/components/NewTabSyncStatus.tsx`
- Create: `apps/extension/src/entrypoints/newtab/components/NewTabSyncStatus.test.tsx`
- Create: `apps/extension/src/entrypoints/newtab/components/SyncStatusDialog.tsx`
- Create: `apps/extension/src/entrypoints/newtab/components/SyncStatusDialog.test.tsx`
- Modify: `apps/extension/src/entrypoints/newtab/App.tsx`
- Modify: `apps/extension/src/entrypoints/newtab/App.test.tsx`
- Modify: `apps/extension/src/features/i18n/i18n.ts`
- Modify: `apps/extension/src/entrypoints/newtab/styles.css`

**Interfaces:**

- Add `derivePausedIncidentKey`, `getAcknowledgedIncidentKey`, `acknowledgeIncident`, and `clearAcknowledgement` using a dedicated local WXT storage key.
- Do not add sync background messages or write acknowledgement into the connection record.

- [ ] **Step 1: Write failing storage and UI tests**

- Incident key is derived from normalized paused state, action, and diagnostic reason/message.
- Dismissing stores the key; the same paused incident does not auto-open on a later mount.
- Changed action/reason is a new incident.
- Only a connected healthy running state (`synced`, `pending`, `syncing`, or `retrying`) clears acknowledgement so a later pause can prompt. Disconnected, authorizing, and setup states do not clear it.
- `needs-target` and `needs-confirmation` are prominent setup states but never auto-open the incident dialog.
- Dismissed paused -> setup/authorizing preserves acknowledgement; connected healthy -> clears it; a subsequent paused incident may then prompt again.
- The status button always manually opens details.
- Dialog shows only real account, binding, state, message, last success, retry time, and derived pending/local-safe information; missing fields say Unavailable.
- Reconnect/Rebind/Inspect controls call the existing Settings opener and never duplicate OAuth/Gist operations.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
bun --cwd apps/extension run test -- src/features/sync/sync-incident-acknowledgement.test.ts src/entrypoints/newtab/components/NewTabSyncStatus.test.tsx src/entrypoints/newtab/components/SyncStatusDialog.test.tsx src/entrypoints/newtab/App.test.tsx
```

Expected: FAIL on the missing acknowledgement store/dialog and current inline-only status.

- [ ] **Step 3: Implement the local acknowledgement boundary**

- Keep two simultaneously opened first-observer New Tabs as an accepted race; do not add a background lock or alter synchronization records.
- Auto-open only on `paused` after acknowledgement lookup.
- Preserve the top-bar error state after dismissing and allow manual reopen.
- Use `chrome.runtime.openOptionsPage()` for recovery/setup because Sync is already the primary Options workflow.

- [ ] **Step 4: Run focused and existing sync tests**

```bash
bun --cwd apps/extension run test -- src/features/sync/sync-incident-acknowledgement.test.ts src/entrypoints/newtab/components/NewTabSyncStatus.test.tsx src/entrypoints/newtab/components/SyncStatusDialog.test.tsx src/entrypoints/newtab/App.test.tsx src/features/sync/connection-store.test.ts src/features/sync/sync-coordinator.test.ts src/features/i18n/i18n.test.ts
bun --cwd apps/extension run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/extension/src/features/sync apps/extension/src/entrypoints/newtab apps/extension/src/features/i18n/i18n.ts
git commit -m "feat(sync): add new tab incident guidance"
```

---

## Task 10: Complete The One-Cutover App, I18n, And V1 Cleanup

**Files:**

- Modify: `apps/extension/src/entrypoints/newtab/App.tsx`
- Modify: `apps/extension/src/entrypoints/newtab/App.test.tsx`
- Modify: `apps/extension/src/entrypoints/newtab/components/TodosPanel.tsx`
- Modify: `apps/extension/src/entrypoints/newtab/index.html`
- Modify: `apps/extension/src/entrypoints/newtab/styles.css`
- Modify: `apps/extension/src/features/i18n/i18n.ts`
- Modify: `apps/extension/src/features/i18n/i18n.test.ts`
- Delete any remaining retired V1-only New Tab component or CSS hooks after confirming zero consumers.

**Final composition:**

- Left rail: brand, complete Quick Links manager, Extra, Settings.
- Top strip: Unified Search, language, fixed light/dark, compact sync status, Stow Current Window.
- Active column: title/readouts, disabled sleep controls/policy, window filter, Chrome-authoritative banks.
- Saved column: title/readouts, Recovery Bin, Saved Session vault.
- Extra modal/drawer: Todos only.

- [ ] **Step 1: Write the final App regression matrix before cleanup**

Cover at least:

- Dark/light and English/Chinese rendering and persistence.
- V2 shell landmarks and absence of V1 class/label contracts.
- Real loading, empty, error, busy, success toast, and persistent error states.
- Mutation locks are scoped: sync activity does not disable local Quick Links; a conflicting Saved/Active mutation still prevents duplicate submission.
- Extra contains Todos only, nested Todo form Escape behavior is correct, and Settings opens Options.
- Every icon-only action has localized accessible text; hover actions appear for `focus-within`.
- No prototype sample account/date/count/progress/storage text is present.
- No keyboard reorder controls are introduced.

- [ ] **Step 2: Run the final App/i18n tests and verify RED where V1 remains**

```bash
bun --cwd apps/extension run test -- src/entrypoints/newtab/App.test.tsx src/features/i18n/i18n.test.ts src/entrypoints/newtab/components/FormDialog.test.tsx src/entrypoints/newtab/components/ModalDialog.test.tsx
```

- [ ] **Step 3: Finish composition and delete only confirmed V1 orphans**

- Remove obsolete imports, components, selectors, test fixtures, and i18n keys created obsolete by this migration.
- Do not refactor unrelated Options, History, background, or sync code.
- Keep system/bundled fonts and Lucide; do not copy embedded prototype data images or load remote fonts.
- Ensure the source tree contains one New Tab implementation and no runtime V1/V2 switch.

- [ ] **Step 4: Run focused tests and typecheck**

```bash
bun --cwd apps/extension run test -- src/entrypoints/newtab/App.test.tsx src/features/i18n/i18n.test.ts src/entrypoints/newtab/components/FormDialog.test.tsx src/entrypoints/newtab/components/ModalDialog.test.tsx
bun --cwd apps/extension run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/extension/src/entrypoints/newtab apps/extension/src/features/i18n
git commit -m "refactor(newtab): complete v2 presentation cutover"
```

---

## Task 11: Automated Verification And Chrome Visual QA

**Files:**

- Modify: `docs/manual-qa.md`
- Modify only directly relevant tests or V2 code when verification exposes a real migration defect.

- [ ] **Step 1: Run whitespace and focused New Tab suites**

```bash
git diff --check
bun --cwd apps/extension run test -- src/entrypoints/newtab src/components/TabFavicon.test.tsx src/features/theme src/features/tab-search src/features/active-tabs src/features/tabs/session-service.test.ts src/entrypoints/saved-history/HistoryApp.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run the complete repository gates**

```bash
bun run test
bun run typecheck
bun run build
```

Expected: PASS, including built-extension verification and unchanged Manifest V3 permission policy.

- [ ] **Step 3: Verify packaged extension safety**

Inspect the built Chrome manifest and output:

- No new permission or host permission.
- No content script.
- New Tab, History, Options, and background entries are packaged locally.
- No remote scripts, styles, fonts, or executable assets.

- [ ] **Step 4: Run the desktop visual matrix**

Load the built extension and capture/compare the New Tab at:

- 1440px, 1180px, and 1024px widths.
- Light and dark modes.
- English and Simplified Chinese.
- Empty, typical, and long Quick Link/Active/Saved collections.
- Synced, retrying, paused, setup-needed, and unavailable sync details.

Verify all three regions remain visible, Active banks collapse internally when necessary, independent scrolling works, and no primary action is clipped.

- [ ] **Step 5: Run the interaction matrix in Chrome**

- Quick Links: Normal open; Edit add/edit/upload/remove/full-row reorder; long-list scroll.
- Active: row focus; Save for Later; Close; Close Group; Close Duplicates; tab/group cross-window drag; pinned/incognito rejection; filter disables drag; audible/discarded presentation; sleep UI never mutates.
- Saved: consuming left click; non-consuming middle click; tab/session full-row/header drag; cross-session move; Restore All; move to History.
- Search: local filtering and suggestions; `/`; Escape; Enter web search.
- Recovery: recent five, restore, refresh, full History link.
- Stow: zero/eligible counts, one-click busy, saved/closed partial result.
- Sync: paused auto-prompt once, manual reopen, healthy reset, setup-state Settings link.
- Todos/dialogs: focus containment, Escape, focus return, localized accessible names.

- [ ] **Step 6: Update manual QA and commit verification fixes/docs**

Record the V2 matrix in `docs/manual-qa.md`. If verification required code changes, rerun the smallest failing suite and all three repository gates before committing.

```bash
git add docs/manual-qa.md apps/extension
git commit -m "test(newtab): verify v2 migration"
```

## Completion gate

The implementation is complete only when:

- Every task checkbox is complete.
- `bun run test`, `bun run typecheck`, and `bun run build` pass.
- The Chrome visual and interaction matrix passes at 1440/1180/1024 in both themes and both languages.
- No V1 New Tab runtime path, retired personalization control, title/domain initial favicon fallback, fake prototype telemetry, or new extension permission remains.
- A subsequent pre-landing `review` reports no unresolved implementation, scope, or human-verification finding.
