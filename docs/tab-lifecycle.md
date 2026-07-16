# Tab Lifecycle Automation

Status: Accepted for implementation  
Date: 2026-07-15

## Goal

Phase 3 and Phase 4 ship as one Tab Lifecycle capability with two independent consent boundaries:

1. Automatically sleep eligible tabs after a configured period of Tab Inactivity.
2. Suggest that eligible Long-sleeping Tabs be safely moved to Saved windows.

Success means Tabstow can reduce memory use and later reduce tab-strip clutter without inferring tab opening time, automatically closing a tab, or synchronizing device-specific behavior.

## Confirmed boundaries

- Every eligible Sleeping Tab may enter the suggestion flow regardless of whether Chrome, manual Tabstow sleep, or automatic Tabstow sleep initiated the discard. Timing uses an Observed Sleep Period, never an inferred exact discard time. See [ADR 0021](adr/0021-base-stow-suggestions-on-observed-sleep-periods.md).
- The policy, thresholds, observation records, snoozes, and suppressions remain Device-local State. See [ADR 0022](adr/0022-keep-tab-lifecycle-policy-device-local.md).
- A confirmed multi-window action creates one Tab Session per contributing source window after Saved URL deduplication. See [ADR 0023](adr/0023-group-lifecycle-stows-by-source-window.md).
- Stow is save-first: every resulting session becomes durable in one local transaction before any browser tab may close. See [ADR 0024](adr/0024-make-suggested-stows-save-first.md).
- Chrome versions without `Tab.lastAccessed` retain all features except automatic sleep. See [ADR 0025](adr/0025-gate-automatic-sleep-by-capability.md).
- Suggestions preserve Saved windows' global Saved URL uniqueness and never close a hidden or excluded duplicate. See [ADR 0026](adr/0026-preserve-saved-url-uniqueness-in-stow-suggestions.md).

## Non-goals

- Tracking or estimating how long a tab has been open.
- Automatically closing or automatically stowing tabs.
- Synchronizing lifecycle policy or observations through Gist.
- Reconstructing original Chrome windows or tab groups during restore.
- Adding a content script, host permission, operating-system notification, or toolbar badge.
- Changing the existing global Saved URL uniqueness model.
- Adding per-site allowlists or custom durations in this release.

## Recommended policy defaults

| Rule | Default | Presets | Notes |
|---|---:|---|---|
| Automatic sleep | Off | Off / On | Requires explicit local consent. |
| Sleep after inactivity | 7 days | 1, 3, 7, 14, 30 days | The saved value is retained while the rule is off. |
| Stow Suggestions | On | Off / On | Suggestions never act without confirmation. |
| Suggest after observed sleep | 14 days | 3, 7, 14, 30 days | The saved value is retained while the rule is off. |
| Remind later | 7 days | Fixed | Applies only to the candidates visible when invoked. |
| Automatic scan cadence | 30 minutes | Fixed | The first scan is due one minute after enabling. |

Seven inactive days is intentionally conservative because discard can lose in-memory page state. Fourteen additional observed sleeping days keeps the default-on suggestion from becoming noisy. Users who prefer a more aggressive policy can select shorter presets.

## Capability detection

Automatic-sleep capability is tri-state:

- `supported`: a successful Tabs query proves that `lastAccessed` is available.
- `unsupported`: a successful Tabs query shows that the runtime does not expose `lastAccessed`; the UI asks the user to update to Chrome 121 or later.
- `unavailable`: the capability query failed; the UI offers Retry and does not mislabel the failure as an old browser.

The background rejects an attempt to enable automatic sleep unless capability is `supported`. If a previously enabled policy is loaded after a browser downgrade, automatic sleep is effectively off while the user remains able to turn the stored rule off. Every scan also rejects a tab whose `lastAccessed` is missing, non-finite, negative, or in the future. There is no fallback to opening time or first-observed time.

Manual sleep, Sleeping state, Observed Sleep Period tracking, and Stow Suggestions do not depend on `lastAccessed` and remain available.

## Automatic-sleep eligibility

A tab is eligible only when all conditions are true immediately before `discard()`:

- It has a numeric tab ID and an HTTP or HTTPS URL.
- It belongs to a normal, non-incognito Chrome window.
- It is not the Selected Tab in its window.
- It is not already discarded, pinned, or audible.
- `autoDiscardable` is not `false`.
- It has a valid `lastAccessed` at or before the configured inactivity cutoff.

The scanner queries all tabs, orders eligible candidates by oldest `lastAccessed`, and re-reads every candidate before acting. It processes candidates independently so one closed tab or API failure does not stop the remaining scan. A concurrent alarm, bootstrap, or policy-triggered scan joins the existing scan instead of starting another one. Disabling or changing the policy invalidates an in-flight scan before its next discard.

The policy dialog previews the number of tabs that currently match a draft automatic-sleep rule. Saving an enabled rule is explicit consent; the first automatic scan is scheduled for approximately one minute later.

## Observation model

Observation records use versioned extension local storage, separate from synchronized `ExtensionSettings`. A browser-session UUID lives in extension session storage so an MV3 worker restart can be distinguished from a browser restart.

Each record contains only the minimum durable identity and timing data:

- A random `observationId` used by UI commands.
- The last Chrome tab ID.
- The browser-session UUID.
- A SHA-256 fingerprint of the exact URL; the durable record stores no title, favicon, or plain URL.
- A valid `lastAccessed` value when the browser supplies one.
- `observedSleepingSince` and `lastObservedAt` timestamps.
- Optional per-observation `snoozedUntil` and `suppressedUntilWake` state.

All read-modify-write operations pass through one serialized storage queue. Service-worker globals may coalesce active work but are never the durable source of truth.
A successful policy update invalidates older in-flight lifecycle work before reconciliation, so stale event or query results cannot repopulate observations after Stow Suggestions are disabled.

### Starting and ending a period

- An eligible discarded HTTP(S) tab with no matching record starts a new period at the current time. Existing time is never backdated.
- A successful manual or automatic discard records the transition directly; tab events provide a second authoritative signal.
- Repeated observations of the same eligible Sleeping Tab preserve the original start.
- `lastAccessed` continues a period only when it matches the recorded value: a differing valid value proves a missed activation, while a missing, invalid, or future value resets conservatively when the record previously held valid evidence. Two unavailable values may continue within the same browser session.
- Waking, activation, removal, URL change, tab replacement, or transition into a lifecycle-protected state ends the current record. Re-qualifying later starts a new period.
- Disabling Stow Suggestions clears observation, snooze, and suppression data. Re-enabling starts currently eligible Sleeping Tabs at the next observation time.
- Malformed records and future timestamps reset conservatively.

### Worker and browser restart

- Within one browser session, identity requires the same tab ID and exact-URL fingerprint.
- Across a browser restart on Chrome 121+, continuity is retained only when one old record and one live Sleeping Tab uniquely match on exact-URL fingerprint and valid `lastAccessed`.
- Ambiguous duplicates, missing identity fields, or Chrome versions without `lastAccessed` start a new period at the current time.
- Unmatched records never surface as suggestions and are pruned after 30 days.

Background listeners are registered synchronously for `tabs.onCreated`, `tabs.onUpdated`, `tabs.onActivated`, `tabs.onRemoved`, and `tabs.onReplaced`. Bootstrap and suggestion requests also perform a full Tabs reconciliation to recover missed events.

## Stow Suggestion eligibility

A suggestion candidate must currently:

- Match a live observation by `observationId`, tab ID, and exact-URL fingerprint.
- Still be discarded and past the configured Observed Sleep Period threshold.
- Be an HTTP(S) tab in a normal, non-incognito window.
- Be non-selected, non-pinned, non-audible, and not marked `autoDiscardable: false`.
- Be neither snoozed nor suppressed for the current period.
- Have a Saved URL that is not already present in Saved windows.

Candidates are ordered by oldest observed period, then source window and tab index. Multiple live tabs with the same Saved URL are reduced to the earliest observed candidate before Review. The banner count is global across normal windows and is not affected by the current search text or window filter.

Suggestions are calculated when the New Tab opens or regains focus and after relevant tab state changes. They do not require another periodic alarm.

## New Tab experience

### Tab Lifecycle dialog

The existing Sleep policy entry becomes **Tab lifecycle** and opens a dedicated dialog containing:

- An Automatic sleep toggle and inactivity preset.
- A Stow Suggestions toggle and observed-sleep preset.
- A device-local explanation.
- An automatic-sleep capability or upgrade message.
- A live preview such as “12 tabs currently match this rule and may sleep soon after saving.”
- Explicit **Cancel** and **Save settings** actions; toggles do not write immediately.

Threshold controls remain visible but disabled while their rule is off. Loading failure keeps the dialog open with Retry. Saving failure preserves the draft. Saving locks dismissal until the request settles.

Recommended unsupported copy:

- English: “Automatic sleep requires Chrome 121 or later. Update Chrome to use inactivity-based rules. Manual sleep and Saved windows suggestions still work.”
- Chinese: “自动休眠需要 Chrome 121 或更高版本。请更新 Chrome 后使用基于未访问时长的规则；手动休眠和“已保存的窗口”建议仍可使用。”

### Suggestion banner

An inline banner appears below the Active Tabs tools and above the window filter:

> N tabs have been observed sleeping on this device for at least 14 days. Review them before moving them to Saved windows.

It offers **Review** and **Remind me about these in 7 days**. Snooze applies to the currently listed observation IDs; a newly qualifying tab may still produce a banner.

### Review dialog

- The reviewed snapshot stays stable while the dialog is open; the background revalidates on submit.
- Rows are grouped by contributing source window and retain current Chrome order.
- Each row shows favicon, title, URL/domain, and conservative “observed sleeping for at least N days” copy derived from the live tab.
- All visible candidates start selected and may be deselected; **Select all** and **Clear all** remain available.
- **Open tab** focuses and wakes a row. **Keep sleeping** suppresses that observation until it wakes or navigates.
- The summary shows selected tab count and resulting post-deduplication saved-window count.
- The primary action says **Move N tabs to Saved windows and close original tabs** and is disabled at zero selected rows.
- The copy states that nothing is saved or closed before confirmation and does not claim full Undo support.

## Confirmed Stow transaction

The UI submits only stable observation IDs. It never supplies trusted URLs, window IDs, or lifecycle state.

The background:

1. Serializes confirmations to prevent double-submit races.
2. Resolves each observation and re-reads its live tab.
3. Drops stale, changed, protected, already-saved, and duplicate Saved URLs.
4. Groups survivors by current source window and tab index.
5. Creates every non-empty Tab Session in one Dexie transaction, checking Saved URL uniqueness inside that transaction and reconciling the sync read model once.
6. If persistence fails, closes nothing and returns the error while Review remains open.
7. After persistence, re-reads each represented tab and closes it individually only when its observation identity, exact URL, Sleeping state, and protections still match.
8. Retains the Saved copy when a tab changed or closing failed, suppresses repeat suggestions for that period, and reports exact counts.

The result distinguishes:

- Saved tabs and created sessions.
- Closed original tabs.
- Tabs skipped because state changed or the Saved URL was no longer available.
- Close failures after safe persistence.

Only a result that saved at least one tab is a Sync-relevant Mutation. Lifecycle policy and observation messages never schedule Gist synchronization.

## Runtime and message boundaries

Recommended device-local messages:

- `tab-lifecycle:get-state`
- `tab-lifecycle:update-policy`
- `tab-lifecycle:preview-auto-sleep`
- `tab-lifecycle:list-suggestions`
- `tab-lifecycle:snooze-suggestions`
- `tab-lifecycle:suppress-suggestions`
- `tab-lifecycle:stow-suggestions`

One named repeating alarm belongs only to automatic sleep. Install, startup, service-worker bootstrap, and policy updates reconcile whether it should exist; enabled policy schedules one minute initially and every 30 minutes thereafter, while disabled policy clears it. Delayed or missed Chrome alarms produce one current timestamp-based scan and never replay missed intervals.

No new manifest permission or content script is required.

## Acceptance criteria

### Policy and compatibility

- Defaults and every allowed preset normalize correctly; malformed local data falls back safely.
- Lifecycle values never enter the sync document, and lifecycle updates never schedule synchronization.
- Supported, unsupported, and transient-error capability states render differently.
- The background rejects unsupported enable attempts while manual sleep and suggestions continue working.

### Automatic sleep

- Exact threshold boundaries work with a controllable clock.
- Selected, discarded, pinned, audible, incognito, non-HTTP(S), protected, missing-ID, invalid-time, and recently accessed tabs are skipped.
- Close, activation, navigation, pin/audio, wake, and `lastAccessed` races are revalidated immediately before discard.
- One failure does not stop other candidates; overlapping scans do not double-discard.
- Alarm creation, correction, clearing, worker bootstrap, and delayed wake behavior are tested.

### Observations and suggestions

- First observation begins now; repetition preserves the start; all discard origins behave equally.
- Wake, removal, navigation, replacement, and protection transitions reset the period.
- Worker restart preserves identity; unique supported-browser restart matching may preserve it; ambiguous or unsupported matching resets it.
- Snooze affects current candidates only; suppression lasts until wake/navigation; disabling suggestions clears tracking.
- Suggestion ordering, threshold equality, all-window counting, existing Saved URLs, and live duplicates are deterministic.
- Merely observing, listing, snoozing, suppressing, or reviewing never saves or closes a tab.

### Safe Stow

- Confirmation rejects malformed, duplicate, stale, and changed observation IDs.
- One source window creates one session after deduplication and preserves tab order; empty groups create no session.
- Injected batch persistence or sync-read-model failure rolls back all sessions and closes nothing.
- Post-save state changes retain the Saved copy and leave the live tab open.
- Individual close failures produce accurate saved, session, closed, skipped, and failed counts.
- Already-saved, exact duplicate, fragment-only variant, and concurrent-sync races never close an unrepresented URL.
- Concurrent or retried confirmations do not create duplicate sessions or close the wrong tab.

### UI and integration

- Dialogs cover loading, retry, unsupported, dirty draft, saving, empty, full success, partial success, and persistence failure states in English and Chinese.
- Focus management, Escape behavior, labels, checkbox grouping, and disabled actions remain keyboard accessible.
- A successful Stow refreshes Active Tabs, Saved windows, and the suggestion count.
- The new Stow message schedules synchronization only when at least one tab was saved.

## Small-commit implementation sequence

1. `feat(tabs): add device-local lifecycle policy`
2. `feat(tabs): track observed sleep periods`
3. `feat(tabs): run automatic sleep scans`
4. `feat(tabs): expose long-sleep suggestions`
5. `feat(sessions): create session batches atomically`
6. `feat(tabs): safely stow suggested tabs`
7. `feat(newtab): configure tab lifecycle policy`
8. `feat(newtab): review long-sleeping tabs`
9. `docs(tabs): add lifecycle manual qa`

Every implementation commit includes its directly corresponding tests. Final verification runs the complete Bun test suite, typecheck, production extension build, and targeted Chrome extension QA.
