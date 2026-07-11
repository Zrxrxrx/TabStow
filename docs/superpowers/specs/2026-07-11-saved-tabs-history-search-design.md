# Saved Tabs History, Deduplication, And Search Design

Date: 2026-07-11
Status: Approved for planning

## Context

Tabstow already mirrors live Chrome windows and native tab groups in the Active tabs panel, stores Saved for later as session groups in IndexedDB, and refreshes active state automatically from Chrome tab, group, and window events. The Active tabs panel still exposes two manual controls that duplicate or conflict with this default behavior: `Refresh from Chrome` and `Collapse Chrome groups`.

Saved tabs are currently plain links. Opening an individual saved tab does not consume it, there is no history or recovery path, saved URLs can be duplicated across sessions, and saved sessions or tabs cannot be reordered. Active rows also render initials even though Chrome provides favicon data. The two panels sit in a grid, but they do not share a tab-focused search surface.

## Goals

- Remove the `Refresh from Chrome` and `Collapse Chrome groups` controls while preserving automatic Chrome-driven refresh.
- Deduplicate Saved for later globally by normalized URL, with the newest saved copy winning.
- Make individual saved-tab and whole-session restore consume Saved entries while retaining them in a local History recycle bin.
- Distinguish primary and middle clicks on saved tabs without navigating away from Tabstow.
- Add a simple extension-local History page with restore, background-open, and permanent-delete actions.
- Add a shared quick tab search above Active tabs and Saved for later.
- Give Active tabs real site favicons with a text fallback.
- Bring Saved for later closer to Active tabs visually and behaviorally with draggable session groups, draggable tab rows, and recoverable delete actions.

## Non-Goals

- No History synchronization through Gist.
- No event-sourcing or general undo framework.
- No content scripts, broad host permissions, remote executable code, or Node/Bun-only APIs in extension runtime code.
- No change to the existing topbar web search; quick tab search is a separate local filter.
- No automatic expiry or capacity limit for History.
- No History drag-and-drop or grouping tools.
- No redesign of active Chrome grouping or active-tab drag behavior.

## Selected Approach

Upgrade the existing Dexie database to add a dedicated History table and explicit saved-session ordering. Put all multi-record Saved and History mutations behind atomic data-layer operations invoked through background messages. Keep History local-only, and apply deterministic URL deduplication both when saving locally and after importing sessions from Gist.

This approach keeps the current session model, gives the recycle-bin behavior a clean boundary, and avoids encoding History as a special saved session.

## URL Deduplication

Saved for later is globally unique by normalized URL. Normalization must:

- parse the URL with the platform `URL` implementation;
- lowercase the scheme and hostname through normal URL serialization;
- remove default ports;
- remove the fragment/hash;
- preserve the path and query string;
- treat the normalized serialized URL as the deduplication key.

Within one incoming save batch, the last occurrence of a normalized URL wins. Across existing Saved sessions, the newly saved copy wins: matching tabs are removed from older sessions and placed in the newly created session. Any session emptied by deduplication is deleted.

After Gist import and merge, the same global invariant is applied deterministically. For duplicate URLs already present in imported data, the tab belonging to the most recently updated session wins; ties use the newer tab `createdAt`, then stable session and tab IDs so all devices derive the same result. History records do not participate in Saved deduplication.

Restoring a History record creates a new Saved session at the top of the saved ordering. Its restored tabs become the newest copies, so matching URLs are removed from other Saved sessions.

## Data Model And IndexedDB Migration

The IndexedDB schema moves from version 1 to version 2.

Saved sessions gain an explicit numeric `sortOrder`. Existing sessions are migrated in their current newest-first order. Lower values represent earlier display positions. New sessions are inserted at the top, and drag operations rewrite the affected order values.

History uses a dedicated table. A History entry represents either one consumed/deleted tab or one consumed/deleted session and contains:

- a stable History entry ID;
- the source session ID and title when available;
- the saved tabs and their order;
- the original session creation time;
- the time the entry moved to History;
- a reason: `opened`, `restored`, or `deleted`;
- the originating device ID.

History entries are sorted newest first by the time they entered History. They remain until the user restores or permanently deletes them.

The data layer provides atomic operations for:

- saving a new session while globally deduplicating URLs;
- opening and consuming one saved tab;
- restoring and consuming an entire saved session;
- moving one tab or session to History through delete;
- restoring a History entry to a new Saved session;
- permanently deleting a History entry;
- reordering saved sessions;
- reordering tabs within a session;
- moving a tab between sessions.

When a mutation removes the final tab from a session, the empty session is deleted in the same transaction.

## Saved Open, Restore, And Delete Semantics

All saved-tab opening is performed by the extension background using `chrome.tabs.create({ url, active: false })`. The Tabstow page remains active.

Primary click on a saved tab:

1. Create the Chrome tab in the background.
2. If creation succeeds, atomically remove the saved tab and insert a one-tab History entry with reason `opened`.
3. If Chrome tab creation fails, leave Saved and History unchanged and report the error.

Middle click on a saved tab:

1. Prevent the browser's default link behavior.
2. Create the Chrome tab in the background.
3. Leave Saved and History unchanged.

Session-level `Restore all`:

1. Create every session tab in the background, preserving pinned state where supported.
2. Only after all creates succeed, atomically remove the session and insert one History entry containing the complete session with reason `restored`.
3. If any create fails, keep the Saved session. Tabs already created during the failed attempt may remain open; the UI reports the partial failure rather than risking data loss.

Saved delete actions are recoverable:

- deleting one tab moves it into a one-tab History entry with reason `deleted`;
- deleting a whole session moves the complete session into one History entry with reason `deleted`;
- only the History page exposes permanent deletion.

## History Page

History is a separate extension-local page linked from the workspace container. It is intentionally a simple recycle bin.

Each History entry shows its moved-to-History time, reason, source session context, and the contained tab rows. Each tab row displays favicon, title, and URL.

Available actions are:

- `Restore to Saved for later`, which restores the whole History entry as a new saved session and removes the History entry after the Saved transaction succeeds;
- `Open`, which opens an individual History tab in a background Chrome tab without changing History;
- `Delete permanently`, which deletes the complete History entry after a confirmation step.

History has no drag-and-drop, grouping, sync, or automatic retention policy.

## Workspace Search And Layout

Active tabs and Saved for later are wrapped in a shared workspace container. The container header contains:

- a quick tab search input;
- a History navigation action.

The existing topbar web search remains unchanged. The new input filters locally and never invokes a search engine.

Quick tab search matches case-insensitively against tab title and URL:

- Active tabs keep their current Chrome window and native group structure, but hide nonmatching tabs and hide empty groups/windows.
- Saved sessions hide nonmatching tabs and hide sessions with no matches.
- Clearing the input restores the complete view.
- Drag-and-drop is disabled while a query is active so the user cannot reorder a filtered projection.

Search affects only rendering; it does not mutate Chrome tabs, Saved sessions, or History.

## Active And Saved Tab Presentation

Active and Saved rows use the same visual vocabulary: drag handle when applicable, favicon, title, URL, and trailing actions.

Active rows use `favIconUrl` supplied by Chrome when it is safe to display. HTTP and HTTPS tabs may fall back to Chrome's extension favicon endpoint. Image errors fall back silently to a title initial.

Saved rows continue to use Chrome's favicon endpoint for safe HTTP and HTTPS URLs with the same text fallback. Shared favicon logic should be extracted only if it reduces duplication without coupling live Chrome actions to saved-data actions.

The Active tabs action toolbar containing `Refresh from Chrome` and `Collapse Chrome groups` is removed. Initial loading, explicit refresh calls required after mutations, and the debounced Chrome event subscription remain in place.

## Saved Drag And Drop

Saved for later supports three persisted drag operations:

- reorder whole session groups;
- reorder a tab inside its current session;
- move a tab into another session at a specific position.

Moving a tab between sessions preserves the tab record. If the source session becomes empty, it is deleted. Drag operations use a Saved-specific payload and data service; they do not reuse active Chrome tab drag messages or Chrome movement code.

Dragging is disabled while another saved mutation is pending or while quick tab search is active.

## Background Message Boundary

The UI does not write IndexedDB directly. New background message operations cover:

- listing History;
- primary-open-and-consume of one saved tab;
- non-consuming background-open of a Saved or History tab;
- restore-and-consume of one saved session;
- move one saved tab or session to History;
- restore or permanently delete one History entry;
- reorder saved sessions;
- reorder or move a saved tab.

Responses return enough updated data or counts for the UI to reload Saved and History state through their list operations. Duplicate or concurrent requests are guarded by the existing busy-action pattern and data-layer transactions.

## Gist Sync Boundary

History remains local-only and is excluded from the sync schema and document.

Saved session import applies global URL deduplication after the existing merge. Export should therefore observe a deduplicated local Saved state. This design does not add History records or History deletions to Gist.

Because the existing sync model merges sessions by ID without tombstones, remote copies of previously shortened sessions could otherwise reintroduce tabs. Deduplication protects the global URL invariant, but it cannot express all deletions across devices. Cross-device deletion tombstones remain outside this feature; the local recycle-bin behavior is authoritative only on the current device.

## Error Handling

- Chrome background-tab creation failures leave Saved and History unchanged.
- A failed History restore leaves the History entry intact.
- Transaction failures leave all participating Saved and History records unchanged.
- A failed drag operation reloads the authoritative Saved state and reports the error.
- Invalid URLs are never opened and produce the existing structured extension error shape.
- Favicon failures fall back silently to title initials.
- Gist parse and transport failures keep the current local database unchanged.
- A partially failed `Restore all` keeps the Saved session and reports that some tabs may already have opened.

## Testing And Verification

Automated tests cover:

- URL normalization, including hashes, default ports, query preservation, and invalid URLs;
- newest-copy-wins deduplication within a batch, across sessions, and after Gist import;
- IndexedDB version 2 migration and explicit saved-session ordering;
- atomic saved-tab and saved-session moves into History;
- cleanup of empty sessions;
- History restore and permanent deletion;
- primary click opening in a background tab and consuming the saved item;
- middle click opening in a background tab without consuming it;
- session restore behavior and partial Chrome-create failure handling;
- saved session reorder, in-session tab reorder, and cross-session moves;
- quick search filtering across Active and Saved while retaining group structure;
- disabled drag while quick search is active;
- Active and Saved favicon fallbacks;
- History page actions;
- absence of `Refresh from Chrome` and `Collapse Chrome groups` controls while automatic refresh remains subscribed;
- message validation and background routing for all new operations;
- History exclusion from Gist documents.

Run:

```bash
bun run test
bun run typecheck
bun run build
```

Manual Chrome QA:

- Confirm Active tabs updates after Chrome tab and group changes without either removed button.
- Confirm Active and Saved rows display favicons with text fallback.
- Save duplicate URLs with differing fragments and confirm only the newest copy remains.
- Confirm query strings remain distinct during deduplication.
- Use quick tab search and confirm both panels filter while keeping Chrome/session grouping.
- Confirm drag is disabled while searching and works after clearing search.
- Left-click a saved tab and confirm it opens in the background, disappears from Saved, and appears in History.
- Middle-click a saved tab and confirm it opens in the background but remains Saved.
- Restore and delete complete saved sessions and confirm both are recoverable through History.
- Reorder sessions and tabs, including moving a tab between sessions, then reload the extension and confirm order persists.
- Restore a History entry and permanently delete another.
- Pull from Gist and confirm Saved URLs are deduplicated while History is unchanged.

## Risks And Tradeoffs

- `Restore all` cannot atomically roll back Chrome tabs that were created before a later create failed. Preserving the Saved session avoids data loss, but may leave duplicates open after partial failure.
- Explicit session ordering expands the persisted schema and requires a careful migration for existing installations.
- Cross-device deletion remains imperfect without sync tombstones. This feature deliberately keeps History local and limits its guarantee to the current device.
- Disabling drag during filtered search favors predictable persistence over allowing ambiguous projected-list reorder operations.
