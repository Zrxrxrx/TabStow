# Tab Harbor Feature Migration Design

Date: 2026-07-06
Status: Approved for written-spec review

## Summary

Tabstow will migrate the useful Tab Harbor behaviors into the existing Tabstow architecture rather than copying Tab Harbor's plain Manifest V3 files directly. The migrated product keeps Tabstow's WXT, React, TypeScript, IndexedDB, background message routing, options page, and Gist sync boundaries.

The toolbar icon will stow the current window by default. The Tab Harbor popup will not be migrated because a popup would conflict with instant toolbar stowing.

Tabstow's existing stowed sessions remain the canonical saved-for-later model. Tab Harbor's separate saved drawer and archive will not be migrated because it duplicates stowed sessions. Active/open-tab workspace state is local-only and will not sync through Gist because it describes the current browser state. Stowed sessions continue to sync through Gist.

## Goals

- Make the extension toolbar icon stow the current window's eligible tabs.
- Keep no action popup so toolbar click is the default stow action.
- Port Tab Harbor's active-tab dashboard behaviors into Tabstow's React new-tab page.
- Add native Chrome tab-group features and the `tabGroups` permission.
- Add dashboard web search through the `search` permission.
- Avoid `clipboardRead` for this migration.
- Keep stowed sessions in IndexedDB and synced through the existing Gist flow.
- Keep active browser state, live tab grouping, and live tab ordering local-only.
- Preserve Tabstow's typed modules, tests, and background-mediated Chrome API boundaries.

## Non-Goals

- Directly copying Tab Harbor's plain JavaScript runtime into Tabstow.
- Migrating Tab Harbor's toolbar popup.
- Migrating Tab Harbor's saved-for-later drawer or archive.
- Adding `clipboardRead` or clipboard image paste.
- Adding content scripts.
- Syncing active tabs, live tab IDs, live Chrome tab-group state, or current browser workspace state through Gist.
- Replacing Tabstow's stowed-session storage model with Tab Harbor storage.

## Source Feature Decisions

Migrate these Tab Harbor concepts:

- Active tab workspace with domain-based grouping.
- Homepage and landing-page grouping rules.
- Manual groups for active tabs.
- Group ordering, pinned group ordering, and per-group tab ordering.
- Native Chrome tab-group import, sync, and collapse behavior.
- Duplicate tab cleanup.
- Close tab, close group, focus tab, and jump-to-group actions.
- Quick links, including add from open tabs and add by URL.
- Todos, because they are distinct from stowed sessions.
- Theme mode, palette, transparency, and custom background controls.
- Dashboard web search.
- English and Simplified Chinese localization for migrated Tab Harbor UI copy.

Do not migrate these Tab Harbor concepts:

- Toolbar popup.
- Saved-for-later drawer and archive.
- Clipboard image paste for shortcut icons.
- Plain global-script module structure.

## Architecture

Tabstow stays a Bun workspace with:

- `apps/extension`: WXT extension app, React UI, Chrome API access, Dexie database, settings storage, background service worker, and extension pages.
- `packages/core`: runtime-neutral schemas, types, pure helpers, and sync document helpers.

The new-tab page becomes the main workspace surface with three areas:

- Active Tabs Workspace: live Chrome tabs grouped by domain, landing-page rules, manual groups, and native Chrome tab groups.
- Stowed Sessions: existing Tabstow saved sessions, restore/delete actions, and manual Gist push/pull controls or links.
- Utility Layer: quick links, todos, themes, custom background, duplicate cleanup, search, and group ordering controls.

The background service worker remains the owner of privileged background actions. Toolbar click, dashboard stow button, and context menu stow action should all call the same `saveCurrentWindowAsSession(windowId?)` service path.

## Manifest And Permissions

The manifest action must keep no `default_popup`.

Permissions:

- Keep existing `tabs`, `storage`, and `contextMenus`.
- Add `tabGroups` for native Chrome tab-group import/sync/collapse.
- Add `search` for dashboard default-engine search.
- Do not add `clipboardRead`.

Existing GitHub host permissions remain for Gist sync:

- `https://api.github.com/*`
- `https://gist.githubusercontent.com/*`

No content scripts are part of this migration.

## Data And Persistence

### Stowed Sessions

Stowed sessions remain in IndexedDB through the existing Dexie session repository. They remain the only saved-tab model for later restoration.

Gist sync continues to sync stowed sessions only. Utility settings and active workspace state are local-only in this migration, so the sync document remains focused on sessions.

### Active Workspace State

Active workspace state is local-only because it depends on live browser tabs and ephemeral Chrome tab IDs.

Local active workspace state includes:

- Manual active-tab groups.
- Tab-to-manual-group assignments by live tab ID.
- Group ordering.
- Pinned group ordering.
- Per-group tab ordering.
- Chrome tab-group sync enabled setting.
- Chrome tab-group import/sync metadata.
- Dashboard UI layout state that only describes current active tabs.

Assignments must be pruned when tabs disappear so stale tab IDs do not accumulate.

### Utility State

Utility state uses extension storage. Durable stowed sessions remain the only IndexedDB-backed data in this migration.

Local utility state:

- Quick links.
- Todos.
- Theme mode, palette, transparency, and custom background.
- Language preference.

These settings are local-only for this migration.

## Component Design

### Active Tabs Feature

Add a feature module for querying and normalizing active tabs. It should filter out extension/internal tabs when appropriate, derive stable display labels, group tabs by domain, and identify landing/homepage-style tabs using ported rules from Tab Harbor.

Pure helpers should cover:

- Hostname/domain extraction.
- Friendly labels.
- Title cleanup.
- Landing-page detection.
- Duplicate URL grouping.
- Group sort/order application.

### Manual Groups Feature

Add a feature module for manual groups around active tabs. It should normalize group state, create groups, assign tabs, clear assignments, prune assignments for closed tabs, and apply ordering.

Manual groups are virtual Tabstow dashboard groups. They can be synced to native Chrome tab groups only when the Chrome tab-group feature is enabled.

### Chrome Tab Groups Feature

Add a feature module around `chrome.tabGroups` and `chrome.tabs.group`.

Responsibilities:

- Detect whether native tab-group APIs are available.
- Import existing Chrome tab groups into virtual manual group state.
- Preserve mapping metadata between virtual group keys and Chrome group IDs.
- Sync virtual groups back to Chrome groups when enabled.
- Collapse native groups where supported.
- Avoid corrupting virtual state if a Chrome API call fails.

This module should be testable with mocked Chrome APIs and should not depend on React.

### Toolbar Action Feature

The background entrypoint should register `browser.action.onClicked`. On click, it calls `saveCurrentWindowAsSession(tab.windowId)`.

Since no popup exists, toolbar stow result feedback should be non-intrusive. A short-lived action badge/title can indicate success or failure. Dashboard-driven stow actions continue to show regular status messages.

### Quick Links Feature

Port quick links as a typed feature, not a direct script copy.

Supported actions:

- Add by URL.
- Add from open tabs.
- Edit label and icon metadata.
- Remove quick link.
- Reorder quick links.
- Open quick link.

Clipboard image paste is excluded. Custom image upload is supported through a file input and must not require `clipboardRead`.

### Todos Feature

Port todos as a local utility feature.

Supported actions:

- Create todo with title and optional description.
- Complete todo.
- View archived/completed todos.
- Delete or dismiss archived todos.
- Search todos.
- Reorder active todos.

Todos are not a replacement for stowed sessions and do not store browser tabs.

### Theme Feature

Port Tab Harbor's theme concepts into Tabstow styling:

- System/light/dark mode.
- Palette selection.
- Surface transparency.
- Custom background image.

The UI should respect existing Tabstow dashboard density and avoid importing Tab Harbor markup directly.

### Localization Feature

Port Tab Harbor's English and Simplified Chinese UI copy into a typed localization helper. The helper should support an `auto` language preference, persist the selected preference in extension storage, and avoid runtime DOM mutation patterns from the source extension.

## User Interface

The new tab page should remain an actual working dashboard, not a landing page.

Primary visible surfaces:

- Active tabs grouped by domain/manual/Chrome grouping.
- Top or side group navigation for quick jumping.
- Stowed session list with restore/delete.
- Primary `Stow current window` action.
- Quick links section.
- Todos panel or drawer.
- Theme controls.
- Search box using Chrome's default search provider.
- Language control for English, Simplified Chinese, and automatic language selection.

The old Tab Harbor popup is intentionally absent. Users who click the toolbar icon stow the current window immediately.

## Error Handling

Toolbar stow failures should not be completely silent. Use short-lived action badge/title feedback for success and failure. Do not use Chrome notifications for this migration.

Active tab actions should fail locally and refresh the dashboard. If one close/focus/group action fails, the app should not corrupt stored local grouping state.

Chrome tab-group sync is best-effort. If Chrome rejects a group operation, virtual group state remains valid and the user can retry after refresh.

Gist sync errors continue to use existing typed result messages and dashboard/options status display.

## Testing And Verification

Required automated coverage:

- Background action click invokes `saveCurrentWindowAsSession(tab.windowId)`.
- Manifest has no `action.default_popup`.
- Manifest includes accepted permissions and excludes `clipboardRead`.
- Active-tab grouping helpers.
- Landing-page detection.
- Duplicate URL helpers.
- Manual group normalization, assignment, pruning, and ordering.
- Chrome tab-group import/sync mapping with mocked Chrome APIs.
- Quick link storage/helpers.
- Todo storage/helpers.
- Theme preference normalization.
- Existing session, restore, tab filtering, and Gist sync tests continue to pass.

Required commands:

- `bun run test`
- `bun run typecheck`
- `bun run build`

Manual QA:

- Load `apps/extension/.output/chrome-mv3` as an unpacked extension.
- Open several tabs in two Chrome windows.
- Click the toolbar icon in one window and confirm only that window's eligible tabs are stowed and closed.
- Confirm no popup opens.
- Confirm the new session appears and can restore.
- Confirm active tabs group correctly.
- Create, reorder, and remove a manual group.
- Enable native Chrome tab groups and confirm groups import/sync/collapse.
- Add and open quick links.
- Create, complete, and search todos.
- Change theme settings and refresh.
- Run dashboard search.
- Confirm Gist push/pull still works for stowed sessions.

## Migration Sequence

The implementation can be one migration while still landing in ordered slices:

1. Add toolbar action stow and regression tests.
2. Add active-tab query, grouping, duplicate, and landing-page helpers.
3. Build the React active workspace UI.
4. Add manual groups and ordering.
5. Add native Chrome tab-group import/sync/collapse.
6. Add quick links.
7. Add todos.
8. Add theme/custom background controls.
9. Add dashboard search and accepted manifest permission changes.
10. Integrate final UI, run full verification, and update README/manual QA notes.

This order keeps the existing stow/session/Gist behavior working while progressively replacing the simple current dashboard with the integrated workspace.
