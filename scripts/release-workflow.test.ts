import { existsSync, readFileSync } from 'node:fs';

import { expect, it } from 'vitest';

const workflowUrl = new URL('../.github/workflows/release.yml', import.meta.url);

it('defines the protected manual release contract', () => {
  expect(existsSync(workflowUrl), '.github/workflows/release.yml must exist').toBe(true);

  const workflow = readFileSync(workflowUrl, 'utf8');

  expect(workflow).toMatch(/workflow_dispatch:/);
  expect(workflow).toMatch(/bump:\s*\n(?:\s+.*\n)*?\s+type: choice/);
  expect(workflow).toMatch(/options:\s*\n\s+- current\s*\n\s+- patch\s*\n\s+- minor\s*\n\s+- major/);
  expect(workflow).toMatch(/permissions:\s*\n\s+contents: write/);
  expect(workflow).toMatch(/concurrency:\s*\n\s+group: release-/);

  expect(workflow).toContain('actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5');
  expect(workflow).toContain("ref: ${{ github.event.repository.default_branch }}");
  expect(workflow).toContain('oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6');
  expect(workflow).toMatch(/bun-version: ['"]?1\.3\.6/);
  expect(workflow.match(/bun install --frozen-lockfile/g)).toHaveLength(2);

  expect(workflow).toContain('set -euo pipefail');
  expect(workflow).toContain('bun pm version "$BUMP" --no-git-tag-version');
  expect(workflow).toContain('bun install --lockfile-only');
  expect(workflow).toContain('git status --porcelain --untracked-files=no');
  expect(workflow).toContain('git ls-remote --exit-code --tags origin "refs/tags/$TAG"');

  expect(workflow).toContain('bun run typecheck');
  expect(workflow).toContain('bun run test');
  expect(workflow).toContain('bun run zip');
  expect(workflow).toContain(
    'bun run release:verify -- "$TAG" apps/extension/.output/chrome-mv3/manifest.json',
  );

  expect(workflow).toContain('apps/extension/.output/tabstow-v$VERSION-chrome.zip');
  expect(workflow).toContain('apps/extension/.output/SHA256SUMS');
  expect(workflow).toContain('git add -- apps/extension/package.json bun.lock');
  expect(workflow).toContain('chore(release): bump version to $VERSION');
  expect(workflow).toContain('git tag -a "$TAG"');
  expect(workflow).toMatch(
    /git push --atomic origin [^\n]+refs\/heads\/\$DEFAULT_BRANCH[^\n]+refs\/tags\/\$TAG/,
  );
  expect(workflow).toMatch(/git push origin "refs\/tags\/\$TAG"/);

  expect(workflow).toContain('gh release create "$TAG"');
  expect(workflow).toContain('--verify-tag');
  expect(workflow).toContain('--generate-notes');
  expect(workflow).toContain('"apps/extension/.output/tabstow-v$VERSION-chrome.zip"');
  expect(workflow).toContain('apps/extension/.output/SHA256SUMS');
});
