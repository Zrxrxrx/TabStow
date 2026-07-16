# Manual QA

## UI audit evidence

Use a disposable Chrome for Testing profile. Never connect the audit runner to a daily-use profile or a profile containing GitHub credentials. On macOS, use the mock keychain flag below and never approve a Chromium Safe Storage prompt for this audit.

1. Build the production MV3 extension and inspect the runner contract:

   ```bash
   bun run build
   bun run audit:ui -- --help
   ```

2. From the repository root, launch Chrome for Testing with the production build as the only enabled extension. Chrome 136 and later require a non-default `--user-data-dir` for remote debugging:

   ```bash
   PROFILE_DIR="$(mktemp -d -t tabstow-ui-audit.XXXXXX)"
   touch "$PROFILE_DIR/.tabstow-ui-audit-profile"
   BUILD_DIR="$(pwd)/apps/extension/.output/chrome-mv3"
   "/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing" \
     --user-data-dir="$PROFILE_DIR" \
     --disable-extensions-except="$BUILD_DIR" \
     --load-extension="$BUILD_DIR" \
     --remote-debugging-port=9333 \
     --use-mock-keychain \
     --lang=en-US \
     --enable-automation \
     --no-first-run
   ```

3. Open a New Tab once so the Manifest V3 worker and override are active. Do not add sync credentials or fixture data. Keep the clean profile at light mode and 100% tab zoom.
4. Run the baseline case. The output directory must be new or empty so stale evidence cannot be reused:

   ```bash
   bun run audit:ui -- \
     --port 9333 \
     --case BASELINE \
     --output .artifacts/ui-audit/<commit>/BASELINE
   ```

   If the clean profile exposes more than one extension target, copy Tabstow's ID from `chrome://extensions` and add `--extension-id <id>`.

5. Attach `assertions.json` and `BASELINE.png` to the PR. The report records the current commit and dirty state, audited baseline, Chrome/CDP versions, production-build SHA-256, requested and observed case metadata, assertion results, sanitized runtime errors, and screenshot hash. A threshold failure or any runtime exception, console error/assert, or Log error exits non-zero.
6. Close Chrome for Testing and delete `PROFILE_DIR`; discarding the entire profile is the cleanup boundary.

### FINDING-004 feedback layout

With the production extension and disposable Chrome profile from the preceding workflow running, execute the four-case feedback matrix:

```bash
bun run audit:ui -- --port 9333 --case FINDING-004-NONE --output .artifacts/ui-audit/<commit>/FINDING-004-NONE
bun run audit:ui -- --port 9333 --case FINDING-004-STOW --output .artifacts/ui-audit/<commit>/FINDING-004-STOW
bun run audit:ui -- --port 9333 --case FINDING-004-RESTORE --output .artifacts/ui-audit/<commit>/FINDING-004-RESTORE
bun run audit:ui -- --port 9333 --case FINDING-004 --output .artifacts/ui-audit/<commit>/FINDING-004
```

The finding-specific cases insert audit-only feedback markup after the real production New Tab renders. Component tests cover the actual Stow and Restore action-to-message wiring; these runtime cases isolate the production CSS geometry. Confirm the no-message case leaves no empty row, the 1440px Stow and 768px Restore messages remain one line, and the 390px long error wraps while staying fully visible above Active and Saved content. Every case must report zero feedback/workspace overlap, zero feedback/Saved overlap, and zero feedback viewport overflow.

### FINDING-006 focus order and modal isolation

Run the desktop and narrow interaction cases against the same clean production build:

```bash
bun run audit:ui -- --port 9333 --case FINDING-006-DESKTOP --output .artifacts/ui-audit/<commit>/FINDING-006-DESKTOP
bun run audit:ui -- --port 9333 --case FINDING-006 --output .artifacts/ui-audit/<commit>/FINDING-006
```

Both cases use real CDP Tab input and production controls. They record the complete focus trace, exercise Quick Link modal focus containment and restoration, then leave Extra with its nested Add todo form open for evidence. Require the compressed region order `top|quick-links|active|saved|auxiliary`, a complete Tab sequence, zero Quick Link modal isolation failures, two body-level modal portals, an inert application root and lower backdrop, and focus inside the interactive top modal. The 768px case does not assert horizontal overflow; responsive reflow is covered separately by FINDING-001.

### FINDING-001 responsive New Tab reflow

Run the fixed responsive matrix against the same clean production build:

```bash
bun run audit:ui -- --port 9333 --case FINDING-001-DESKTOP --output .artifacts/ui-audit/<commit>/FINDING-001-DESKTOP
bun run audit:ui -- --port 9333 --case FINDING-001-1024 --output .artifacts/ui-audit/<commit>/FINDING-001-1024
bun run audit:ui -- --port 9333 --case FINDING-001-768 --output .artifacts/ui-audit/<commit>/FINDING-001-768
bun run audit:ui -- --port 9333 --case FINDING-001 --output .artifacts/ui-audit/<commit>/FINDING-001
bun run audit:ui -- --port 9333 --case FINDING-001-ZOOM --output .artifacts/ui-audit/<commit>/FINDING-001-ZOOM
```

The cases cover `1440@100%`, `1024@100%`, `768@100%`, `390@100%`, and `1024@200%`. They apply the requested production zoom, theme, and language, then use focused audit-only empty, representative, or long collection rows to isolate the production scroll geometry. Require zero horizontal document overflow, the expected fixed/sticky-rail/single-flow scroll ownership, visible and reachable language, theme, sync, Stow, Extra, and Settings controls, viewport-bounded Quick Link dialogs, and reachability of the final Quick Link, Active Tab, and Saved Tab in populated and long states.

At 1024 pixels and wider, Quick Links, Active Tabs, and Saved for Later retain independent scrolling. From 768 through 1023 pixels, the rail remains viewport-height while the document scrolls stacked Active and Saved regions. Below 768 pixels and at the effective viewport produced by 200% zoom, every region uses one document flow. Internal horizontal scrolling in the window filter remains allowed; the document itself must not scroll horizontally.

Repeat empty, representative, and long collections in light/dark and English/Simplified Chinese. During the long-state pass, drag within Quick Links, Active Tabs, and Saved for Later toward the current scroll edge and confirm Chromium auto-scroll continues without changing existing drag semantics.

- Load `apps/extension/.output/chrome-mv3` as an unpacked extension in Chrome.
- Open a new tab and confirm the V2 desktop shell appears with the Quick Links rail, sticky top strip, Active Tabs region, and Saved for Later region.
- At 1440px, 1180px, and 1024px widths, confirm all three regions remain visible, the page has no horizontal overflow, and Active/Saved scroll independently.
- Repeat the width matrix in light/dark mode and English/Simplified Chinese. Confirm the saved theme is applied before content appears and no light-mode flash occurs.
- Verify empty, typical, and long Quick Link/Active/Saved collections. At desktop widths, rail branding and utility controls stay fixed while the Quick Link list scrolls. At tablet widths, the Quick Links rail stays sticky and auxiliary controls remain reachable at the end of the document. Below 768px, every region remains reachable in document flow.
- Click the extension toolbar icon and confirm the current window's eligible tabs are stowed and no popup opens.
- Open several ordinary web tabs and use **Stow current window**.
- Open two normal Chrome windows with pinned, ungrouped, and natively grouped web tabs.
- Confirm Active Tabs shows the focused window first and preserves each window's eligible tab-strip order.
- Drag an ungrouped tab, reorder a tab inside a group, move a tab into and out of a group, and move a tab between windows.
- Reorder a complete Chrome group and move it to the other normal window.
- Confirm pinned tabs only accept pinned destinations and retain their pinned state across windows.
- Change tab order, group membership, group title/color/collapsed state, and window focus directly in Chrome; confirm the dashboard refreshes without manual Refresh or Collapse controls.
- Reload Tabstow and confirm no local URL/manual grouping or stale local order returns.
- Confirm Active, Saved, Recovery, search suggestion, and Quick Link rows show real favicons and fall back to the neutral page glyph when an icon fails. Explicit Quick Link emoji and uploaded images remain intact.
- Confirm only Chrome tabs with `audible === true` show Audible and only tabs with `discarded === true` show Sleeping. Sleep and policy controls must not send discard/wake mutations.
- Use the All/current/other-window filters and confirm real counts, internal horizontal scrolling for many windows without document overflow, and no change to Chrome-owned tab order.
- Close one tab, close a group, and close duplicates.
- Add and open a quick link.
- Enter Quick Link Edit mode, add/edit/upload/remove links, and drag the full row before another link or to the end. Confirm ordinary mode opens links and offers no reorder buttons.
- Create, complete, search, and clear todos.
- Toggle fixed light/dark mode and English/Simplified Chinese. Confirm no palette, transparency, system mode, or custom-background control remains.
- Use Unified Search to filter Active and Saved collections, choose Active/Saved suggestions, press `/` to focus, Escape to clear, and Enter in the input to run the default web search.
- Confirm **Stow current window** displays the authoritative eligible count, disables at zero, prevents duplicate clicks, uses indeterminate busy copy, and reports the real saved/closed counts on partial success.
- Confirm the saved session appears and eligible tabs close.
- Save duplicate URLs with different fragments/default ports and distinct query strings; confirm only the newest normalized copy remains and query strings remain distinct.
- Use quick tab search and confirm Active tabs and Saved for later filter without running a web search or flattening their groups; confirm Saved drag-and-drop is disabled until the query is cleared.
- Reorder saved sessions and tabs, move a tab between sessions, reload the extension, and confirm the order persists.
- Left-click a saved tab and confirm it opens in the background, moves to History, and keeps Tabstow focused; middle-click another and confirm it remains saved.
- Restore a saved session and delete another, then confirm both move to History and can be restored to Saved for later.
- Open Recovery Bin and confirm it shows the newest five History entries after sorting by moved time, exposes loading/empty/error states, restores complete entries, refreshes Saved, and links to full History.
- Open a History tab without consuming it and permanently delete a History entry.
- Register a test OAuth App with Device Flow enabled, build with `WXT_GITHUB_OAUTH_CLIENT_ID`, and prepare an existing Gist containing `tabstow.sync.json`.
- In two separate Chrome profiles, choose **Connect GitHub**, complete Device Flow, and bind both profiles to the same existing Gist.
- Verify automatic discovery for one unlisted canonical file, explicit selection for multiple candidates, manual Gist ID/filename entry for no candidates, and the warning before a public Gist is confirmed.
- With local Saved for Later and Quick Link data present, confirm that Tabstow requires target confirmation before the first merge.
- Open a New Tab in profile A and confirm it reads remote changes immediately. Refocus repeatedly within 60 seconds and confirm it does not poll on every focus.
- Make a burst of Saved for Later and Quick Link changes. Confirm local UI updates immediately and one delayed Gist update occurs roughly 60 seconds after the final change.
- Close the New Tab before the quiet deadline and confirm the background alarm still updates the Gist. Repeat across browser restart and sleep/wake.
- Concurrently add, move, reorder, consume, restore, and delete Saved tabs and sessions in both profiles. Reopen/focus each profile and confirm they converge, including deletion and empty-session removal.
- Restore a History entry and confirm the restored session and tabs synchronize with fresh identities. Confirm remote deletions do not create local History entries.
- Concurrently add, edit, reorder, and delete Quick Links. Upload an image icon and confirm the image remains local while synchronized label/order/deletion changes still converge.
- Change **Save pinned tabs when stowing** and **Close pinned tabs after saving** independently on different profiles and confirm revision-based convergence.
- Disconnect from the network, make local changes, and confirm the New Tab says changes are saved locally. Reconnect and confirm bounded retry completes.
- Verify the compact sync status for synced, pending, syncing, retrying, paused, setup-needed, and unavailable states. The status button always opens real diagnostics.
- For a paused incident, confirm details auto-open once, dismissal persists for the same action/reason, setup/authorizing does not reset it, and a connected healthy state resets acknowledgement for a future incident.
- Use Settings **Pull** and **Push** and confirm Saved URLs deduplicate while local History remains unchanged. Verify those buttons do not appear on the New Tab.
- Corrupt the non-empty sync file and confirm Tabstow pauses, displays an unable-to-sync message, and offers Open Gist/Retry/Choose another without overwriting it.
- Rename or remove the bound file and confirm Tabstow pauses instead of silently switching Gists.
- Disconnect and confirm local Saved for Later, Quick Links, and History remain, the remote Gist is unchanged, and Settings links to GitHub for full OAuth revocation.
- Upgrade a valid version-one file and confirm only version two is written afterward.

## Tab lifecycle

- Open **Tab lifecycle** from Active Tabs. Confirm Automatic sleep defaults off, Saved for later suggestions default on, thresholds remain visible while disabled, and Cancel discards every draft change.
- Save each automatic-sleep preset and each suggestion preset. Reload Tabstow and confirm the device-local policy persists without appearing in the Gist sync document.
- On Chrome 121 or later, enable Automatic sleep and confirm the dialog shows a live matching-tab preview before Save. On an older Chromium build, confirm only Automatic sleep is disabled and the upgrade message appears; manual sleep and suggestions remain available.
- Simulate a transient Tabs API failure and confirm the dialog shows Retry rather than claiming the browser is too old. Retry must preserve unsaved suggestion settings.
- Leave eligible HTTP(S) tabs inactive beyond the selected threshold. Confirm only normal-window, non-selected, non-pinned, non-audible, non-incognito, auto-discardable tabs sleep; recent, protected, internal, and already-sleeping tabs remain unchanged.
- Change, activate, pin, make audible, close, or navigate a candidate during a scan. Confirm the scanner revalidates it and continues processing other eligible tabs after an individual failure.
- Sleep tabs manually, through Automatic sleep, and through Chrome Memory Saver. Confirm every origin can begin the same observed-sleep flow, while waking or navigating starts a new observed period.
- After candidates reach the observed-sleep threshold, confirm the global banner appears below the Active Tabs tools regardless of search text or selected window filter.
- Choose **Remind me about these in 7 days** and confirm only the currently listed candidates disappear. A newly qualifying candidate may still show the banner.
- Open Review and confirm the snapshot is grouped by source window in Chrome tab order, every row starts selected, and Select all/Clear all update both the tab and resulting-session counts.
- Use **Open tab** on one row and confirm Chrome focuses and wakes it, then removes it from the review. Use **Keep sleeping** on another and confirm it stays open but does not reappear until it wakes or navigates.
- Review live duplicate URLs, fragment-only variants, and URLs already present in Saved for later. Confirm only the deterministic unsaved representative appears and excluded tabs are never closed.
- Confirm a multi-window selection creates one non-empty Saved session per contributing window, persists every represented tab before closing any original, and closes originals individually.
- Change, wake, move, or protect a selected tab while confirmation is running. Confirm its Saved copy remains after persistence and the changed original stays open. Force one close failure and confirm other represented tabs still close with accurate partial-result counts.
- Trigger confirmation twice quickly and retry the same completed request. Confirm no duplicate Saved sessions are created and no unrelated tab closes.
- After a successful or partial suggested Stow, confirm Saved for later, Active Tabs, and the banner refresh together. Only a result that saved at least one tab should schedule Gist synchronization.
- Disable Saved for later suggestions, reload the service worker, and confirm observation, snooze, and suppression state is cleared. Re-enable it and confirm currently sleeping tabs begin a new conservative observed period rather than inheriting an unknown duration.
