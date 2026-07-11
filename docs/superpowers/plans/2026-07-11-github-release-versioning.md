# GitHub Release Versioning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish reproducible Tabstow Chrome ZIP releases through a manually dispatched GitHub Action, beginning with `v1.0.0`.

**Architecture:** Keep the extension package version as the source of truth. A small tested verifier guards package/lock/manifest/tag consistency, while one workflow owns bumping, validation, Git mutation, packaging, checksums, GitHub Release creation, and safe post-tag recovery of the coupled ZIP/checksum asset pair.

**Tech Stack:** Bun 1.3.6, TypeScript, Vitest, WXT 0.20.27, GitHub Actions, GitHub CLI

## Global Constraints

- Use Bun for all dependency and script commands.
- The first release is exactly `v1.0.0`.
- Chrome extension runtime code must not gain Bun-only or Node-only APIs; release tooling may use Node APIs.
- Release assets are the coupled pair `tabstow-vX.Y.Z-chrome.zip` and `SHA256SUMS`.
- No Chrome Web Store publishing, CRX generation, new extension permissions, or credentials.

---

### Task 1: Tested release-version verifier

**Files:**
- Create: `scripts/verify-release.test.ts`
- Create: `scripts/verify-release.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: Bun's text `bun.lock`, `apps/extension/package.json`, and WXT's generated manifest.
- Produces: `extractWorkspaceVersion(lockText, workspace)`, `validateReleaseVersions(versions)`, and CLI `bun scripts/verify-release.ts <tag> <manifest-path>`.

- [ ] **Step 1: Write failing tests** for extraction, a matching `v1.0.0` state, every mismatch, and non-numeric versions.
- [ ] **Step 2: Run `bunx vitest@4.1.10 run scripts/verify-release.test.ts` and confirm failure because the implementation does not exist.**
- [ ] **Step 3: Implement the minimal verifier.** It must throw a precise error for a missing workspace version or a package/lock/manifest/tag mismatch and print the verified version from the CLI.
- [ ] **Step 4: Add `test:release` and `release:verify` scripts, then rerun the focused test to green.**

### Task 2: Reproducible `v1.0.0` package inputs

**Files:**
- Modify: `package.json`
- Modify: `apps/extension/package.json`
- Modify: `packages/core/package.json`
- Modify: `bun.lock`
- Modify: `apps/extension/wxt.config.ts`

**Interfaces:**
- Consumes: versions already resolved in `bun.lock`.
- Produces: a frozen dependency graph, extension version `1.0.0`, and WXT ZIP base name `tabstow`.

- [ ] **Step 1: Pin Bun to `1.3.6`, replace every `latest` with its existing exact lockfile version, and set the extension version to `1.0.0`.**
- [ ] **Step 2: Set `zip.name` to `tabstow`.**
- [ ] **Step 3: Run `bun install --lockfile-only`, inspect the lockfile diff, then run `bun install --frozen-lockfile`.**
- [ ] **Step 4: Run the verifier tests and existing manifest test.**

### Task 3: Protected manual release workflow

**Files:**
- Create: `scripts/release-workflow.test.ts`
- Create: `.github/workflows/release.yml`
- Modify: `package.json`

**Interfaces:**
- Consumes: workflow input `current|patch|minor|major`, the verifier CLI, root test/typecheck/zip scripts, GitHub's default branch, and existing tag/Release state.
- Produces: an annotated `vX.Y.Z` tag and a GitHub Release containing a valid coupled ZIP/checksum pair; a same-HEAD `current` resume performs no Git mutation.

- [ ] **Step 1: Write a failing workflow-contract test.** Assert choice inputs, `contents: write`, frozen installs, Bun version preparation, checks, verifier execution, atomic push for bumps, fail-closed tag and Release probes, existing-tag rejection for bumps, non-annotated tags, and tags at any commit other than the current default-branch HEAD, same-HEAD annotated `current` resumption, skipped Git mutation on resume, `--verify-tag`, creation of a missing Release with a fresh asset pair, complete-pair download and checksum verification with delete-both-and-rerun failure guidance, ZIP-only checksum derivation from the published ZIP with only the checksum uploaded, checksum-only orphan deletion followed by fresh-pair upload, and fresh-pair upload when both assets are absent.
- [ ] **Step 2: Run the focused test and confirm it fails because `.github/workflows/release.yml` is missing.**
- [ ] **Step 3: Implement the workflow with `set -euo pipefail`, a release concurrency group, pinned setup actions, fail-closed tag/API inspection, existing-tag rejection for bump inputs, same-HEAD annotated `current` resumption that skips Git mutation, generated release notes, and coupled-pair recovery: download and verify a complete pair and fail mismatches with delete-both-and-rerun guidance; derive and upload only a checksum from a lone published ZIP; delete an orphan checksum before uploading a fresh pair; and upload a fresh pair when neither asset exists.**
- [ ] **Step 4: Run the focused workflow-contract test, including the recovery assertions, to green.**

### Task 4: Operator documentation and end-to-end verification

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: the implemented GitHub workflow.
- Produces: exact first-release, subsequent-release, post-tag recovery, download, and unpacked-extension instructions.

- [ ] **Step 1: Document that the first Actions run selects `current` to publish `v1.0.0`; later runs select the desired bump. Document `current` as the recovery path after a post-push failure: only a same-HEAD annotated tag resumes, checks rerun, Git mutation is skipped, and the ZIP/checksum pair is recovered by downloading and verifying a complete pair, failing mismatches with delete-both-and-rerun guidance, deriving and uploading only a checksum from a lone published ZIP, deleting an orphan checksum before uploading a fresh pair, or uploading a fresh pair when both assets are absent.**
- [ ] **Step 2: Run `bun run typecheck`, `bun run test`, and `bun run zip`.**
- [ ] **Step 3: Run `bun run release:verify -- v1.0.0 apps/extension/.output/chrome-mv3/manifest.json`.**
- [ ] **Step 4: Confirm the generated ZIP is `apps/extension/.output/tabstow-1.0.0-chrome.zip`.**
- [ ] **Step 5: Review the full diff, run a code review, and commit with the repository's `type(scope): msg` convention.**
