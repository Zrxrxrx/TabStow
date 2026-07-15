# Manual tab sleep in Tabstow

Date: 2026-07-12

## Conclusion

Yes. Tabstow can add a manual **Sleep tab** action to each row in the Active Tabs workspace by sending the tab ID to the MV3 background service worker and calling `chrome.tabs.discard(tabId)`. Chrome keeps a discarded tab in the tab strip, unloads its page from memory, and reloads it when the user activates it. The API has existed since Chrome 54; its Promise form is available since Chrome 88. ([Chrome Tabs API: `discard`](https://developer.chrome.com/docs/extensions/reference/api/tabs#method-discard))

This is a small extension of the existing architecture, not a simulated “close and save URL” feature. It needs no content script and no new host permission.

## Verified behavior

- Always pass the row's explicit tab ID. Omitting it asks Chrome to choose its least-important tab, which is not appropriate for a row action. A successful call resolves after the operation and returns the resulting `Tab`. ([Chrome Tabs API: `discard`](https://developer.chrome.com/docs/extensions/reference/api/tabs#method-discard))
- Follow the public API contract and do not offer the action when `tab.active === true` or `tab.discarded === true`: Chrome documents that a specified active or already-discarded tab is not discarded. `active` means active **within its own window**, even if that window is not focused. ([Chrome Tabs API: `discard`](https://developer.chrome.com/docs/extensions/reference/api/tabs#method-discard), [`Tab.active`](https://developer.chrome.com/docs/extensions/reference/api/tabs#property-Tab-active))
- `Tab.discarded` is the UI's Sleeping state. It becomes true when content is unloaded and returns to false when activation reloads the page. `Tab.autoDiscardable` is separate: it only controls whether Chrome may discard the tab automatically under resource pressure. ([Chrome Tabs API: `Tab`](https://developer.chrome.com/docs/extensions/reference/api/tabs#type-Tab), [`tabs.update`](https://developer.chrome.com/docs/extensions/reference/api/tabs#method-update))
- `autoDiscardable: false` does not block a manual extension discard. Chromium's official unit test explicitly verifies that external/manual discard remains allowed and that the flag persists through discard/reload. ([Chromium `TabLifecycleUnitTest.AutoDiscardable`](https://chromium.googlesource.com/chromium/src/+/main/chrome/browser/resource_coordinator/tab_lifecycle_unit_unittest.cc))
- Chrome exposes `discarded`, `autoDiscardable`, and `audible` changes through `tabs.onUpdated`. Tabstow already listens to `onUpdated` and `onReplaced`, so its existing debounced authoritative snapshot refresh is the right synchronization mechanism; do not maintain sleeping state only in memory. ([Chrome Tabs API: `onUpdated`](https://developer.chrome.com/docs/extensions/reference/api/tabs#event-onUpdated))

### Permissions and MV3

`discard()` itself does not require a new permission. Chrome explains that most Tabs API operations need no permission and that the `"tabs"` permission specifically unlocks the sensitive `url`, `pendingUrl`, `title`, and `favIconUrl` fields. Tabstow already declares `"tabs"` for its current tab-list metadata, so the manifest needs no change. ([Chrome Tabs API: permissions](https://developer.chrome.com/docs/extensions/reference/api/tabs#permissions))

The Tabs API is available in extension pages and the MV3 service worker, but not in content scripts. The existing background message route is therefore an appropriate owner for the privileged action. MV3 workers are event-driven, may terminate after inactivity, and lose globals, so the handler should simply await `discard()` and return a result; Chrome remains the source of truth. ([Chrome Tabs API](https://developer.chrome.com/docs/extensions/reference/api/tabs), [extension service-worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle))

## Edge cases and product policy

- **Pinned:** the public `discard()` contract does not exempt a non-active pinned tab. Chromium treats extension/user-requested discards as external requests rather than automatic ranking decisions. Still, pinned tabs express user intent, so the MVP should disable sleep for them or require a deliberate confirmation. ([Chrome Tabs API: `discard`](https://developer.chrome.com/docs/extensions/reference/api/tabs#method-discard), [Chromium discard implementation](https://chromium.googlesource.com/chromium/src/+/main/chrome/browser/resource_coordinator/tab_lifecycle_unit.cc))
- **Audible/media:** the public contract likewise does not exempt a non-active audible tab. Discarding unloads the page, so it interrupts playback; disable the action while `tab.audible` is true. Audio/video capture and unsaved form state are not fully represented by the ordinary `Tab` object, so manual sleep should remain an explicit per-tab user action rather than an automatic bulk policy. ([Chrome Tabs API: `Tab.audible`](https://developer.chrome.com/docs/extensions/reference/api/tabs#property-Tab-audible), [`discard`](https://developer.chrome.com/docs/extensions/reference/api/tabs#method-discard))
- **Special URLs:** `discard()` has no documented host-permission or ordinary URL-scheme gate, but Chromium explicitly rejects DevTools tabs in the extension API implementation. Tabstow filters `chrome://`, `edge://`, `about:`, `chrome-extension://`, and `devtools://` tabs from this workspace, which is a sensible product boundary and avoids exposing its own new-tab page. ([Chromium `TabsDiscardFunction`](https://chromium.googlesource.com/chromium/src/+/main/chrome/browser/extensions/api/tabs/tabs_api.cc), [Chrome Tabs API permissions](https://developer.chrome.com/docs/extensions/reference/api/tabs#permissions))
- **Races/failure:** a tab can close, become active, or be discarded between snapshot and click. Treat the API failure as a normal row-level error, then refresh from Chrome. For multiple tabs, collect per-tab outcomes rather than letting one rejected call hide successful discards.

There is a current Chromium-main implementation/test discrepancy with the public docs around explicit external discard eligibility (including active tabs). For a stable extension contract, Tabstow should follow the public documentation and reject `active` targets itself rather than depend on version-specific internals. ([public `discard()` contract](https://developer.chrome.com/docs/extensions/reference/api/tabs#method-discard), [Chromium implementation](https://chromium.googlesource.com/chromium/src/+/main/chrome/browser/extensions/api/tabs/tabs_api.cc))

## Tab age and idle-time automation

Chrome does **not** expose a built-in tab creation/opening timestamp. The public `tabs.Tab` type has `lastAccessed` but no `createdAt`/`openedAt` field, and `tabs.onCreated` delivers a `Tab` without an event timestamp. Therefore an extension cannot recover the exact original opening time of a tab that already existed before the extension began observing it. `chrome.sessions.Session.lastModified` is not a substitute: that API describes recently closed or synced sessions, not the creation time of currently open local tabs. ([Chrome Tabs API: `Tab` and `onCreated`](https://developer.chrome.com/docs/extensions/reference/api/tabs), [Chrome Sessions API](https://developer.chrome.com/docs/extensions/reference/api/sessions))

Chrome 121+ does expose `Tab.lastAccessed`: epoch milliseconds for the last time the tab became active in its own window. This directly supports a policy such as “sleep tabs not viewed for 24 hours,” which is generally safer and more meaningful than “sleep tabs opened 24 hours ago.” It is not page-navigation time and not proof that the user read or interacted with the page. ([`Tab.lastAccessed`](https://developer.chrome.com/docs/extensions/reference/api/tabs#property-Tab-lastAccessed), [Chrome 121 release note](https://developer.chrome.com/docs/extensions/whats-new#chrome_121_new_lastaccessed_property_on_tabstab))

If exact age **since Tabstow observed creation** is required, Tabstow can record `Date.now()` from a top-level `tabs.onCreated` listener, delete the record on `tabs.onRemoved`, and reconcile unknown tabs with `tabs.query({})` at startup. That gives exact tracking only from the observation point onward. Tab IDs are documented as unique only within a browser session, so a persisted timestamp keyed only by `tabId` must not be trusted across browser restarts; restored tabs need a new observation epoch or a deliberately defined, best-effort matching strategy. ([`tabs.onCreated`](https://developer.chrome.com/docs/extensions/reference/api/tabs#event-onCreated), [`Tab.id`](https://developer.chrome.com/docs/extensions/reference/api/tabs#property-Tab-id))

MV3 service-worker globals cannot hold this tracking state: Chrome normally terminates an idle worker after 30 seconds and explicitly recommends persistent storage instead of globals. Use IndexedDB or `chrome.storage.local` for observed creation metadata; `chrome.storage.session` intentionally clears on browser restart and is suitable if age is defined only within the current browser session. ([service-worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle), [Chrome Storage API](https://developer.chrome.com/docs/extensions/reference/api/storage))

Periodic enforcement should use `chrome.alarms`, not `setInterval`. Production alarms have a minimum 30-second interval, may be delayed, do not wake a sleeping device, and missed repeating alarms fire at most once after wake. Older Chrome versions do not guarantee alarm persistence across restart, so the worker should verify/recreate the alarm whenever it starts. Tabstow already declares the `alarms` permission. ([Chrome Alarms API](https://developer.chrome.com/docs/extensions/reference/api/alarms))

A conservative automatic-sleep scan is:

```ts
const cutoff = Date.now() - idleThresholdMs;
const tabs = await chrome.tabs.query({});

for (const tab of tabs) {
  const eligible =
    tab.id != null &&
    !tab.active &&
    !tab.discarded &&
    !tab.pinned &&
    !tab.audible &&
    typeof tab.lastAccessed === 'number' &&
    tab.lastAccessed < cutoff;

  if (eligible) await chrome.tabs.discard(tab.id);
}
```

If Tabstow relies exclusively on `lastAccessed`, it should either set `minimum_chrome_version` to 121 or feature-detect the property and fall back to its own observation data. Automatic **sleep** is less destructive than closing a tab but can still discard in-memory page state, so it requires explicit opt-in. Automatic **close** via `tabs.remove()` is technically possible, but it is destructive and remains outside this policy. The scan is best-effort because tabs can close or activate between query and action. ([Chrome Tabs API: `discard` and `remove`](https://developer.chrome.com/docs/extensions/reference/api/tabs))

## Confirmed Phase 3 and Phase 4 direction

The two phases form one Tab Lifecycle settings area but retain independent consent boundaries:

- Automatic sleep is disabled by default and must be enabled explicitly because discarding can lose in-memory page state.
- Automatic sleep requires the Chrome 121 `Tab.lastAccessed` capability. Older browsers keep the rest of Tabstow available but expose the automatic-sleep control as unavailable with an upgrade prompt; Tabstow never substitutes opening or first-observed time for Tab Inactivity.
- Stow Suggestions are enabled by default because they are local, non-destructive prompts; they never save or close a tab without explicit confirmation.
- The complete Tab Lifecycle Policy, including both toggles and their thresholds, remains Device-local State and is never enabled or changed by synchronization from another device.
- Stow Suggestions cover eligible Sleeping Tabs regardless of whether Tabstow or Chrome initiated the discard. Suggestion timing uses the conservative Observed Sleep Period defined in [ADR 0021](../adr/0021-base-stow-suggestions-on-observed-sleep-periods.md), never an inferred exact discard time.
- Confirming a multi-window Stow Suggestion creates one Tab Session per source Chrome window and preserves the selected tabs' order within that window. The review must state both the tab count and resulting session count, and it must not promise reconstruction of Chrome windows or tab groups.
- Confirmation saves every resulting session in one local batch before attempting any close. Persistence failure closes nothing; after persistence, each live tab is revalidated and closed only if it still matches the selected Sleeping Tab, while skipped or failed closes leave the Saved copy intact and produce an accurate partial-result summary.

## Minimal Tabstow change shape

1. Extend `ActiveBrowserTab` with `discarded`, `autoDiscardable`, and `audible`, which `tabs.query({})` already returns.
2. Add an `active-tabs:sleep` message and a background service function that validates an explicit ID, re-reads the tab to catch stale state, rejects active/already-discarded targets, and awaits `browser.tabs.discard(tabId)`.
3. Add a Sleep icon beside the existing Stow/Close row actions. Show a Sleeping status and disable it for active, discarded, pinned, or audible rows in the MVP.
4. On completion or error, run the existing authoritative snapshot refresh. The existing `onUpdated`/`onReplaced` subscription covers later reload/state changes.

Suggested verification: inactive normal tab sleeps; activation reloads it; active/already-sleeping rows are disabled; pinned/audible rows follow the chosen protection policy; `autoDiscardable: false` still permits manual sleep; a close/activate race produces an error and refreshes cleanly; no manifest permissions change.
