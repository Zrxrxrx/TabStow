# Tabstow UI / UX Audit Remediation Plan

**Status:** engineering-reviewed; implementation started with PR-00 verification infrastructure; no finding fix has started

**Audit source:** external gstack design audit dated 2026-07-16

**Baseline:** `5bc9f6a765a8464f5bfe74f59620ad4459e87369` on `main`

**Goal:** resolve all 12 findings from the 2026-07-16 full-frontend design audit. Every formal `FINDING-###` remains isolated in one issue PR. Engineering review adds one prerequisite PR for CI and reproducible UI evidence, so delivery is 12 issue PRs plus PR-00.

## Success criteria

1. Exactly 12 issue PRs close the 12 audit findings; PR-00 contains verification infrastructure only.
2. Each issue PR contains one finding, its tests, and finding-specific documentation/evidence. No issue PR absorbs another finding.
3. PR-00 and every issue PR pass focused tests, full typecheck, full tests, and the production build with Bun; GitHub PR CI runs the full code gate.
4. Every visual PR includes assertions and before/after screenshots from the real built MV3 extension. The assertion runner exits non-zero on a failed threshold.
5. New Tab has no horizontal overflow at 768px or 390px. Long Active, Saved, and Quick Links collections remain reachable at every breakpoint and at 200% zoom.
6. All three pages share the fixed light/dark product identity. English/Simplified Chinese surfaces contain no audit-listed mixed-language metadata.
7. No PR adds extension permissions, content scripts, remote code, Node/Bun APIs to the extension runtime, or a parallel storage/domain model.

## Engineering review findings absorbed

1. **Architecture, confidence 0.99:** an inline modal cannot make `#root` inert without disabling itself. `ModalDialog.tsx:105` currently returns the backdrop in place: `return (<div className="dialog-backdrop" ...>)`. PR-02 now requires a body portal and a tested modal stack.
2. **Architecture, confidence 0.98:** file overlap was incorrectly modeled as semantic dependency. Theme cleanup also followed Settings rewrite even though `OptionsApp.tsx:30` and `:462` put the soon-to-be-deleted `theme` field in the form. The DAG now has content and settings lanes, and FINDING-009 precedes FINDING-008.
3. **Architecture, confidence 0.97:** removing `min-width` alone does not make the page scrollable because `styles.css:1108-1114` also fixes root height and hides overflow. PR-03 now owns height, sticky behavior, and scroll ownership at every breakpoint.
4. **Architecture, confidence 0.94:** removing theme from current settings must retain tolerant legacy input, a rollback contract, and pre-mount theme application. PR-06 specifies all three.
5. **Code quality, confidence 0.99:** `OptionsApp.tsx:113-118` only appends to `settingsPatch`; change then revert stays dirty. PR-08 replaces this with persisted baseline + draft + derived minimal patch.
6. **Code quality, confidence 0.94:** a broad token extraction would mix legacy blue defaults with the V2 system. PR-04 shares only final semantic `--ts-*` tokens and requires computed-value parity on New Tab.
7. **Code quality, confidence 0.91:** recognizing generated session titles is presentation logic, not translation-dictionary logic. PR-10 uses a focused presentation adapter and preserves mismatched/custom titles.
8. **Code quality, confidence 0.96:** `role=listbox` without a listbox keyboard model is the wrong abstraction for current button results. PR-11 uses labelled groups of ordinary buttons and locks the five-local-plus-one-web contract.
9. **Test review, confidence 0.99:** the existing CDP scripts live outside the repository and collect rather than assert. PR-00 creates a repository-owned, failing runner and pins evidence to the audited commit.
10. **Test review, confidence 0.99:** the repository has no `pull_request` workflow. PR-00 adds one so the mandatory code gate is enforceable rather than prose.
11. **Test review, confidence 0.96:** runtime matrices lacked deterministic setup, output names, and metadata. Each PR now names its case; PR-00 defines the fixture/evidence contract.
12. **Test review, confidence 0.95:** feedback absence, nested modals, dirty sync rebasing, and stale filtered selection were missing regression cases. They are explicit below.
13. **Performance, confidence 0.91:** `tab-search.ts:53-108` collects and sorts every match before slicing five. PR-11 uses bounded rank buckets and precomputed context maps.
14. **Performance, confidence 0.88:** the Quick Link chooser renders every open tab. PR-11 filters locally and caps the visible list without adding virtualization or per-keystroke background calls.

## NOT in scope

- Undo or auto-dismiss for Stow/Restore feedback: the audit bug is overlap, and undo changes product behavior.
- A mobile-only navigation drawer: responsive reflow preserves every control with less state.
- System theme, palettes, transparency, or custom backgrounds: ADR-0019 keeps fixed light/dark modes.
- Settings-wide localization: the formal localization finding covers generated Saved/History metadata, not the currently English-only Settings product surface.
- New background messages, sync protocols, OAuth behavior, permissions, or database schemas: existing contracts solve the requested UI work.
- Persisting translated session titles: synchronized data remains locale-neutral.
- Keyboard drag-and-drop redesign: existing pointer/keyboard behavior is preserved; focus order and modal isolation are the scope.
- Screenshot-diff CI and a Playwright dependency: PR-00 uses the existing dependency-free raw-CDP approach plus deterministic assertions.
- Full list virtualization: bounded search/chooser rendering is sufficient for this audit.
- GitHub branch-protection administration: the workflow is versioned here; repository policy remains an owner setting.

## What already exists

| Existing capability | Reuse decision |
|---|---|
| `ModalDialog` focus trap, Escape handling, busy guard, and focus restoration | Keep the behavior; add portal/inert stack rather than introducing another dialog library. |
| `theme-preferences.ts` fixed `light | dark` key | Keep as the only source; use WXT `storage.watch` and remove the stale core setting. |
| `settingsPatchRef` preserving edits across `sync:data-changed` | Keep the rebase intent; replace append-only dirty detection with baseline/draft comparison. |
| `ActiveTabsSnapshot` windows, tabs, and Chrome groups | Reuse for search and Quick Link context; add no background contract. |
| Quick Link add form and History actions/workspace URL | Empty-state CTAs call existing behavior. |
| `i18n.ts`, explicit History locale formatting, and reason-key mapping | Extend only missing presentation paths; do not rewrite correct History date/reason code. |
| Vitest/jsdom, typecheck, build verification, and manual QA guide | Keep for logic/build gates; add real-browser assertions for CSS/layout. |
| External 2026-07-16 CDP scripts and evidence | Use as the pinned baseline/input for PR-00, not as an unversioned permanent gate. |

## Delivery rules

- Branch names use `codex/`; commits and PR titles use `type(scope): msg`.
- PR-00 lands first. Every later branch starts from latest merged `main`; independent lanes may use separate worktrees but must rebase and rerun the full gate before merge.
- “Depends on” below means semantic dependency. Shared-file collision is called out separately and is serialized only at merge time.
- Internal `TabSession`, `sessions:*`, `history:*`, IndexedDB records, and sync schemas retain their domain vocabulary unless PR-06 explicitly removes the retired theme field.
- Screenshots stay out of git and attach to PR evidence. Machine-readable assertion output records commit SHA, Chrome version, build hash, case ID, viewport, zoom, theme, and locale.
- Bun/Node APIs are allowed in repository development scripts, never in bundled extension runtime code.

## Architecture and dependency diagrams

```text
PR-00 verification foundation
          |
PR-01 F004 feedback -> PR-02 F006 DOM/modal -> PR-03 F001 responsive
                                                    |
                                              PR-04 F003 shell/tokens
                                               /                 \
Content lane: PR-05 F007 -> PR-07 F002 -> PR-09 F010 -> PR-10 F011 -> PR-11 F012
Settings lane:             PR-06 F009 -> PR-08 F008
                                               \                 /
                                         PR-12 F005 accessibility scale
```

Launch PR-05 and PR-06 in parallel after PR-04. After they merge, launch PR-07 and PR-08 in parallel. PR-09 through PR-11 stay sequential because they share New Tab/History/i18n files. PR-12 waits for both lanes and measures final controls rather than controls that later PRs remove.

```text
ModalDialog React child
        |
        +-- createPortal(..., document.body)
                    |
              modal stack [older ... top]
                    |-- #root inert while stack non-empty
                    |-- older backdrops inert
                    `-- top backdrop owns Escape/Tab
```

```text
settings:get / sync:data-changed
             |
       persisted baseline ----+
             |                 |
             +--> draft <--- user edits
                       |
              derive minimal patch
                 |            |
              clean         Save
                              |-- success -> new baseline + clean draft
                              `-- failure -> retain draft + patch
```

```text
local:tabstow-theme-preferences
       | get before mount             | WXT storage.watch
       v                              v
apply data-theme-mode ------> New Tab / Settings / History

legacy local/core/sync theme --> parse or ignore --> strip on current write
```

Inline ASCII comments are required only in `ModalDialog.tsx` for stack/inert ownership and in the theme bootstrap helper for load/watch/unsubscribe flow. Other diagrams stay in this plan to avoid comments that merely restate code.

## PR inventory

| PR | Finding | Branch | PR / squash title | Depends on |
|---:|---|---|---|---|
| 00 | foundation | `codex/test-ui-review-gates` | `test(ui): add reproducible pull request gates` | — |
| 01 | FINDING-004 | `codex/fix-feedback-layout` | `fix(newtab): keep action feedback in layout` | PR-00 |
| 02 | FINDING-006 | `codex/fix-newtab-focus-order` | `fix(newtab): align keyboard focus order` | PR-01 |
| 03 | FINDING-001 | `codex/fix-newtab-responsive` | `fix(newtab): support narrow viewport reflow` | PR-02 |
| 04 | FINDING-003 | `codex/fix-shared-ui-shell` | `fix(ui): unify utility page shell` | PR-03 |
| 05 | FINDING-007 | `codex/fix-product-terminology` | `fix(copy): unify saved window terminology` | PR-04 |
| 06 | FINDING-009 | `codex/fix-theme-source` | `fix(theme): use one extension theme preference` | PR-04 |
| 07 | FINDING-002 | `codex/fix-first-use-guidance` | `fix(newtab): guide the first stow` | PR-03, PR-05 |
| 08 | FINDING-008 | `codex/fix-settings-clarity` | `fix(settings): clarify sync and save behavior` | PR-06 |
| 09 | FINDING-010 | `codex/fix-empty-state-actions` | `fix(empty-state): expose next actions` | PR-05, merge after PR-07 |
| 10 | FINDING-011 | `codex/fix-zh-localization` | `fix(i18n): localize saved window metadata` | PR-09 |
| 11 | FINDING-012 | `codex/fix-search-context` | `fix(search): add source and tab context` | PR-03, PR-05, PR-10 |
| 12 | FINDING-005 | `codex/fix-ui-accessibility-scale` | `fix(ui): improve readability and target sizes` | PR-04, PR-07 through PR-11 |

## PR-00 — reproducible pull-request gates

**Outcome:** code gates run on every PR, and real-extension UI checks are repository-owned, case-addressable, and fail on breached assertions.

**Primary files:** add `.github/workflows/ci.yml`, `apps/extension/scripts/ui-audit.ts`, an assertion/case manifest, and root `audit:ui` script; update `.gitignore` and `docs/manual-qa.md`.

**Boundary:** CI runs `bun install --frozen-lockfile`, typecheck, tests, and build. The raw-CDP runner uses Bun only as a development tool, connects to a documented clean Chrome profile, writes ignored artifacts, and exits non-zero for console errors or selected case failures. It records the audited baseline commit and stable numeric thresholds; `design-baseline.json` remains a qualitative audit summary, not a geometry baseline. State setup may be documented/manual when a real browser action is essential, but every case names setup, cleanup, assertions, and screenshot output. No runtime dependency or extension permission changes.

**Verification:** trigger the workflow on the PR; deliberately breach one sample assertion and one unit test to prove both gates fail, then restore them; run `bun run audit:ui -- --help` and one baseline case against the built extension.

## PR-01 — FINDING-004: feedback stays in layout

**Outcome:** Stow/Restore success and error feedback occupies a named row and never covers Saved headings or counters.

**Files:** `newtab/styles.css`; `NewTabFeedback.tsx`/test only if a stable slot API is necessary; `App.test.tsx` for DOM order.

**Boundary:** use named `top / feedback / workspace` grid areas and assign workspace explicitly. Because `NewTabFeedback` returns `null`, the empty feedback row must collapse without CSS auto-placement moving workspace into it. Remove fixed positioning. Support a wrapped long error at 390px. Do not add Undo or timers.

**Verify:** focused Feedback/App tests; UI case `FINDING-004` covers no message, one-line success, long error, Stow, Restore, 1440/768/390, and asserts feedback/Saved rectangles do not intersect.

## PR-02 — FINDING-006: DOM, focus, and modal isolation

**Outcome:** focus follows top strip -> primary Quick Links -> Active -> Saved -> auxiliary controls, and only the top modal is interactive.

**Files:** `App.tsx`, `newtab/styles.css`, App tests, `ModalDialog.tsx`/tests, FormDialog tests, and Extra/Todo tests affected by the shared primitive.

**Boundary:** recompose the shell in final DOM order and use grid areas for desktop placement; split auxiliary controls from primary Quick Links. Portal every `ModalDialog` to `document.body`. Maintain a stack: `#root` is inert while non-empty, lower backdrops are inert, the top owns Escape/Tab, original inert state is restored only after the final close. Convert Extra to the same primitive while preserving drawer styling. Restore trigger focus only when the trigger remains connected; otherwise use a safe fallback. Handle React StrictMode effect replay. Do not use positive tabindex or add keyboard drag-and-drop.

**Verify:** complete Tab sequence at desktop/narrow; inline Quick Link modal, Extra -> nested Todo modal, busy dialog, nested close order, pre-existing root inert, removed trigger, and focus restoration tests. UI case `FINDING-006` records the full sequence and asserts background/root isolation.

## PR-03 — FINDING-001: responsive New Tab reflow

**Outcome:** no horizontal document scrolling at 768/390, and all content is scroll-reachable.

**Files:** `newtab/styles.css`, minimal App structure hook if required, App tests, `docs/adr/0027-support-responsive-new-tab-reflow.md`, and `docs/manual-qa.md`.

**Boundary:** supersede only the sub-1024 overflow clause in the V2 design. At `>=1024`, retain fixed shell and independent Active/Saved scroll. At `768-1023`, use a sticky, viewport-height Quick Links rail while the document owns the stacked Active/Saved main scroll. Below `768`, use one document flow in DOM order; rail, regions, and root reset `height/overflow` locks. Use `min-height:100dvh`; do not hide Settings, sync, or Stow. Long lists must expose their last focusable item; drag auto-scroll and dialogs must still work.

**Verify:** fixed matrix `1440@100%, 1024@100%, 768@100%, 390@100%, 1024@200%`; empty/populated/long; light/dark; English/Chinese. UI case asserts `scrollWidth === clientWidth`, dialog bounds, and last-item reachability.

## PR-04 — FINDING-003: shared identity and utility shell

**Outcome:** Settings and History share Tabstow identity and a reliable return route without changing their feature logic.

**Files:** add `src/styles/tabstow-tokens.css` and `src/components/UtilityPageShell.tsx`/test; import tokens before page CSS in all mains; update three stylesheets and Options/History components/tests.

**Boundary:** share only final V2 semantic color, font, border, focus, and status tokens with `--ts-*` names. Default-without-attribute is light; explicit dark overrides it; the token file contains no visibility or layout selectors. New Tab extraction must be computed-value equivalent. Page spacing/layout stays local. `UtilityPageShell` owns wordmark, page label, and 44px Back to workspace; it is not a generic feature framework. Settings IA waits for PR-08 and theme observation waits for PR-06.

**Verify:** shell tests plus three-page runtime at no attribute/light/dark and 1440/390. Compare New Tab computed token values before/after and require no unintended visual delta.

## PR-05 — FINDING-007: one lifecycle vocabulary

**Outcome:** visible copy consistently uses `Stow window`, `Saved windows`, and `History`; Chinese uses `收起窗口`, `已保存的窗口`, and `历史记录`.

**Files:** `i18n.ts`/tests, `StowedSessions.tsx`, `RecoveryBinDialog.tsx`, `HistoryApp.tsx`, related tests, and New Tab styles for a labelled History action.

**Boundary:** replace the trash-only Recovery entry with history icon + visible label; shorten persistent explanation and remove middle-click implementation detail. Keep internal components, `TabSession`, messages, DB, and sync vocabulary unchanged. Do not localize generated titles/dates here.

**Verify:** trace Stow -> Saved windows -> Restore/Remove -> History in both locales; user-facing assertions reject Recovery Bin, Saved session, and bare trash semantics.

## PR-06 — FINDING-009: one theme source

**Outcome:** `local:tabstow-theme-preferences` is the only current theme source; all pages apply and observe it without a wrong-theme frame.

**Files:** ADR-0028; core schemas/sync-document and tests; settings storage/tests; theme preference/bootstrap helper/tests; three main entrypoints; Options removes Theme select; App tests receiving initial errors or watch updates.

**Boundary:** remove theme from current `ExtensionSettings`, defaults, safe export, and local current writes. Keep a legacy-only sync field that accepts and strips any old JSON theme value; make `LegacyStoredSettings.theme?: unknown` explicit and erase it during the existing normalization write. Use WXT `storage.watch`, normalize callback data, return/unsubscribe exactly one listener per page, set `data-theme-mode` before render, and fall back visibly to light on read failure. New Tab state/label also observes external changes. Rollback to the old version may recreate its default core theme, but the authoritative fixed-mode key is retained, so the user's selection is not deleted.

**Verify:** current settings reject theme; valid/invalid legacy local and sync fields are stripped; new exports omit theme; initial read, fallback/error, watch update, normalization, unsubscribe, duplicate-listener prevention, cross-page live update, reload, and first-visible-frame checks.

## PR-07 — FINDING-002: actionable first use

**Outcome:** the true empty state explains the first successful action, and unavailable Stow is visually neutral and accessibly explained.

**Files:** ActiveWorkspace, StowedSessions, Stow button, New Tab styles, i18n, and related tests.

**Boundary:** show onboarding only after the authoritative unfiltered Active snapshot is ready and contains no ordinary visible tab; loading, error, pinned-only, and search-no-match are distinct states. Hide zero-only filters/counters and unavailable bulk controls; keep Tab lifecycle reachable. Saved empty copy connects Stow to restoration. `aria-describedby` uses the authoritative preview reason; React does not reimplement eligibility.

**Verify:** loading/error, true empty, query no-match, pinned-only, one eligible tab, preview failure, both themes/locales; disabled Stow is not the strongest visual anchor.

## PR-08 — FINDING-008: Settings around user decisions

**Outcome:** Settings explains optional sync, renders only state-relevant actions, and has a truthful save model.

**Files:** `OptionsApp.tsx`, tests, and Options CSS.

**Boundary:** lead with local-first optional GitHub sync and the data synchronized; hide disconnect/revoke guidance until relevant; separate immediate connection actions from saved preferences. Maintain persisted baseline and draft, derive the minimal editable-field patch, and rebase true local edits onto incoming sync data. Change->revert becomes clean; a remote value equal to draft removes that patch; success re-baselines; failure retains draft; duplicate save is blocked. Keep the pinned dependency semantic unchanged. Move Device ID to Advanced/Diagnostics with copy success/error. Theme is already gone. Do not change OAuth, Gist, messages, or persistence semantics.

**Verify:** all connection phases in component fixtures; initial clean, change/revert, pristine remote update, dirty remote update, patch eliminated by remote equality, save success/failure, duplicate submit, pinned dependency, copy success/failure. Real-extension smoke requires no credentials: disconnected plus any already-connected local profile if available.

## PR-09 — FINDING-010: actionable empty states

**Outcome:** Quick Links and History expose an existing next action without icon interpretation.

**Files:** QuickLinks/New Tab styles/App tests; History app/test/styles; i18n.

**Boundary:** empty Quick Links shows Add quick link and opens the existing add-by-URL form without edit mode. Populated state keeps compact edit behavior. Empty History explains what appears and retention/recovery; the shared shell's prominent Back action is the single CTA, not a duplicate second route. No onboarding persistence or new message/storage flow.

**Verify:** empty -> action -> populated for Quick Links; empty/populated History; both locales and 1440/390; form failure remains visibly recoverable.

## PR-10 — FINDING-011: localized Saved/History metadata

**Outcome:** generated titles, missing dates/reasons, and counts follow locale without changing stored data.

**Files:** add `features/tabs/session-presentation.ts`/test; extend i18n messages; update StowedSessions, RecoveryBinDialog, History source-title rendering, tests, and count styles.

**Boundary:** translate a title only when it exactly equals `${tabCount} tabs stowed`; mismatched numbers, malformed strings, and arbitrary titles pass through unchanged. Stowed and Recovery dates receive explicit locale; Recovery maps reason keys instead of printing raw values. Existing History date/reason formatting stays intact; only generated `sourceTitle` uses the adapter. Render counts as one non-wrapping localized summary. No IndexedDB/schema migration and no translated persistence.

**Verify:** 1/many, both locales, exact/mismatch/custom/malformed titles, Recovery reasons/times, History source titles, 1024/768/390 count layout.

## PR-11 — FINDING-012: explicit search and open-tab context

**Outcome:** users can distinguish Active, Saved, and Web actions and disambiguate identical open tabs by window/group.

**Files:** tab-search helper/tests, UnifiedSearch/tests, QuickLinks/App tests, i18n, and New Tab styles.

**Boundary:** show at most five local candidates plus one Web row; Web never consumes local quota and appears for every non-empty query. Preserve current global rank to select the five, then render labelled Active/Saved groups only for represented sources; one source may occupy all five. Use ordinary grouped buttons, not incomplete listbox semantics. Input Enter always searches Web; clicking a local/Web row performs that row. Build window/group/session maps once and use bounded rank buckets for O(n) scanning with O(limit) candidate memory. Quick Links uses `active-tabs:snapshot`, filters locally, caps 50 visible choices with a narrow-query hint, and makes row click select while footer Add submits. If filtering removes selection, select the first visible choice or disable Add at zero. No IDs in visible context, new message, or per-keystroke background request.

**Verify:** stable rank/limit under large fixtures, source starvation, five local + Web, active/saved/no-local, duplicate titles, unnamed groups, no URL, stale selection, chooser zero/cap/filter, `/`, Escape, Tab, Enter, pointer, and Add semantics.

## PR-12 — FINDING-005: final readability and target scale

**Outcome:** final controls and content meet the audit's readability, contrast, and interaction-target standard.

**Files:** shared tokens, all three page styles, only components needing accessible descriptions/full-row labels, and related tests.

**Boundary:** use approximately 14px body, 12px metadata, 18px section title, 28px page title; no functional text below 12px. Validate computed 4.5:1 contrast. Custom standalone buttons, links, icon controls, and selects target 44x44; checkbox labels provide a 44px clickable row even if the native box is smaller. Inline prose links follow the WCAG inline exception. Dense rows remain compact only through a 44px row/target or clearly separated non-overlapping targets. Preserve visible focus and accessible unavailable reasons. Do not change wording or IA.

**Verify:** full component suite plus UI case `FINDING-005` on all final controls at 1440/768/390, both themes, and 200% zoom. Runner checks computed contrast and effective clickable rectangles, not inner SVG/input dimensions.

## Test coverage and execution

```text
pure helper/schema change --> Vitest unit tests -------------------+
React interaction ---------> jsdom component/message tests --------+--> PR CI
CSS/layout/theme -----------> built MV3 + CDP assertions ----------+
real Chrome state flow -----> named manual setup + screenshots ----+--> PR evidence
```

Regression rule: a test must fail before each behavior fix and pass after it. CSS-only findings use a failing CDP assertion when jsdom cannot express the regression. Focused commands run first; then every PR runs:

```bash
bun run typecheck
bun run test
bun run build
```

For visual work, build and then run the PR-00 command with the finding case, for example:

```bash
bun run audit:ui -- --port 9333 --case FINDING-004 --output .artifacts/ui-audit/<commit>/FINDING-004
```

Each PR description contains finding/baseline links, before/after, scope/non-goals, focused/full commands, named fixture metadata, screenshots, assertion JSON, accessibility notes, and confirmation of permission/dependency/storage/message changes.

## Failure modes

| Code path | Production failure | Test / handling / user signal |
|---|---|---|
| Feedback grid | Null feedback auto-places workspace into the wrong row | DOM + CDP cases; named areas prevent it; visible assertion failure. |
| Modal stack | Nested close clears root inert too early | Nested/StrictMode tests; stack restores snapshot only at zero; escaped focus is visible in case output. |
| Responsive flow | Last Saved item is clipped by fixed-height ancestors | Long-fixture reachability assertion; no silent pass. |
| Shared tokens | utility page defaults dark or New Tab changes computed colors | three-state token/parity case; visual assertion names the token. |
| Theme load/watch | storage read fails or listeners duplicate | fallback/error/unsubscribe tests; light page mounts with visible status. |
| Settings rebase | sync event overwrites draft or keeps false dirty field | deterministic state tests; errors retain draft and status. |
| Empty action | existing add/history path fails | current status/form error behavior remains and is tested. |
| Session adapter | custom title resembles a generated title | exact count match only; tests preserve mismatch/custom value. |
| Search/chooser | filtered selection disappears or context lookup misses | helper/component tests select fallback or disable Add; no silent submit. |
| UI audit runner | wrong profile/case/build creates misleading evidence | preflight validates extension URL/build metadata and exits non-zero with diagnostics. |

After these revisions there are **0 critical gaps**: no listed new path is both silent and without a test or handling strategy.

## Implementation Tasks

Synthesized from the engineering review; checkbox as each owning PR ships.

- [ ] **T1 (P1, human: ~1d / CC: ~1h)** — delivery — add PR CI and failing repository-owned CDP cases.
  - Surfaced by: Test review findings 9-11.
  - Files: `.github/workflows/ci.yml`, `apps/extension/scripts/`, `package.json`, `docs/manual-qa.md`.
  - Verify: failing sample test/assertion blocks, then full green gate.
- [ ] **T2 (P1, human: ~1d / CC: ~1h)** — modal — portal dialogs and make inert ownership stack-safe.
  - Surfaced by: Architecture finding 1.
  - Files: `ModalDialog.tsx`, `App.tsx`, related dialog tests/styles.
  - Verify: focused nested-modal tests + `FINDING-006` case.
- [ ] **T3 (P1, human: ~1d / CC: ~1h)** — responsive — define root/rail/region scroll ownership.
  - Surfaced by: Architecture finding 3.
  - Files: New Tab styles, App tests, ADR-0027, manual QA.
  - Verify: fixed viewport/zoom long-list matrix.
- [ ] **T4 (P1, human: ~1d / CC: ~1h)** — theme — remove the stale core field and add pre-mount watch flow.
  - Surfaced by: Architecture findings 2 and 4.
  - Files: core schemas/sync, settings storage, theme helper, mains/tests.
  - Verify: legacy/current/rollback/watch/no-flash cases.
- [ ] **T5 (P1, human: ~6h / CC: ~45m)** — Settings — derive dirty state from baseline and draft.
  - Surfaced by: Code quality finding 5.
  - Files: `OptionsApp.tsx`, tests.
  - Verify: change/revert, sync rebase, success/failure matrix.
- [ ] **T6 (P1, human: ~1d / CC: ~1h)** — search — lock accessible grouping, context, selection, and bounded ranking.
  - Surfaced by: Code quality finding 8 and performance findings 13-14.
  - Files: tab-search, UnifiedSearch, QuickLinks, i18n, tests/styles.
  - Verify: large helper fixtures and keyboard/pointer chooser tests.
- [ ] **T7 (P2, human: ~4h / CC: ~30m)** — design system — keep shared tokens semantic and cascade-safe.
  - Surfaced by: Code quality finding 6.
  - Files: shared tokens, utility shell, three page styles/mains.
  - Verify: New Tab parity + three theme states.
- [ ] **T8 (P2, human: ~3h / CC: ~20m)** — localization — isolate generated-title presentation.
  - Surfaced by: Code quality finding 7.
  - Files: session presentation helper, i18n, Saved/Recovery/History views/tests.
  - Verify: exact/mismatch/custom and locale matrix.

## Plan operations

- Scope challenge: accepted as a multi-PR program because the user requires one PR per finding; reduction would violate that boundary. PR-00 is a separate verification prerequisite, not a thirteenth issue fix.
- Review counts: Architecture 4, Code Quality 4, Test 4, Performance 2; 14 issues absorbed.
- `TODOS.md`: absent; 0 deferred items proposed. Useful work is either required above or explicitly not valuable for this audit.
- Parallelization: 2 implementation lanes after a 4-PR foundation, then one final cross-surface PR.
- Outside voice: Codex CLI exited without a review response, so the independent fallback subagent ran. Its modal, dirty-state, QA, search, DAG, scroll, token, and localization findings agree with and are absorbed by this revision. Its preference to fold verification into FINDING-004 was not adopted because verification is not that finding; PR-00 keeps the user's one-finding/one-PR boundary auditable.
- Retrospective: prior review-driven New Tab/theme fixes (`22ddb3b`, `3d1e1f1`, `7ccf610`) show persisted theme, dialog, and migration edges have regressed before; those areas receive explicit migration, error, and runtime gates here.

## Final acceptance after PR-12

- Rerun every named UI case and the complete 2026-07-16 state matrix.
- Confirm all 12 findings link to their individual PRs and assertion artifacts.
- Confirm runtime/console errors are zero and full CI is green.
- Compare numeric runtime output against the pinned baseline and record intentional deltas; do not treat the qualitative `design-baseline.json` as numeric evidence.
- Run Stow -> Saved windows -> Restore/Remove -> History in light/dark, English/Chinese, and 1440/1024/768/390, including 200% zoom and long lists.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | NOT RUN | — |
| Codex Review | `/codex review` | Independent 2nd opinion | 1 | FALLBACK REVIEWED | Codex CLI returned no review; fallback raised 10 findings, all reconciled above |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAR | 14 issues absorbed, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | NOT RUN | The source design audit is linked above; no plan-stage design review log |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | NOT RUN | — |

**CROSS-MODEL:** The fallback outside voice agreed on every load-bearing risk; its PR-00 packaging preference was rejected to preserve finding isolation.

**VERDICT:** ENG CLEARED — ready to implement PR-00, then the two reviewed issue lanes.

NO UNRESOLVED DECISIONS
