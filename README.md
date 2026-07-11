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

## Releases

For the first release, open **Actions** in GitHub, select the **Release** workflow, choose **Run workflow**, and leave **Version to publish or increment** set to `current`. The checked-in extension version is `1.0.0`, so this publishes `v1.0.0`. For each later release, run the workflow again and select the desired `patch`, `minor`, or `major` bump.

If a release run fails after pushing its tag, rerun the workflow with `current`. Recovery proceeds only when the existing tag resolves to the current default-branch commit. Recovery treats `tabstow-vX.Y.Z-chrome.zip` and `SHA256SUMS` as a coupled pair. A lone ZIP gets a checksum generated from that exact published file; an orphan checksum is removed before a fresh pair is uploaded. If a complete published pair fails checksum verification, delete both assets and rerun with `current`.

To install or update from a GitHub Release:

1. Open the desired Release and download both `tabstow-vX.Y.Z-chrome.zip` and `SHA256SUMS` into the same directory.
2. From that directory, verify the ZIP before extracting it:

   ```bash
   # Linux
   sha256sum -c SHA256SUMS

   # macOS
   shasum -a 256 -c SHA256SUMS
   ```

3. Extract the ZIP into a stable local directory that will not be moved or deleted. Open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select the extracted directory containing `manifest.json`.
4. For an update, verify the new download, replace the contents of that same stable directory with the new ZIP contents, then choose **Reload** for Tabstow on `chrome://extensions`.

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
