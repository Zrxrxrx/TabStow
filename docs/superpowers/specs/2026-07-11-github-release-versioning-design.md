# GitHub Release Versioning Design

## Goal

Package Tabstow as a Chrome Manifest V3 ZIP in GitHub Actions and publish durable GitHub Releases without manually editing version numbers. The first release is `v1.0.0`.

## Release model

`apps/extension/package.json.version` is the single version source. `bun.lock`, the generated Chrome manifest, the Git tag, and the GitHub Release must contain the same version.

The release workflow is manually dispatched with one of four choices:

- `current`: publish the version already in `apps/extension/package.json`; this is used for the first `v1.0.0` release.
- `patch`: increment `x.y.z` to `x.y.(z+1)`.
- `minor`: increment `x.y.z` to `x.(y+1).0`.
- `major`: increment `x.y.z` to `(x+1).0.0`.

The operator chooses only the release intent. Bun calculates and writes the concrete version.

## Reproducible inputs

- Pin the repository to Bun `1.3.6`.
- Replace mutable `latest` dependency specifications with the exact versions already recorded in `bun.lock`.
- Install with `bun install --frozen-lockfile` before release preparation.
- When bumping, run `bun pm version <bump> --no-git-tag-version`, regenerate only `bun.lock`, and verify the frozen lockfile again.

## Workflow

The workflow always checks out the repository default branch and serializes releases with a concurrency group. It then:

1. Installs the frozen dependency graph.
2. Publishes the current version or prepares the requested bump.
3. Rejects an existing version tag.
4. Runs typechecking and all tests.
5. Runs WXT's Chrome ZIP build.
6. Verifies package, lockfile, generated manifest, and tag versions.
7. Renames the asset to `tabstow-vX.Y.Z-chrome.zip` and creates `SHA256SUMS`.
8. For a bump, commits `apps/extension/package.json` and `bun.lock` as `chore(release): bump version to X.Y.Z`.
9. Pushes the default branch update and annotated tag atomically when a bump is required; `current` pushes only the tag.
10. Creates the GitHub Release with generated notes and uploads both assets.

Any failure before the push leaves GitHub unchanged. A non-fast-forward branch update, an existing tag, a version mismatch, a failed check, or a missing ZIP aborts the release.

## Components

- `scripts/verify-release.ts`: parses the Bun workspace version and validates all four release versions.
- `scripts/verify-release.test.ts`: tests matching and mismatching version states.
- `scripts/release-workflow.test.ts`: protects the required workflow gates and commands.
- `.github/workflows/release.yml`: owns release mutation and GitHub Release creation.
- `apps/extension/wxt.config.ts`: gives the ZIP a stable `tabstow` base name.
- `README.md`: documents the first release and future release procedure.

## Scope boundaries

This does not publish to the Chrome Web Store, generate CRX files, add extension permissions, add content scripts, or provide automatic client updates. Downloaders continue to extract the ZIP into a stable local directory and reload the unpacked extension in Chrome.

## Verification

- Release-tool tests must demonstrate red-green behavior.
- `bun install --frozen-lockfile`, `bun run typecheck`, `bun run test`, and `bun run zip` must pass locally.
- The generated manifest must report `1.0.0`.
- The generated ZIP must be named `tabstow-1.0.0-chrome.zip` before the workflow's release rename.

