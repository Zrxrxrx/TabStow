# New Tab V2 Frontend Migration Design

Status: approved for implementation planning; implementation not started

## Scope boundary

This document covers only the migration of the existing New Tab frontend to the approved `design/v2/index.html` experience. It does not authorize unrelated product work, backend redesign, release work, or changes to other extension surfaces unless a migration decision explicitly requires them.

## Source of truth

- Approved prototype: `design/v2/index.html`
- Existing production surface: `apps/extension/src/entrypoints/newtab/`
- Existing product language: `CONTEXT.md`

When those sources differ, this document's confirmed migration decisions take priority, followed by the prototype for visual composition and interaction language, followed by existing production behavior for underlying product semantics. Prototype sample content, counters, telemetry, and simulated success states are never production data requirements.

## Resolved decisions

### V2 replaces the New Tab presentation architecture

This is a full presentation migration rather than a CSS reskin of the existing screen. The New Tab component composition, layout, visual tokens, and interaction surfaces are rebuilt around `design/v2/index.html`; the old page structure is not treated as the visual scaffold.

Existing domain behavior, Chrome message contracts, storage, synchronization, and tested feature services remain the implementation foundation unless a resolved migration decision explicitly changes them. The migration therefore separates a new V2 presentation layer from stable product behavior instead of redesigning unrelated backend systems.

V2 replaces V1 in one verified cutover from the implementation branch. The shipped extension does not retain the V1 component tree, CSS, or a runtime V1/V2 feature flag. Source control provides rollback; the production UI does not maintain two New Tab implementations.

### The migration includes prototype-only behavior

The V2 prototype is both a visual and interaction target. This migration includes behaviors demonstrated by the prototype even when the current New Tab does not yet implement them, including the unified search experience, the Recovery Bin entry point, the compact synchronization recovery surface, and presentation of Chrome's real discarded-tab state. It does not imply that every simulated prototype behavior becomes functional.

This decision expands the migration beyond a presentation-only rewrite, but the scope remains limited to capabilities required to make the approved V2 New Tab experience real.

### Existing capabilities are preserved by default

Capabilities present in the current product but not visibly specified by the V2 prototype remain in scope and must not disappear silently. This includes Quick Link management, active and saved tab drag-and-drop, Todos, and the complete History experience. Advanced theme personalization is the explicit exception recorded below.

Each capability may be relocated or integrated into a V2 surface, and an explicitly superseded interaction may replace it, but removal requires a separate migration decision.

### Recovery Bin presents the existing History

Recovery Bin is a V2 New Tab entry point for the existing device-local History. It does not create a second recovery model and does not expand History to include arbitrary or Tabstow-initiated Active Tab closures.

Entries remain limited to Saved Tabs and Tab Sessions removed from Saved for Later through opening, restoration, or deletion. The prototype's “closed active tab by mistake” example is illustrative and is not part of this migration.

Clicking Recovery Bin opens a compact preview of the five most recent History entries ordered by `movedAt`. Each entry shows its real source context, reason, time, and tab count and restores the complete entry to Saved for Later using the existing History behavior. The modal includes loading, empty, error, and per-entry busy states and links to the complete existing History page for the full list and complete management experience.

### Unified search keeps web search as the Enter action

The V2 top search combines web queries with live filtering and suggestions for Active Tabs and Saved Tabs. Pressing Enter in the search input always submits the current query to the browser's default search engine.

Suggestions appear only for a non-empty query, rank title-prefix matches before title and URL substring matches, retain source order as the stable tie-breaker, and are limited to five. Clicking an Active suggestion focuses the original Chrome tab; clicking a Saved suggestion uses the existing consuming background-open behavior and refreshes affected results.

Pressing `/` outside an editable control focuses search. Enter while focus remains in the search input always sends the query to the browser's default web search engine; it does not silently convert into a selected local result. Escape closes suggestions and clears the active filter. Suggestions remain ordinary focusable buttons, but this version adds no special keyboard reordering behavior.

While a non-empty query filters either list, reordering in that filtered list is disabled. This preserves the current safeguard against ambiguous drop positions when some siblings are hidden.

### Stow Current Window remains a one-click action

The V2 primary stow control keeps the existing one-click workflow: it saves all eligible tabs from the currently focused normal Chrome window durably before attempting to close those tabs. Before activation it shows the real estimated eligible-tab count after applying current pinned-tab settings, is disabled when that count is zero, and while awaiting the background result is locked in an indeterminate busy state.

The UI does not animate a fabricated per-tab count because the current background operation does not stream progress. On completion it reports the returned saved and closed counts separately, including a partial outcome where the session was saved but Chrome could not close the tabs. This migration adds no confirmation preference or dialog.

### Tab sleep is presentation-only in this migration

The migration includes the V2 sleep-related layout, labels, states, and policy surface, but it does not implement `chrome.tabs.discard`, bulk discard, or background automatic sleep policy execution.

The New Tab displays a Sleeping Tab only when Chrome reports `discarded === true`. Exposing that fact requires the smallest necessary addition to the existing Active Tab snapshot contract, but adds no sleep mutation message. Sleep, wake, and bulk-sleep controls remain non-operational and explicitly unavailable, while the policy dialog is informational only. The production migration must not simulate successful memory release when no browser discard occurred.

### Settings owns synchronization recovery operations

The V2 New Tab displays compact synchronization status, diagnostics, pending-work information, and paused-state guidance. It binds only to real connection data: account, Gist binding, last successful synchronization, retry time, pending work, and local-safety state. Missing values display an explicit unavailable state; prototype telemetry and demo state buttons are not shipped. Recovery actions such as reconnecting GitHub, rebinding the Sync Gist, and inspecting the Sync File remain owned by Settings.

New Tab recovery controls navigate to the relevant Settings surface instead of duplicating authorization and binding workflows. Only the existing `paused` synchronization state is treated as an interrupting incident. Setup states such as `needs-target` and `needs-confirmation` remain prominent and link to Settings but do not auto-open an incident prompt.

### The left rail is the complete Quick Link manager

The V2 left rail displays the complete ordered Quick Link collection rather than a six-item summary. It must support an arbitrary current count and preserve the existing add, edit, reorder, remove, add-from-open-tab, and custom-icon capabilities.

The rail may scroll independently when the collection exceeds the available vertical space. Quick Link management remains in New Tab and is not moved wholesale to Settings.

The Quick Links heading includes a pencil control matching the current product's edit affordance. It switches the rail between Normal and Edit modes. Normal mode prioritizes opening shortcuts; Edit mode exposes management actions and the add flow. Quick Link field entry continues to use a popup dialog rather than inline rail forms.

In Edit mode, each Quick Link uses its full row as the mouse drag surface for reordering, does not navigate, and exposes the existing upload-icon, edit, and remove actions. The existing Move Up and Move Down buttons are removed from the V2 interface. Normal mode does not initiate Quick Link drag because a row click opens the shortcut. Add by URL and Add from Open Tab continue through focused dialogs.

### Active and Saved rows are directly draggable

Active Tab and Saved Tab rows use the full row as the drag surface instead of displaying a separate drag handle. A normal click retains the row's focus or open behavior; dragging begins only after pointer movement crosses a drag threshold, and completion or cancellation of a drag suppresses the row click. Interactive controls inside a row do not trigger row click or drag behavior.

Chrome group headers and Saved Session headers likewise use their full header area as the drag surface. Buttons and other interactive controls within those headers are excluded from drag initiation. A Saved Session's tab content is not part of the session drag surface, so dragging an individual Saved Tab remains unambiguous.

The migration preserves existing drag semantics: Active Tabs and Chrome groups may move between compatible real Chrome windows and lanes, subject to current pinned/incognito constraints; Saved Tabs may move between Saved Sessions; and Saved Session order remains synchronized. Only the gesture surface and V2 feedback are redesigned.

This version does not add keyboard reordering for Quick Links, Active Tabs, Chrome groups, Saved Tabs, or Saved Sessions. That limitation applies only to reordering; ordinary buttons, links, dialogs, row open/focus actions, and search remain keyboard-operable.

### Active Tab rows use a minimal, non-duplicative action set

An Active Tab row focuses its browser tab when the row is clicked, so it does not display a separate focus or restore action. When the row is hovered or receives keyboard focus, it exposes Save for Later, the disabled sleep status/control with an explanation of its unavailable state, and Close. Save for Later retains the existing service behavior: persist the Saved Tab first, then close the live tab when Chrome permits it.

Closing an Active Tab is labeled Close rather than Delete because it closes a live browser tab. Each action is an interactive control excluded from the row's click and drag gestures.

The V2 Active area continues to mirror real normal Chrome windows, the pinned lane, native groups, group color/title/collapse state, and Chrome tab-strip order. Window filters are generated from the current snapshot, begin with All, and scroll horizontally when necessary. Existing Close Group and Close Duplicates actions remain; Close Duplicates appears only when duplicate candidates exist.

### Saved Tab rows expose only the non-opening removal action

Clicking a Saved Tab row opens it using the existing consume behavior, so the row does not display a duplicate open or restore action. On hover or keyboard focus, it exposes only Move to Recovery Bin, which removes the Saved Tab without opening it and places it in the existing History.

The existing middle-click behavior remains available for opening a background copy without consuming the Saved Tab. Session-level Restore All remains a separate action because it acts on the complete saved session rather than duplicating the single-row action.

A Saved Session header displays only real title, creation time, and tab count. It keeps Restore All and Move Session to Recovery Bin as distinct actions, both excluded from header drag initiation. Decorative prototype session IDs, verification labels, and storage meters are omitted unless backed by real product data.

### Clicking a Sleeping Tab follows normal Active Tab behavior

Clicking a Sleeping Tab focuses its existing browser tab just like clicking any other Active Tab. Chrome controls the resulting reload of an actually discarded page, and the New Tab updates its presentation from subsequent real tab-state changes.

There is no separate wake workflow or confirmation prompt in this migration. The UI must not claim that the tab is awake before Chrome reports the changed state.

### Restore All keeps the existing current-window behavior

Restore All opens every tab from a Saved Session in the currently focused Chrome window and then moves the consumed session to History. The migration does not change the background restoration service to create a new window.

V2 copy must describe the current-window behavior and must not repeat the prototype's illustrative claim that restoration opened a new Chrome window.

### The three-column layout adapts down to 1024 pixels

The V2 desktop composition keeps Quick Links, Active Tabs, and Saved for Later visible as three columns from the prototype width down to a 1024-pixel viewport. Within that range, the side columns and inter-column spacing shrink within defined bounds while the information hierarchy and interaction model remain unchanged.

When the Active column can no longer support two comfortable window banks side by side, its internal bank grid becomes one column without collapsing any of the three primary page regions. Actions must remain reachable and may not be clipped to preserve a decorative width.

Below 1024 pixels, the page may overflow horizontally. This migration does not introduce collapsed drawers, stacked panels, or a mobile layout.

### Top-bar language and theme controls persist extension preferences

The New Tab language switch continues to save the existing device-local language preference rather than changing only one mounted page. The theme switch likewise updates the persisted New Tab light/dark mode.

The top bar is the complete V2 control for switching between English and Simplified Chinese and between light and dark mode. An existing `auto` language preference may still resolve from the browser language until the user first uses the toggle, after which the explicit selected language is persisted; V2 adds no separate Auto option.

### Extra remains the New Tab Todos drawer

The V2 Extra entry opens a restyled version of the existing New Tab utility drawer. The drawer preserves Todos and their current behavior, but no longer includes advanced appearance controls.

The separate Settings entry continues to open the extension Settings page. This migration does not relocate the removed New Tab appearance controls into Settings or split the Extra content into new dialogs.

### V2 retires New Tab visual personalization

V2 provides one fixed light art direction and one fixed dark art direction. The Paper, Sage, Mist, and Blush palettes, custom background image, and surface transparency controls no longer affect the New Tab and are removed from its interface. The fluorescent green accent remains part of both fixed modes.

This explicitly supersedes the earlier default that all existing advanced theme capabilities would be preserved. Light/dark mode itself remains a persisted preference and stays available from the top bar.

The migration deletes stored palette, surface-transparency, and custom-background values and removes any cached custom-background image. No backward compatibility, rollback preservation, or legacy rendering path is required for those retired settings. This is intentionally destructive: reverting the source code to V1 will not restore a deleted custom image.

### Missing favicons use a neutral page glyph

Active Tabs, Saved Tabs, History previews, search suggestions, and Quick Links use a real safe favicon or the user's uploaded Quick Link icon when available. If every valid icon candidate is missing or fails, the V2 favicon frame displays one consistent generic page/browser glyph.

V2 does not generate an uppercase title or domain initial as a substitute for a website icon. Icon failure remains visually neutral and does not imply a site identity that was not fetched.

### Active and Saved columns scroll independently

Below the shared sticky top bar, Active Tabs and Saved for Later each own their vertical scrolling region. This keeps both column headers and their primary controls available even when one collection is much longer than the other.

The Quick Links rail retains its separately scrolling collection as already decided. Keyboard focus and wheel input apply to the region under the pointer or the currently focused region, and drag auto-scroll is limited to the source list's scroll container.

### A synchronization incident prompts once

When New Tab first observes a `paused` synchronization incident, it automatically opens the compact recovery prompt. Dismissing the prompt leaves a prominent error-colored synchronization status in the top bar, which can reopen the details at any time.

The same uninterrupted incident does not automatically prompt again on subsequent New Tabs. The incident key is derived from the paused state and its recovery action/reason rather than the New Tab instance. Returning to a healthy state clears the acknowledged incident, and a later or materially changed paused failure may prompt again. The recovery prompt links to the relevant Settings workflow as previously decided.

## Shared interaction and state rules

- Production UI renders real state or an explicit unavailable/loading state; it never ships prototype sample counters, account names, dates, progress, storage percentages, or simulated success.
- Every collection and modal defines loading, empty, error, and busy presentation where applicable. A mutation locks only conflicting controls; unrelated local operations remain available.
- Successful operations use a non-blocking localized toast. Errors remain visible in the relevant region until the state changes or the user dismisses them and are announced through an appropriate live region.
- Dialogs trap focus, close with Escape when no destructive operation is in flight, restore focus to their trigger, and provide localized accessible names. Actions revealed on hover are also revealed by `focus-within`.
- Visual motion remains short and functional and respects `prefers-reduced-motion`.
- Real user-facing V2 copy, including headings, actions, states, empty states, dialogs, and toasts, is available in English and Simplified Chinese. Raw diagnostic detail from the background may remain verbatim, but its surrounding explanation is localized.

## Minimal service and data changes

- Add Chrome's real `discarded` state to the Active Tab snapshot used by New Tab; do not add discard/wake mutation messages.
- Reuse existing History list/restore messages for the five-entry Recovery Bin preview.
- Persist only the small acknowledgement needed to suppress repeat prompts for one uninterrupted paused synchronization incident.
- Migrate New Tab theme storage to retain only fixed light/dark mode and delete retired palette, opacity, custom-background token, and cached image data as explicitly approved.
- Keep existing session, active-tab movement, Saved ordering, Quick Link, Todos, synchronization, and Chrome message semantics otherwise unchanged.
- Add no extension permissions, content scripts, remote executable code, remote UI assets, or runtime-only Bun/Node APIs. Prototype typography uses the bundled/system font stack.

## Acceptance criteria

- At 1440, 1180, and 1024 pixel desktop widths, Quick Links, Active Tabs, and Saved for Later remain present without clipping primary controls; no mobile layout is introduced.
- Light and dark modes render without a wrong-theme flash, persist after reload, and match the approved V2 tokens. English and Simplified Chinese update every V2-owned visible string and persist after reload.
- Quick Links support arbitrary-count scrolling, open, add by URL, add from open tab, edit, custom icon, remove, and full-row mouse reorder in Edit mode.
- Active Tabs accurately show real normal windows, pinned tabs, Chrome groups, active/audible/discarded state, and Chrome ordering. Row click focuses; row/header drag never focuses; child actions never trigger row click or drag.
- Existing compatible cross-window Active Tab/group movement, pinned/incognito constraints, Close Group, Close Duplicates, Save for Later, and Close behavior remain correct. Reordering is disabled while filtered.
- Saved Tab left click opens in the background and consumes to History; middle click opens without consuming; removal enters History. Saved Tab cross-session movement, session reorder, Restore All, and session removal retain existing service behavior.
- Unified search filters both columns, hides empty containers, presents no more than five real suggestions, and sends Enter from the input to default web search. Clearing the query restores complete collections and drag capability.
- Recovery Bin lists the five newest real History entries, restores a complete entry, refreshes Saved and History, and opens the complete History page.
- Stow shows the estimated eligible count, prevents duplicate submission, and reports real saved/closed counts including partial close failure.
- Only a real discarded tab appears Sleeping; every sleep-related control avoids Chrome mutation and cannot display a fabricated success.
- Every existing synchronization state has a real-data presentation. One uninterrupted paused incident prompts once, healthy recovery permits a future prompt, and recovery/setup actions open the relevant Settings workflow.
- Dialog focus, localized accessible names, focus-visible row actions, loading/empty/error/busy states, and reduced-motion behavior pass interaction review. Keyboard reordering remains explicitly outside this version.
- Existing focused tests are adapted rather than discarded, new V2 interaction/data-cleanup tests are added, and `bun run test`, `bun run typecheck`, and `bun run build` pass before manual Chrome QA.

## Review status

The delegated review found no unresolved major decision. Its only destructive concern was deletion of legacy visual-personalization data; the user explicitly confirmed deletion with no compatibility requirement. The user approved this migration design on 2026-07-13; implementation still requires an implementation plan and engineering review.
