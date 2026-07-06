# Tabstow MVP Design

Date: 2026-07-06
Status: Approved for implementation planning

## Summary

Tabstow is a Chrome Manifest V3 extension that replaces the default new tab page with a utilitarian tab management dashboard. The MVP lets a user save all eligible tabs in the current Chrome window into a local session, close those saved tabs, restore saved sessions later, manage sessions from the new tab page, and manually push/pull session data through a user-provided GitHub Gist.

The project starts from an empty repository. It will use Bun for package management and scripts, WXT for the extension framework, React for extension pages, TypeScript throughout, Dexie/IndexedDB for durable session data, extension storage for lightweight settings, and Zod for runtime validation.

## Goals

- Scaffold a lightweight Bun workspace for a Chrome MV3 extension.
- Replace Chrome's new tab page with a functional Tabstow dashboard.
- Save eligible tabs in the current window as local sessions and close the saved tabs.
- Restore saved sessions later without deleting them automatically.
- Provide a context menu action to stow the current window.
- Provide a standalone options page for settings and manual Gist sync.
- Make manual GitHub Gist push and pull fully usable in the MVP.
- Keep permissions minimal and avoid content scripts unless a concrete need appears.
- Keep extension runtime code free of Bun-only and Node-only APIs.

## Non-Goals

- Automatic background sync, polling, or scheduled sync.
- Automatic Gist creation.
- Content scripts.
- Remote executable code, CDN-loaded scripts, `eval`, or `new Function`.
- Storing real tokens, credentials, or user-specific values in source code.
- Deleting sessions automatically after restore.
- Full conflict-resolution workflows beyond session-ID merge on pull.

## Repository Architecture

Tabstow will be a Bun workspace with two packages:

- `apps/extension`: WXT extension app. Owns Chrome APIs, MV3 background service worker, extension pages, Dexie database access, settings storage, Gist API calls, and UI.
- `packages/core`: Runtime-neutral shared package. Owns Zod schemas, inferred TypeScript types, sync document structure, and pure domain helpers where useful.

The extension depends on the core package using a workspace reference such as `@tabstow/core: "workspace:*"`.

Target structure:

```text
.
├── package.json
├── tsconfig.base.json
├── apps/
│   └── extension/
│       ├── package.json
│       ├── tsconfig.json
│       ├── wxt.config.ts
│       └── src/
│           ├── entrypoints/
│           │   ├── background.ts
│           │   ├── newtab/
│           │   └── options/
│           ├── components/
│           ├── db/
│           ├── features/
│           └── lib/
└── packages/
    └── core/
        ├── package.json
        ├── tsconfig.json
        └── src/
```

If WXT generates a slightly different valid structure, the implementation may adapt while preserving the same boundaries.

## Package And Script Design

Bun is the package manager and script runner for this project.

Root scripts:

- `dev`: run the extension dev server.
- `build`: build the extension.
- `zip`: package the extension.
- `typecheck`: typecheck workspace packages.
- `test`: run tests if Vitest is added.

Extension package scripts:

- `dev`
- `build`
- `zip`
- `typecheck`

The Chrome extension runtime is not Bun. Bun must not be used as a runtime dependency inside bundled extension code.

## Extension Configuration

WXT will be configured for React, TypeScript, and Chrome Manifest V3.

Manifest requirements:

- User-facing extension name: `Tabstow`.
- Permissions: `tabs`, `storage`, `contextMenus`.
- Host permissions: `https://api.github.com/*`, `https://gist.githubusercontent.com/*`.
- New tab override through `chrome_url_overrides.newtab`.
- Standalone options page that opens in a tab.

No content script is part of the MVP.

## Core Domain Model

The core package exports Zod schemas and inferred TypeScript types for:

- `SavedTab`
- `TabSession`
- `ExtensionSettings`
- `SyncDocument`

`SavedTab`:

- `id: string`
- `url: string`
- `title: string`
- `favIconUrl?: string`
- `pinned?: boolean`
- `createdAt: string`

`TabSession`:

- `id: string`
- `title: string`
- `tabs: SavedTab[]`
- `sourceWindowId?: number`
- `createdAt: string`
- `updatedAt: string`
- `deviceId: string`

`ExtensionSettings`:

- `deviceId: string`
- `githubToken?: string`
- `gistId?: string`
- `gistFileName: string`
- `includePinnedTabs: boolean`
- `closePinnedTabs: boolean`
- `theme: "system" | "light" | "dark"`

Default settings:

- `gistFileName: "tabstow.sync.json"`
- `includePinnedTabs: false`
- `closePinnedTabs: false`
- `theme: "system"`

`SyncDocument`:

- `schemaVersion: 1`
- `deviceId: string`
- `exportedAt: string`
- `sessions: TabSession[]`
- `settings`: safe settings subset that excludes `githubToken`

The GitHub token must never appear in exported sync documents.

## Local Persistence

Session data uses Dexie over IndexedDB in `apps/extension/src/db`.

The database module exposes:

- `createSession(session)`
- `listSessions()`
- `getSession(id)`
- `deleteSession(id)`
- `updateSession(session)`
- `clearSessions()`
- `exportSessions()`
- `importSessions(sessions)`

Settings use WXT storage when it fits cleanly, falling back to `chrome.storage.local` only if needed for compatibility. The settings module exposes:

- `getSettings()`
- `updateSettings(partial)`
- `getOrCreateDeviceId()`

The device ID is created once and reused for local sessions and sync documents.

## Tab Stowing And Restoring

Both the new tab UI and context menu call the same background message to stow the current window. The background service worker delegates to feature modules rather than owning business logic directly.

Stow flow:

1. Query tabs in the current Chrome window.
2. Filter out `chrome://`, `edge://`, `about:`, extension pages, and Tabstow's own active new-tab page.
3. Skip pinned tabs by default.
4. If `includePinnedTabs` is enabled, include pinned tabs in the saved session.
5. Close pinned tabs only when `closePinnedTabs` is also enabled.
6. Save the remaining tabs as a `TabSession` in IndexedDB.
7. Close the tabs that were saved and are eligible to close.
8. Return a typed success or error result to the caller.

Restore flow:

- Restore tabs in saved order.
- Support `current-window` mode for MVP.
- Include `new-window` mode only if it fits cleanly without broadening the implementation.
- Do not delete the session after restore.

The service should handle Chrome API failures gracefully and return typed results that the UI can display.

## Gist Sync

Manual Gist sync must be fully usable in the MVP. Users provide their own GitHub token, Gist ID, and Gist filename in the options page. Tabstow does not create a Gist automatically.

Push flow:

1. Validate that GitHub token, Gist ID, and Gist filename are present.
2. Export local sessions from IndexedDB.
3. Build a `SyncDocument` with safe settings only.
4. Validate the document with Zod.
5. Update the configured Gist file through the GitHub API.
6. Return visible success or error status to the UI.

Pull flow:

1. Validate that GitHub token, Gist ID, and filename are present.
2. Read the configured Gist file.
3. Parse and validate it as a `SyncDocument`.
4. Merge sessions by session ID:
   - Keep local-only sessions.
   - Add remote-only sessions.
   - For matching IDs, use the remote version.
5. Import safe settings from the sync document without overwriting the local GitHub token.
6. Return visible success or error status to the UI.

Sync status should be explicit enough for the user to tell whether push or pull succeeded, failed due to missing settings, failed due to GitHub API errors, or failed due to invalid sync data.

## User Interface

The new tab page is a utilitarian dashboard, not a marketing page.

New tab page:

- Product heading: `Tabstow`
- Compact subtitle: `Stow, organize, and restore your browser tabs.`
- Primary action: `Stow current window`
- Saved session list
- Empty state when there are no saved sessions
- Per-session details:
  - title
  - created date
  - number of tabs
  - first few tab titles or domains
  - restore action
  - delete action
- Manual sync controls or a clear path to sync controls, depending on final layout fit.

Options page:

- GitHub token input, using password-style presentation.
- Gist ID input.
- Gist filename input.
- Pinned-tab behavior settings.
- Theme setting.
- Manual push and pull controls.
- Clear status and validation messages.

The UI should be compact, scannable, and built for repeated use.

## Background Service Worker

The MV3 background entrypoint stays small and delegates work.

Responsibilities:

- Register the context menu item on install/startup.
- Context menu title: `Stow current window tabs`.
- Handle messages for:
  - stow current window
  - restore session
  - list sessions
  - delete session
  - push to Gist
  - pull from Gist
  - read/update settings if needed by pages

The background must not depend on long-lived in-memory state. Durable data belongs in IndexedDB or extension storage.

## Error Handling

Feature modules should return typed results instead of throwing raw errors through UI boundaries.

Expected error categories:

- Missing sync settings.
- GitHub API authentication or authorization failure.
- Gist file not found.
- Invalid sync document.
- Chrome tab query, create, or remove failure.
- No eligible tabs to stow.
- Session not found.

User-facing messages should be concise and actionable without exposing secrets.

## Testing And Verification

Automated tests should focus on logic that can run outside a real Chrome runtime:

- Zod schemas.
- Settings defaults and safe sync settings export.
- Sync document validation.
- Merge-on-pull behavior.
- Tab filtering helpers if factored into pure functions.

Vitest should be added if it fits cleanly. Verification commands should include:

- Bun install.
- Typecheck.
- Tests, if present.
- WXT build.

Manual runtime verification:

- Load the built extension in Chrome.
- Confirm the new tab override opens Tabstow.
- Stow eligible current-window tabs from the new tab page.
- Stow eligible current-window tabs from the context menu.
- Restore a session.
- Delete a session.
- Save options.
- Push to a user-provided Gist.
- Pull from the configured Gist and confirm merge-by-ID behavior.

## Implementation Notes

- Keep changes surgical and avoid speculative abstractions.
- Use the existing WXT patterns generated for the project.
- Prefer small feature modules with clear boundaries over large catch-all files.
- Keep permissions minimal.
- Do not commit tokens, secrets, generated credentials, or user-specific values.
- Use package names such as `@tabstow/core`.
- Use `Tabstow` exactly in user-facing copy.
