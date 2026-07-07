# New Tab Groups, Saved Tabs, And Quick Links Sync Design

Date: 2026-07-08
Status: Approved for planning

## Context

Tabstow is a Manifest V3 Chrome extension with a React/WXT new tab page. The current dashboard already has active tabs, saved sessions, quick links, Chrome tab-group actions, and manual Gist sync. The active and saved tab areas are already rendered as two columns, but the page still leaves more horizontal space unused than it needs to. Saved sessions currently show session summaries rather than the full saved tab list. Quick links are stored locally and do not participate in Gist sync.

The user wants four related changes:

- Use more available width on the new tab page.
- Make Chrome tab-group sync the default behavior, with two-way sync and Chrome winning conflicts.
- Show saved tabs in a OneTab-like detailed list with favicon, title, and URL.
- Add a quick-link URL fetch flow and include quick links in Gist sync.

## Goals

- Keep the two-column workspace but make better use of desktop width.
- Treat native Chrome tab groups as the source of truth for active tab grouping.
- Keep Tabstow grouping actions synced back to Chrome when they exist.
- Render every saved tab inside each saved session with favicon, title, and URL/domain detail.
- Add a quick-link URL fetch/preview step that works without broad host permissions.
- Extend Gist sync to include quick links, while excluding uploaded image-icon bytes.
- Preserve existing Manifest V3 constraints and minimal permission posture.

## Non-Goals

- No content scripts.
- No broad host permissions for arbitrary page-title scraping.
- No remote executable code, eval, CDN scripts, or Node/Bun-only APIs in extension runtime code.
- No full quick-link metadata crawler.
- No syncing uploaded quick-link image blobs through Gist.
- No deletion/tombstone sync redesign for saved sessions or quick links.
- No unrelated options-page redesign.

## Selected Approach

Use a Chrome-first, minimal-permission implementation:

1. The dashboard shell widens and tightens side padding so the active and saved columns have more usable room.
2. Active tabs read native Chrome group membership by default. Chrome groups win conflicts; Tabstow reflects Chrome first.
3. Tabstow grouping changes write back to Chrome immediately where Tabstow has grouping actions.
4. Saved sessions render as OneTab-like groups that list all saved tabs.
5. Quick links get a URL fetch/preview flow that normalizes the URL, shows the site favicon, and fills a label from the hostname unless the link came from an already-open tab with a real title.
6. The Gist sync document includes quick links with URL, label, supported icon metadata, order, and created time.

This gives the requested behavior without expanding the extension permission surface.

## Layout Design

The main new tab page keeps the current structure:

- Topbar.
- Full-width quick links panel.
- Two-column workspace with Active tabs on the left and Saved for later on the right.
- Extra drawer for secondary tools.

The page shell should use more horizontal space than the current `1440px` cap. The design target is:

- Smaller desktop side gutters.
- A wider maximum shell around wide desktop sizes.
- Active and saved columns that remain balanced enough for tab rows to breathe.
- Single-column collapse on narrower screens before either column becomes cramped.

The saved column must be wide enough on desktop for favicon, title, URL, and actions to fit without looking like a summary card forced into a narrow rail.

## Chrome Group Sync

Chrome tab groups are on by default. Missing or legacy workspace state should normalize to `enabled: true`.

Active tabs should be grouped in this priority order:

1. Tabs with a native Chrome `groupId` render under that Chrome group.
2. Ungrouped tabs with Tabstow manual assignments can render under their manual group.
3. Remaining ungrouped tabs fall back to existing domain/homepage grouping.

To render native group names reliably, the active-tabs read path should include Chrome tab-group metadata from `chrome.tabGroups.query`. The UI model should add a `chrome` group kind rather than pretending native groups are domain groups.

Chrome wins conflicts:

- On refresh, if a tab is in a Chrome group, that membership wins over stale Tabstow manual assignment.
- Tabstow should prune or ignore manual assignment conflicts for Chrome-grouped tabs.
- If Tabstow writes a grouping change to Chrome, the UI refreshes from Chrome afterward.

Two-way sync means:

- Chrome-to-Tabstow: opening the dashboard or refreshing active tabs reads Chrome groups and displays them as-is.
- Tabstow-to-Chrome: grouping actions in Tabstow update native Chrome groups immediately.
- While the dashboard is open, tab and tab-group events should debounce a refresh so changes made directly in Chrome appear without manual reload.

The existing manual "sync manual groups" checkbox should stop being the primary control. The active workspace should instead show a passive synced status and keep explicit utility actions for importing/refreshing groups and collapsing Chrome groups.

The current sync implementation collapses groups after syncing. Default sync must stop doing that; groups should collapse only when the user clicks the collapse action.

## Saved For Later Design

Saved for later becomes a OneTab-style list of saved session groups.

Each session group shows:

- Tab count as the prominent group label.
- Created date using the existing date formatter.
- Restore all action.
- Delete action.
- A list of every saved tab in that session.

Each saved tab row shows:

- Favicon from saved `favIconUrl` when available.
- Chrome favicon URL fallback for HTTP/HTTPS URLs.
- Text initial fallback if no favicon can render.
- Title as the primary line.
- URL or readable domain as the secondary line.

The row style should match the active-tab row vocabulary closely enough that active tabs and saved tabs feel like the same kind of object. The current session preview string should be removed because the detailed list replaces it.

Clicking an individual saved tab row opens that saved URL in a new tab without requiring the user to restore the whole session. Restore all remains the session-level action.

## Quick Links Design

Quick links keep show/edit mode.

The add-by-URL flow changes from a plain two-field dialog into a small fetch/preview flow:

1. User pastes a URL.
2. User clicks Fetch.
3. Tabstow normalizes and validates the URL.
4. Tabstow shows the favicon through Chrome's `/_favicon/` API.
5. Tabstow fills the label from the hostname.
6. User can edit the label before saving.

Because permissions stay minimal, Fetch does not download arbitrary pages or parse remote `<title>` tags. Real page titles are used when the quick link is created from an already-open tab, because Chrome already exposes `tab.title` and `tab.favIconUrl`.

Uploaded custom icons remain local-only. They can still be used on the device where they were uploaded, but they are not exported to Gist.

## Gist Sync Design

The sync document should include quick links in addition to sessions and safe settings. The schema can remain backward-compatible by treating missing `quickLinks` as an empty list.

Synced quick-link fields:

- `id`
- `url`
- `label`
- `icon` for `site` and `emoji` only
- `createdAt`

Uploaded `image` icon tokens are not valid sync data because the token refers to local Cache Storage. During export, image icons should be converted to a site icon. During import, invalid or image-like icon payloads should normalize to site/default behavior.

Merge behavior should match the existing safety-first sync shape:

- Push reads the remote document first, merges remote and local quick links, and writes the merged document.
- Pull merges remote quick links into local quick links.
- Matching IDs use the same direction-specific precedence pattern as sessions: local wins during push, remote wins during pull, except local-only uploaded image icons are preserved for existing local links when the remote icon has no synced equivalent.
- Order should preserve the winning side's order first, then append links that exist only on the other side in their existing order.

Deletion propagation is out of scope for this spec because the existing session sync does not use tombstones either.

The sync result should include both `sessionCount` and `quickLinkCount`, and the saved panel status copy should mention both counts after push or pull.

## Component And Module Boundaries

Expected change areas:

- `apps/extension/src/entrypoints/newtab/styles.css`
  - Wider shell, revised workspace grid, saved tab row styling.

- `apps/extension/src/entrypoints/newtab/components/ActiveWorkspace.tsx`
  - Chrome-first grouping display.
  - Default synced state.
  - Debounced refresh from tab and tab-group events while the dashboard is open.

- `apps/extension/src/features/active-tabs/*`
  - Group-building support for native Chrome groups.
  - State normalization for Chrome group sync defaulting on.

- `apps/extension/src/features/chrome-tab-groups/chrome-tab-groups.ts`
  - Sync behavior that does not unexpectedly collapse groups by default.
  - Chrome-first reconciliation helpers.

- `apps/extension/src/entrypoints/newtab/components/StowedSessions.tsx`
  - Full saved-tab list rendering.
  - Individual saved-tab open action.

- `apps/extension/src/entrypoints/newtab/components/QuickLinks.tsx`
  - Fetch/preview flow for pasted URLs.
  - Preserve add-from-open-tab title behavior.

- `apps/extension/src/features/quick-links/*`
  - Export/import-safe quick-link normalization helpers.
  - Merge/order helpers for sync.

- `packages/core/src/schemas.ts` and `packages/core/src/sync-document.ts`
  - Backward-compatible quick-link sync schema.
  - Sync document build/parse support.

- `apps/extension/src/features/sync/sync-service.ts`
  - Read local quick links for push.
  - Merge and save quick links on pull.

## Error Handling

- Chrome group sync failures report through the existing active workspace status path.
- If Chrome group metadata cannot be read, active tabs should still display with existing fallback grouping.
- Quick-link Fetch shows validation errors in the quick-links panel or dialog.
- Favicon image failures fall back silently to text initials.
- Invalid Gist JSON or invalid sync documents should still return existing invalid-sync-document errors and must not overwrite remote data.
- Missing `quickLinks` in older Gist documents is valid and imports as an empty quick-link list.

## Testing And Verification

Add or update focused tests for:

- Layout contract: page shell and workspace grid use the wider two-column layout without breaking existing class hooks.
- Chrome group state defaults to enabled.
- Active tab grouping prefers native Chrome groups over stale manual assignments.
- Chrome sync does not collapse groups automatically during default sync.
- Saved sessions render every tab with title and URL/domain detail.
- Saved tabs use saved favicon or fallback favicon/initial.
- Quick-link Fetch validates and previews a pasted URL without network page fetch.
- Add-from-open-tab continues to use real tab title.
- Sync document parses older documents without `quickLinks`.
- Sync document exports quick links and excludes uploaded image icons.
- Push and pull merge quick links with expected precedence and order.

Run:

```bash
bun run test
bun run typecheck
```

Manual QA:

- Load the extension in Chrome.
- Create Chrome tab groups and confirm Active tabs mirrors them by default.
- Move/change groups in Chrome and confirm the open dashboard refreshes.
- Use any Tabstow grouping controls and confirm Chrome updates.
- Stow a session and confirm Saved for later lists all saved tabs.
- Add quick links by URL fetch and from open tabs.
- Push to Gist, clear local quick links on another profile/device, pull, and confirm quick links return without uploaded image icons.

## Risks

- Chrome group event behavior may differ by Chrome version, so the implementation should keep explicit refresh as a fallback.
- Default two-way group sync can surprise users if Tabstow collapses or rewrites groups; implementation must avoid automatic collapse and keep Chrome as source of truth.
- Quick-link deletion will not propagate through sync until the broader sync model supports tombstones.
- Uploaded image icons are intentionally local-only, so users may see site favicon fallback after pulling on another device.
