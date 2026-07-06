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
- Open several ordinary web tabs and use **Stow current window**.
- Confirm the saved session appears and eligible tabs close.
- Restore the saved session.
- Delete the saved session.
- Open the options page and save Gist settings.
- Push to the configured Gist.
- Pull from the configured Gist and confirm sessions merge by ID.
