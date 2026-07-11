# GitHub Release Versioning Design

## Goal

Package Tabstow as a Chrome Manifest V3 ZIP in GitHub Actions and publish durable GitHub Releases without manually editing version numbers. The first release is `v1.0.0`.

## Release model

`apps/extension/package.json.version` is the single version source. `bun.lock`, the generated Chrome manifest, the Git tag, and the GitHub Release must contain the same version.

The release workflow is manually dispatched with one of four choices:

- `current`: publish the version already in `apps/extension/package.json`; this is used for the first `v1.0.0` release and to recover after a tag has been pushed but publication did not finish.
- `patch`: increment `x.y.z` to `x.y.(z+1)`.
- `minor`: increment `x.y.z` to `x.(y+1).0`.
- `major`: increment `x.y.z` to `(x+1).0.0`.

The operator chooses only the release intent. Bun calculates and writes the concrete version.

An existing tag never authorizes a bump. `current` can resume only when the existing tag is annotated and resolves to the current default-branch HEAD; every other existing-tag state is rejected.

## Reproducible inputs

- Pin the repository to Bun `1.3.6`.
- Replace mutable `latest` dependency specifications with the exact versions already recorded in `bun.lock`.
- Install with `bun install --frozen-lockfile` before release preparation.
- When bumping, run `bun pm version <bump> --no-git-tag-version`, regenerate only `bun.lock`, and verify the frozen lockfile again.

## Workflow

The workflow always checks out the repository default branch and serializes releases with a concurrency group. It then:

1. Installs the frozen dependency graph.
2. Publishes the current version or prepares the requested bump.
3. Probes the remote tag and fails closed on operational errors. Bump inputs reject any existing tag; `current` rejects any tag that is not annotated at the current default-branch HEAD and marks only a same-HEAD annotated tag as a resume.
4. Runs typechecking and all tests.
5. Runs WXT's Chrome ZIP build.
6. Verifies package, lockfile, generated manifest, and tag versions.
7. Renames the asset to `tabstow-vX.Y.Z-chrome.zip` and creates `SHA256SUMS`.
8. For a bump, commits `apps/extension/package.json` and `bun.lock` as `chore(release): bump version to X.Y.Z`.
9. When not resuming, pushes the default branch update and annotated tag atomically for a bump; `current` pushes only the tag. A resume skips the commit, tag, and push step.
10. Probes the GitHub Release API and fails closed on operational errors, then creates a missing Release with generated notes and both assets or uploads only whichever expected assets are missing from an existing Release.

Any failure before the initial push leaves GitHub unchanged. A non-fast-forward branch update, a version mismatch, a failed check, a missing ZIP, or an operational tag or Release API error aborts the run.

If a run fails after pushing its tag, the documented recovery path is to rerun with `current`. A valid same-HEAD annotated tag resumes the run: checks and assets are rebuilt and verified, Git mutation is skipped, and the workflow creates a missing Release or uploads only the missing `tabstow-vX.Y.Z-chrome.zip` and `SHA256SUMS` assets. Existing tags for bump inputs, tags at any other commit, and non-annotated tags remain rejected.

## Components

- `scripts/verify-release.ts`: parses the Bun workspace version and validates all four release versions.
- `scripts/verify-release.test.ts`: tests matching and mismatching version states.
- `scripts/release-workflow.test.ts`: protects the required workflow gates, fail-closed probes, same-HEAD resume contract, and missing-asset repair commands.
- `.github/workflows/release.yml`: owns release mutation and GitHub Release creation or repair.
- `apps/extension/wxt.config.ts`: gives the ZIP a stable `tabstow` base name.
- `README.md`: documents first and future releases, same-HEAD `current` recovery, downloads, and unpacked installation.

## Scope boundaries

This does not publish to the Chrome Web Store, generate CRX files, add extension permissions, add content scripts, or provide automatic client updates. Downloaders continue to extract the ZIP into a stable local directory and reload the unpacked extension in Chrome.

## Verification

- Release-tool tests must demonstrate red-green behavior.
- Workflow-contract tests must cover bump and non-resumable existing-tag rejection, fail-closed tag and Release probes, skipped Git mutation on resume, and create-or-repair asset behavior.
- `bun install --frozen-lockfile`, `bun run typecheck`, `bun run test`, and `bun run zip` must pass locally.
- The generated manifest must report `1.0.0`.
- The generated ZIP must be named `tabstow-1.0.0-chrome.zip` before the workflow's release rename.
