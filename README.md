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

If a release run fails after pushing its tag, rerun the workflow with `current`. Recovery is allowed only when the existing tag is annotated and peels to the checked-out default-branch HEAD. The rerun repeats typechecking, tests, the ZIP build, and release verification, but skips commit, tag, and push.

Recovery treats `tabstow-vX.Y.Z-chrome.zip` and `SHA256SUMS` as a coupled pair.

- If the Release does not exist, it is created with the freshly rebuilt pair.
- If both assets exist, the published pair is downloaded and verified together. A valid pair is left unchanged. If a complete published pair fails checksum verification, delete both assets and rerun with `current`.
- If only the ZIP exists, its checksum is generated from that exact published ZIP and only that checksum is uploaded.
- If only the checksum exists, it is deleted before the freshly rebuilt pair is uploaded.
- If both assets are missing, the freshly rebuilt pair is uploaded.

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

## Documentation

- [Gist Sync](docs/gist-sync.md)
- [Manual QA](docs/manual-qa.md)
