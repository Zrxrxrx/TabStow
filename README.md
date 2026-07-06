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
- Confirm active tabs group by domain and homepage-style tabs appear in the Homepages group.
- Create a manual group from an active tab and move the tab back to its domain group.
- Enable Chrome tab-group sync and confirm manual groups become native Chrome tab groups.
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
