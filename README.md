# Tabstow

Tabstow is a Chrome Manifest V3 extension that replaces the default new tab page with a utilitarian workspace for stowing, restoring, and manually syncing browser tab sessions.

## Development

Install dependencies:

```bash
bun install
```

Run the extension in development:

```bash
bun run dev
```

Build:

```bash
bun run build
```

Typecheck:

```bash
bun run typecheck
```

Test:

```bash
bun run test
```

Package:

```bash
bun run zip
```

## Gist Sync

Create a GitHub Gist manually, add a file named `tabstow.sync.json`, and paste the GitHub token, Gist ID, and filename into the Tabstow options page. The token must have permission to read and update the configured Gist. Tabstow does not create a Gist automatically.

## Manual QA

- Load `apps/extension/.output/chrome-mv3` as an unpacked extension in Chrome.
- Open a new tab and confirm the Tabstow dashboard appears.
- Click the extension toolbar icon and confirm the current window's eligible tabs are stowed and no popup opens.
- Open several ordinary web tabs and use **Stow current window**.
- Open two normal Chrome windows with pinned, ungrouped, and natively grouped web tabs.
- Confirm Active Tabs shows the focused window first and preserves each window's eligible tab-strip order.
- Drag an ungrouped tab, reorder a tab inside a group, move a tab into and out of a group, and move a tab between windows.
- Reorder a complete Chrome group and move it to the other normal window.
- Confirm pinned tabs only accept pinned destinations and retain their pinned state across windows.
- Change tab order, group membership, group title/color/collapsed state, and window focus directly in Chrome; confirm the open dashboard refreshes.
- Reload Tabstow and confirm no local URL/manual grouping or stale local order returns.
- Collapse Chrome tab groups from the dashboard.
- Close one tab, close a group, and close duplicates.
- Add and open a quick link.
- Create, complete, search, and clear todos.
- Change theme mode, palette, transparency, and language preference.
- Run dashboard search with the default search provider.
- Confirm the saved session appears and eligible tabs close.
- Restore the saved session.
- Delete the saved session.
- Open the options page and save Gist settings.
- Push and pull Gist sync and confirm only stowed sessions sync.
