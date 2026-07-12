# GitHub Gist Sync

Tabstow synchronizes through a Gist that already belongs to the connected GitHub account. It never creates a Gist or changes its visibility.

## Connect

1. Create a Gist on GitHub and add a file named `tabstow.sync.json`. The file may be empty or contain `{}` for first-time setup.
2. Open Tabstow Settings and choose **Connect GitHub**.
3. Copy the Device Flow code, open GitHub, and authorize the OAuth App. Tabstow requests only the `gist` scope.
4. If exactly one valid unlisted `tabstow.sync.json` Gist exists, Tabstow discovers it automatically. Otherwise choose a discovered Gist or enter an existing Gist ID and filename.
5. Confirm the target before local Saved for Later or Quick Link data is merged. A public Gist always requires an explicit warning and confirmation.

The extension maintainer must register the OAuth App, enable Device Flow, and provide its public client ID as `WXT_GITHUB_OAUTH_CLIENT_ID` at build time. No client secret or hosted callback is used.

## Automatic behavior

- Opening a New Tab reads and merges the latest Gist state. Focused New Tabs share a 60-second read cooldown.
- Local changes are saved immediately in IndexedDB. The latest change resets one 60-second quiet-period alarm, so a burst of work normally produces one Gist update.
- The background service worker completes due work after the New Tab closes and catches up after browser sleep or restart.
- Network failures never block or roll back local actions. Tabstow retries with bounded backoff and shows a persistent message when synchronization needs attention.
- Settings retains safe **Pull** and **Push** controls. Pull reads and merges only; Push reads, merges, writes the converged result, and verifies it. Neither action force-overwrites invalid content.

## Synchronized data

- Saved for Later sessions, tabs, membership, ordering, consumption, restore, and deletion.
- Quick Link fields, ordering, and deletion.
- Save/close pinned-tab behavior preferences.
- Logical revisions and deletion markers needed for deterministic convergence.

History, Todos, theme, language, OAuth credentials, Gist binding, and uploaded Quick Link image bytes remain local. Restoring from History creates fresh synchronized session and tab identities.

Version-one sync files are imported once and then written as schema version two. Old Tabstow clients must not write the upgraded file.

## Privacy and limits

Unlisted Gists are not encrypted or truly private; anyone with the URL can read them. Public Gists expose saved titles and URLs publicly. Tabstow does not provide client-side encryption in this version.

GitHub limits an OAuth App to ten active tokens for the same user and scope. Connecting an eleventh device can revoke the oldest device token, which will then require reconnection.

Gist updates do not provide compare-and-swap semantics. Concurrent writers therefore provide eventual convergence rather than transactional cross-device consistency. Tabstow reads back each write and retries when another writer wins the race.
