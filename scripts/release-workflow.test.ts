import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import { parseDocument } from 'yaml';

interface WorkflowStep {
  name: string;
  uses?: string;
  with?: Record<string, boolean | number | string>;
  env?: Record<string, string>;
  if?: string;
  run?: string;
}

interface ReleaseWorkflow {
  name: string;
  on: {
    workflow_dispatch: {
      inputs: {
        bump: {
          required: boolean;
          default: string;
          type: string;
          options: string[];
        };
      };
    };
  };
  permissions: Record<string, string>;
  concurrency: {
    group: string;
    'cancel-in-progress': boolean;
  };
  jobs: {
    release: {
      'runs-on': string;
      env: Record<string, string>;
      steps: WorkflowStep[];
    };
  };
}

const workflowText = readFileSync(
  new URL('../.github/workflows/release.yml', import.meta.url),
  'utf8',
);
const workflowDocument = parseDocument(workflowText, {
  prettyErrors: true,
  strict: true,
  uniqueKeys: true,
});
const workflow = workflowDocument.toJS() as ReleaseWorkflow;
const releaseJob = workflow.jobs.release;
const steps = releaseJob.steps;
const packageJson = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as {
  scripts: Record<string, string>;
};
const readmeText = readFileSync(new URL('../README.md', import.meta.url), 'utf8');

function getStep(name: string): WorkflowStep {
  const matchingStep = steps.find((step) => step.name === name);
  expect(matchingStep, `Missing workflow step: ${name}`).toBeDefined();
  return matchingStep!;
}

function getRun(name: string): string {
  const run = getStep(name).run;
  expect(run, `Workflow step has no run block: ${name}`).toBeTypeOf('string');
  return run!;
}

function expectFailClosedTrackedStatus(run: string): void {
  expect(run).toMatch(
    /if ! TRACKED_STATUS="\$\(git status --porcelain --untracked-files=no\)"; then\s+echo [^\n]+ >&2\s+exit 1\s+fi\s+if \[\[ -n "\$TRACKED_STATUS" \]\]; then/,
  );
}

function expectInOrder(text: string, fragments: string[]): void {
  let previousIndex = -1;
  for (const fragment of fragments) {
    const index = text.indexOf(fragment, previousIndex + 1);
    expect(index, `Missing or out-of-order fragment: ${fragment}`).toBeGreaterThan(
      previousIndex,
    );
    previousIndex = index;
  }
}

describe('release workflow structure', () => {
  it('is valid YAML with the protected manual trigger', () => {
    expect(workflowDocument.errors).toEqual([]);
    expect(workflowDocument.warnings).toEqual([]);
    expect(workflow.name).toBe('Release');
    expect(workflow.on.workflow_dispatch.inputs.bump).toMatchObject({
      required: true,
      default: 'current',
      type: 'choice',
      options: ['current', 'patch', 'minor', 'major'],
    });
    expect(workflow.permissions).toEqual({ contents: 'write' });
    expect(workflow.concurrency).toEqual({
      group: 'release-${{ github.repository }}',
      'cancel-in-progress': false,
    });
    expect(releaseJob['runs-on']).toBe('ubuntu-latest');
  });

  it('has the complete release sequence in order', () => {
    expect(steps.map((step) => step.name)).toEqual([
      'Check out the default branch',
      'Set up Bun',
      'Install frozen dependencies',
      'Prepare the release version',
      'Typecheck, test, and build the Chrome ZIP',
      'Verify and prepare release assets',
      'Commit, tag, and push',
      'Create the GitHub Release',
    ]);

    const checkIndex = steps.indexOf(getStep('Typecheck, test, and build the Chrome ZIP'));
    const pushIndex = steps.indexOf(getStep('Commit, tag, and push'));
    const releaseIndex = steps.indexOf(getStep('Create the GitHub Release'));
    expect(checkIndex).toBeLessThan(pushIndex);
    expect(pushIndex).toBeLessThan(releaseIndex);
  });

  it('pins setup and does not persist the checkout credential', () => {
    expect(getStep('Check out the default branch')).toMatchObject({
      uses: 'actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5',
      with: {
        ref: '${{ github.event.repository.default_branch }}',
        'fetch-depth': 0,
        'persist-credentials': false,
      },
    });
    expect(getStep('Set up Bun')).toMatchObject({
      uses: 'oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6',
      with: {
        'bun-version': '1.3.6',
      },
    });
  });

  it('enables strict mode in every run block', () => {
    const runSteps = steps.filter((step) => step.run !== undefined);
    expect(runSteps.length).toBeGreaterThan(0);
    for (const step of runSteps) {
      expect(step.run!.trimStart(), step.name).toMatch(/^set -euo pipefail(?:\n|$)/);
    }
  });
});

describe('release workflow behavior', () => {
  it('keeps credentials out of preparation and checks', () => {
    expect(releaseJob.env).not.toHaveProperty('GH_TOKEN');
    expect(
      steps.filter((step) => step.env?.GH_TOKEN !== undefined).map((step) => step.name),
    ).toEqual(['Commit, tag, and push', 'Create the GitHub Release']);

    const pushRun = getRun('Commit, tag, and push');
    expect(pushRun).toContain(
      'AUTH_HEADER="$(printf \'x-access-token:%s\' "$GH_TOKEN" | base64 -w0)"',
    );
    expect(pushRun).toContain(
      'git -c http.https://github.com/.extraheader="AUTHORIZATION: basic $AUTH_HEADER" push',
    );
    expect(pushRun).not.toMatch(/credential\.helper|git remote set-url/);
  });

  it('prepares current and bump releases with frozen inputs', () => {
    const installRun = getRun('Install frozen dependencies');
    const prepareRun = getRun('Prepare the release version');
    const allRuns = steps.map((step) => step.run ?? '').join('\n');

    expect(installRun).toContain('bun install --frozen-lockfile');
    expect(allRuns.match(/bun install --frozen-lockfile/g)).toHaveLength(2);
    expect(prepareRun).toMatch(/case "\$BUMP" in\s+current\)/);
    expect(prepareRun).toMatch(/patch\|minor\|major\)/);
    expectFailClosedTrackedStatus(prepareRun);
    expect(prepareRun).toContain('bun pm version "$BUMP" --no-git-tag-version');
    expect(prepareRun).toContain('bun install --lockfile-only');
  });

  it('fails closed when probing tags and resumes only a same-HEAD current tag', () => {
    const prepareRun = getRun('Prepare the release version');

    expectInOrder(prepareRun, [
      'set +e',
      'TAG_PROBE_OUTPUT="$(git ls-remote --exit-code --tags origin "refs/tags/$TAG" "refs/tags/$TAG^{}" 2>&1)"',
      'TAG_PROBE_STATUS=$?',
      'set -e\ncase "$TAG_PROBE_STATUS" in',
      '0)',
      'if [[ "$BUMP" != "current" ]]; then',
      'TAG_COMMIT=',
      'HEAD_COMMIT="$(git rev-parse HEAD)"',
      'if [[ -z "$TAG_COMMIT" || "$TAG_COMMIT" != "$HEAD_COMMIT" ]]; then',
      'RESUME=true',
      '2)',
      'RESUME=false',
      '*)',
      'printf \'%s\\n\' "$TAG_PROBE_OUTPUT" >&2',
      'exit 1',
    ]);
    expect(prepareRun).toContain(
      'awk -v tag_ref="refs/tags/$TAG^{}" \'$2 == tag_ref { print $1 }\'',
    );
    expect(prepareRun).toContain('printf \'resume=%s\\n\' "$RESUME" >> "$GITHUB_OUTPUT"');
  });

  it('runs every check and verifier before mutation', () => {
    expect(getRun('Typecheck, test, and build the Chrome ZIP')).toBe(
      [
        'set -euo pipefail',
        'bun run typecheck',
        'bun run test',
        'bun run zip',
        '',
      ].join('\n'),
    );
    expect(getRun('Verify and prepare release assets')).toContain(
      'bun run release:verify -- "$TAG" apps/extension/.output/chrome-mv3/manifest.json',
    );
  });

  it('separates current tag pushes from atomic bump pushes', () => {
    const pushStep = getStep('Commit, tag, and push');
    const pushRun = getRun('Commit, tag, and push');

    expect(pushStep.if).toBe("${{ steps.release.outputs.resume != 'true' }}");
    expectFailClosedTrackedStatus(pushRun);
    expect(pushRun).toContain('git add -- apps/extension/package.json bun.lock');
    expect(pushRun).toContain('git commit -m "chore(release): bump version to $VERSION"');
    expect(pushRun).toContain('git tag -a "$TAG" -m "Release $TAG"');
    expect(pushRun).toMatch(
      /if \[\[ "\$BUMP" == "current" \]\]; then\s+git -c [^\n]+ push [^\n]+ "refs\/tags\/\$TAG"\s+else\s+git -c [^\n]+ push --atomic [^\n]+ "HEAD:refs\/heads\/\$DEFAULT_BRANCH" "refs\/tags\/\$TAG"/,
    );
  });

  it('creates or repairs exactly the versioned ZIP and checksum release assets', () => {
    const assetRun = getRun('Verify and prepare release assets');
    const releaseRun = getRun('Create the GitHub Release');
    expect(assetRun).toContain(
      'RELEASE_ZIP="apps/extension/.output/tabstow-v$VERSION-chrome.zip"',
    );
    expect(assetRun).toContain('CHECKSUMS="apps/extension/.output/SHA256SUMS"');
    expect(assetRun).toContain(
      'sha256sum "tabstow-v$VERSION-chrome.zip" > SHA256SUMS',
    );

    expectInOrder(releaseRun, [
      'set +e',
      'RELEASE_PROBE_OUTPUT="$(gh api --include "/repos/$GITHUB_REPOSITORY/releases/tags/$TAG" 2>&1)"',
      'RELEASE_PROBE_STATUS=$?',
      'set -e',
      'RELEASE_HTTP_STATUS=',
      'case "$RELEASE_PROBE_STATUS:$RELEASE_HTTP_STATUS" in',
      '0:200)',
      'RELEASE_EXISTS=true',
      '1:404)',
      'RELEASE_EXISTS=false',
      '*)',
      'printf \'%s\\n\' "$RELEASE_PROBE_OUTPUT" >&2',
      'exit 1',
      'if [[ "$RELEASE_EXISTS" == "false" ]]; then',
      'gh release create "$TAG"',
      'else',
      'ASSET_NAMES=',
      'MISSING_ASSETS=()',
      'gh release upload "$TAG" "${MISSING_ASSETS[@]}"',
    ]);
    expect(releaseRun).toMatch(
      /gh release create "\$TAG" \\\n\s+"\$RELEASE_ZIP" \\\n\s+"\$CHECKSUMS" \\\n\s+--verify-tag \\\n\s+--generate-notes/,
    );
    expect(releaseRun).toContain(
      'if ! ASSET_NAMES="$(gh release view "$TAG" --json assets --jq \'.assets[].name\')"; then',
    );
    expect(releaseRun).toContain('if ! grep -Fxq "$RELEASE_ZIP_NAME" <<< "$ASSET_NAMES"; then');
    expect(releaseRun).toContain('MISSING_ASSETS+=("$RELEASE_ZIP")');
    expect(releaseRun).toContain('if ! grep -Fxq "$CHECKSUMS_NAME" <<< "$ASSET_NAMES"; then');
    expect(releaseRun).toContain('MISSING_ASSETS+=("$CHECKSUMS")');
  });
});

describe('release test integration', () => {
  it('makes the canonical test command gate release contracts without recursion', () => {
    expect(packageJson.scripts.test).toMatch(/&& bun run test:release$/);
    expect(packageJson.scripts['test:release']).toBe(
      'bunx vitest@4.1.10 run scripts/verify-release.test.ts scripts/release-workflow.test.ts',
    );
  });
});

describe('release recovery documentation', () => {
  it('documents the safe current-version resume procedure', () => {
    expect(readmeText).toContain(
      'If a release run fails after pushing its tag, rerun the workflow with `current`.',
    );
    expect(readmeText).toContain(
      'Recovery proceeds only when the existing tag resolves to the current default-branch commit.',
    );
    expect(readmeText).toContain(
      'The rerun creates a missing Release or uploads only the missing `tabstow-vX.Y.Z-chrome.zip` and `SHA256SUMS` assets.',
    );
  });
});
