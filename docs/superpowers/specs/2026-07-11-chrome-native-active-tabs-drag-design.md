# Chrome-Native Active Tabs Drag Design

Date: 2026-07-11
Status: Approved for specification review

## Context

Tabstow currently reads open tabs from every Chrome window, but its Active Tabs view does not mirror Chrome's structure. Tabs without native Chrome group metadata fall back to local manual groups, homepage classification, or URL-domain classification. Persisted `groupOrder` and `groupTabOrder` values can also override Chrome's physical tab order. The existing Chrome integration is only partly bidirectional: Chrome changes refresh the dashboard, while Tabstow writes only legacy manual-group mappings back to Chrome.

The requested behavior is for Active Tabs to use Chrome as its only source of truth, remove URL-based grouping, and support direct drag-and-drop reordering across tabs, native groups, and normal Chrome windows.

## Goals

- Render Active Tabs by normal Chrome window instead of URL, homepage, or local manual grouping.
- Preserve Chrome's tab-strip order within each window.
- Make tabs draggable within a group, between grouped and ungrouped positions, and across normal Chrome windows.
- Make native Chrome tab groups draggable within a window and across normal Chrome windows.
- Write every drag result to Chrome first, then refresh from Chrome before treating it as committed.
- Reflect changes made directly in Chrome while the dashboard remains open.
- Remove the legacy local manual-group, local-order, mapping, and import behavior from the Active Tabs runtime.
- Preserve existing focus, close, stow-one-tab, close-group, collapse-group, refresh, and duplicate-closing behavior where it does not conflict with Chrome-native ordering.

## Non-Goals

- No local optimistic ordering or persistent Active Tabs mirror.
- No URL, hostname, homepage, or landing-page display classification.
- No creation of a new Chrome group by dropping one ungrouped tab onto another; that gesture reorders tabs.
- No merging of two Chrome groups by dropping one group onto another.
- No group rename or color editing in Tabstow.
- No pin or unpin action through drag-and-drop. Pinned state is preserved.
- No support for popup, app, DevTools, or other non-normal Chrome windows.
- No content scripts, new extension permissions, remote code, or Bun/Node APIs in extension runtime code.
- No migration of legacy local manual groups into Chrome.
- No redesign of Saved for Later, Quick Links, Todos, sync, or options.

## Selected Approach

Use Chrome-confirmed native HTML drag-and-drop:

1. The dashboard reads a raw Chrome snapshot containing normal-window metadata, visible active tabs, and native tab-group metadata.
2. A pure projection builds ordered window sections from that snapshot.
3. Native drag events produce a semantic destination anchored to a current tab or group rather than a trusted numeric index.
4. The dashboard sends the requested move to the background service worker.
5. The background re-queries Chrome, validates the source and destination, computes current indices, and calls `chrome.tabs.move`, `chrome.tabs.group`, `chrome.tabs.ungroup`, or `chrome.tabGroups.move` as required.
6. The dashboard refreshes from Chrome after either success or failure. Chrome API events also schedule a debounced refresh.

This keeps Chrome authoritative, adds no drag-and-drop dependency, and avoids reconciling a second persistent ordering model.

## Source Of Truth And Legacy State

Active Tabs must stop reading or updating the existing local active-workspace state:

- `manualGroups`
- `order.groupOrder`
- `order.pinnedGroupKeys`
- `order.groupTabOrder`
- `chromeTabGroups.enabled`
- `chromeTabGroups.mappings`

The runtime must not import, sync, or migrate those values. Existing stored values may remain inert in extension storage, but they must have no effect on rendering or Chrome mutations. The old Import Chrome Groups action and Move to Domain Group action are removed.

The URL-based duplicate detector remains because it powers an explicit duplicate-closing action rather than display grouping.

## Snapshot Model

The Active Tabs snapshot adds normal Chrome window metadata to the existing tabs and tab-group metadata. Only windows with a numeric ID and `type === "normal"` participate. The focused window renders first, and remaining windows sort by numeric window ID. Windows with no visible eligible tabs are omitted. Rendered sections receive labels such as `Current window`, `Window 2`, and `Window 3` based on that display order.

The active-tab listing continues to exclude browser-internal URLs, extension URLs, and tabs without a usable URL. These hidden tabs are not drag sources or visible drop targets. The background must nevertheless re-query the complete target window before a mutation so its calculated Chrome index remains correct when hidden tabs occupy positions in the real tab strip.

The raw snapshot remains separate from the derived UI projection. The projection contains:

- A window ID and focused-state flag.
- A pinned-tab lane, ordered by `tab.index`.
- An ordered sequence of top-level unpinned items.
- A top-level item that is either one ungrouped tab or one native Chrome group containing its visible tabs.

Top-level items are ordered by their first visible Chrome tab index. Ungrouped tabs remain individual top-level items, so they can appear before, between, or after native groups exactly as they do in Chrome. A native group's tabs are ordered by `tab.index`.

Chrome group identity is the pair `(windowId, groupId)`. A grouped tab must remain grouped by its Chrome `groupId` even if group metadata is temporarily unavailable. In that case, the projection uses a fallback title such as `Chrome group 31`; it must never fall back to a URL-derived title or grouping.

Pinned tabs are rendered in their own lane because Chrome does not allow pinned tabs inside tab groups. A pinned tab may be reordered within a pinned lane or moved to another normal window's pinned lane. An unpinned tab cannot be dropped into a pinned lane, and a pinned tab cannot be dropped into an unpinned lane or group.

## Active Tabs UI

The Active Tabs panel contains:

- Its existing title and visible-tab count.
- Updated helper copy explaining that the view mirrors Chrome windows and groups.
- Existing refresh, collapse-groups, and close-duplicates actions.
- No Import Chrome Groups action.
- Navigation shortcuts for windows and native groups.
- One section per normal Chrome window with a visible-tab count and a Current Window marker when focused.
- A pinned lane when the window contains visible pinned tabs.
- Ungrouped tab rows and Chrome group cards in physical tab-strip order.

Native group cards retain their Chrome title, color, collapsed metadata, tab count, and close action. Collapsed metadata is displayed as group status, but Active Tabs remains a management view and continues to show the group's tab rows. The existing Collapse Chrome Groups action still updates Chrome, and the resulting state returns through the snapshot.

Each draggable tab row and group header receives a dedicated visual drag handle so focusing or activating a tab does not accidentally begin a drag. During a drag, valid targets show a highlight and exact insertion points show an insertion line. Invalid targets do not accept the drop. A single in-flight move disables further drops until Chrome responds and the view refreshes.

## Drag Semantics

### Tab Moves

A tab may be dropped:

- Before or after another tab in the same ungrouped area.
- Before or after another tab in its current Chrome group.
- Before or after a tab in a different Chrome group.
- Onto a native group header, which appends it to that group.
- Into an ungrouped insertion point, which removes native group membership.
- Into a compatible lane in another normal Chrome window.

Moving into a native group sets the target group's membership and positions the tab at the requested location. Moving to an ungrouped destination removes existing group membership. Cross-window moves first establish the target window, then establish the requested group membership, then re-query and position the tab precisely.

Dropping an ungrouped tab next to another ungrouped tab only reorders it. It does not create a group. Dropping a tab at its effective current position is a successful no-op and must not call mutating Chrome APIs.

Pinned tabs preserve `pinned: true`. They may only target pinned lanes. Unpinned tabs preserve `pinned: false` and may only target unpinned positions and groups.

### Group Moves

A native Chrome group may be dropped at a top-level insertion point in its current normal window or another normal Chrome window. The operation moves the complete group through `chrome.tabGroups.move`. A group cannot be dropped inside another group, and adjacent groups remain distinct.

The UI offers group insertion targets only between complete top-level items. It must never request an index that splits another Chrome group.

## Semantic Drop Destinations

The UI must not send a numeric Chrome index calculated from its possibly stale snapshot. Move messages identify:

- The source tab ID or group ID.
- The destination normal window ID.
- The destination lane: pinned, ungrouped, or a specific native group.
- An optional anchor item: a tab ID or native group ID.
- Whether the source belongs before or after that anchor, or at the end of the lane/window.

The background resolves the anchor against a fresh `chrome.tabs.query({ windowId })` result. For a group anchor, it uses the first or last current tab index of the complete group depending on the requested edge. It adjusts for the source's current position and re-queries after any window or group-membership change before applying the final move.

If the source, anchor, target window, or target group no longer exists, the background returns a normal Chrome-tabs error instead of guessing a replacement destination.

## Background Operations

The message contract adds two commands:

- `active-tabs:move-tab`
- `active-tabs:move-group`

The service worker owns every mutating Chrome call. The new operations return a small success result; the UI then requests a fresh snapshot. Existing focus, close, search, collapse, and session commands retain their current ownership.

Tab moves follow the minimum required sequence for the requested destination:

1. Validate the source tab and destination against fresh Chrome state.
2. Move the tab to the destination window if required.
3. Group or ungroup it if required.
4. Re-query the target window.
5. Resolve the semantic anchor and move the tab to its final index if it is not already there.

Group moves validate the complete target boundary, then call `chrome.tabGroups.move` with the destination window and a non-splitting index.

## Live Chrome-To-Tabstow Refresh

While Active Tabs is mounted, it schedules a debounced snapshot refresh for:

- `tabs.onCreated`
- `tabs.onUpdated`
- `tabs.onRemoved`
- `tabs.onMoved`
- `tabs.onAttached`
- `tabs.onDetached`
- `tabs.onActivated`
- `tabs.onReplaced`
- `tabGroups.onCreated`
- `tabGroups.onUpdated`
- `tabGroups.onRemoved`
- `tabGroups.onMoved`
- `windows.onCreated`
- `windows.onRemoved`
- `windows.onFocusChanged`

The existing short debounce remains so one Chrome operation can coalesce its related tab, group, and window events. Component cleanup removes every listener and pending timer. Refresh generations prevent an older snapshot from replacing a newer one.

Explicit post-mutation refresh and event-driven refresh may overlap; both read Chrome, and generation checks ensure only the newest completed request updates the view.

## Error Handling And Concurrency

- Only one drag mutation may be in flight from the Active Tabs view.
- A failed mutation reports through the existing status surface and always triggers a fresh snapshot.
- A disappeared source or anchor is reported as an error; the background does not redirect the move.
- Chrome's temporary `Tabs cannot be edited right now` error is shown without an unbounded retry loop. The user may retry after the refresh.
- A partially completed cross-window or membership change is not rolled back with stale local state. The immediate refresh shows Chrome's actual result.
- Native events caused by Tabstow mutations are expected and are coalesced by the existing debounce.
- Snapshot metadata is not assumed to be atomic. Missing group metadata uses the group-ID fallback, and the next event or explicit refresh can restore its title and color.

## Expected Code Boundaries

- `apps/extension/src/features/active-tabs/types.ts`
  - Add window metadata, ordered-window projection, drag-source, and semantic-destination types.
  - Remove manual, URL-display-group, local-order, and mapping types from the Active Tabs path.

- `apps/extension/src/features/active-tabs/active-tab-groups.ts`
  - Replace URL/manual grouping with the pure Chrome-window projection, or split it into a clearly named window-projection module.
  - Preserve duplicate URL detection independently.

- `apps/extension/src/features/active-tabs/active-tabs-service.ts`
  - Read normal-window metadata.
  - Add fresh-state tab move, group, ungroup, and anchor-resolution operations.

- `apps/extension/src/features/chrome-tab-groups/chrome-tab-groups.ts`
  - Remove manual-group sync/import behavior.
  - Retain collapse behavior and add or delegate native group moves.

- `apps/extension/src/features/active-tabs/active-workspace-storage.ts`
- `apps/extension/src/features/active-tabs/manual-groups.ts`
  - Remove these modules and their runtime usage when no consumers remain.

- `apps/extension/src/lib/messages.ts`
- `apps/extension/src/entrypoints/background.ts`
  - Add typed tab/group move commands and route them to background services.

- `apps/extension/src/entrypoints/newtab/components/ActiveWorkspace.tsx`
  - Render the Chrome-window projection.
  - Own only snapshot, pending-operation, and transient drag state.
  - Add native drag handlers and the complete Chrome event subscription set.

- `apps/extension/src/entrypoints/newtab/components/GroupNav.tsx`
  - Adapt navigation from URL/manual groups to Chrome windows and native groups.

- `apps/extension/src/entrypoints/newtab/styles.css`
  - Add window, pinned-lane, drag-handle, drop-target, and insertion-line styling.

- `apps/extension/src/features/i18n/i18n.ts`
  - Remove obsolete domain/import copy and add window, pinned, drag, and fallback-group copy.

- `README.md`
  - Replace domain/homepage/manual-group QA with Chrome-window and drag synchronization QA.

## Testing

Use test-driven development for every behavior change.

### Projection Tests

- The same URL and different URLs never create display groups.
- Multiple normal windows remain separate.
- The focused window renders first.
- Pinned tabs remain in an ordered pinned lane.
- Ungrouped tabs can appear before, between, and after Chrome groups.
- Native groups are keyed by `(windowId, groupId)` and ordered by their first tab index.
- Group tabs remain ordered by `tab.index`.
- Missing group metadata produces a Chrome-group fallback and never a URL group.
- Legacy manual assignments and local order cannot influence the projection.
- Duplicate URL detection remains unchanged.

### Background Service Tests

- Same-lane tab reorder.
- Same-group tab reorder.
- Ungrouped tab moved into a native group.
- Grouped tab moved to an ungrouped position.
- Tab moved between native groups.
- Compatible tab moved across normal windows.
- Pinned tab moved within and across pinned lanes.
- Invalid pinned/unpinned target rejection.
- No-op drop without mutation calls.
- Anchor re-resolution from fresh target-window tabs.
- Disappeared source, anchor, group, and window failures.
- Chrome API rejection after a partial structural move.
- Native group reorder and cross-window move without splitting another group.

### Message And Component Tests

- Move commands are accepted and routed by the service worker.
- Native tab drag data produces the expected semantic move message.
- Native group drag data produces the expected semantic move message.
- Valid targets highlight and invalid targets reject the drop.
- A pending move blocks duplicate drops.
- Success and failure both request a fresh snapshot.
- Every subscribed Chrome event schedules a debounced refresh.
- Unmount removes every listener and pending timer.
- Older snapshot requests cannot overwrite newer state.
- Existing focus, close, group-close, collapse, duplicate-close, and stow-one-tab flows continue to pass.

### Automated Verification

Run from the repository root:

```bash
bun run test
bun run typecheck
bun run build
```

### Manual Chrome QA

1. Load the unpacked MV3 extension.
2. Open two normal Chrome windows with pinned, ungrouped, and grouped web tabs.
3. Confirm the focused window appears first and each window matches Chrome's visible eligible-tab order.
4. Reorder an ungrouped tab, reorder within a group, move into a group, move out of a group, and move between groups.
5. Move pinned and unpinned tabs across compatible lanes in the two windows.
6. Reorder a complete Chrome group and move it to the other window.
7. Change tab order, membership, group order, title, color, collapsed state, and window focus directly in Chrome; confirm the open dashboard refreshes.
8. Confirm invalid pinned/group targets cannot be dropped onto.
9. Close a drag target during a drag and confirm an error appears and the dashboard returns to Chrome's actual state.
10. Reload the extension and confirm no legacy local order or manual group reappears.

## Risks

- Chrome can emit several events for one structural operation. Debouncing and refresh generations must prevent stale UI without suppressing the final state.
- Moving a tab across a window and then changing group membership is not transactional. A mid-sequence failure can leave a valid but partially moved Chrome state; refreshing from Chrome is safer than attempting a stale rollback.
- Hidden internal or extension tabs create gaps in visible indices. Mutation code must resolve anchors against all current tabs in the target window.
- Cross-window group moves may emit remove/create events instead of a simple move event. No persistent group identity may be assumed after the operation.
- Native HTML drag-and-drop is targeted at desktop Chrome and does not add a touch-first interaction model.
