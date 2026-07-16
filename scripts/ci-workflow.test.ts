import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import { parseDocument } from 'yaml';

interface WorkflowStep {
  name: string;
  uses?: string;
  with?: Record<string, boolean | number | string>;
  run?: string;
}

interface PullRequestWorkflow {
  name: string;
  on: { pull_request: null };
  permissions: Record<string, string>;
  concurrency: {
    group: string;
    'cancel-in-progress': boolean;
  };
  jobs: {
    checks: {
      name: string;
      'runs-on': string;
      'timeout-minutes': number;
      steps: WorkflowStep[];
    };
  };
}

const workflowText = readFileSync(
  new URL('../.github/workflows/ci.yml', import.meta.url),
  'utf8',
);
const workflowDocument = parseDocument(workflowText, {
  prettyErrors: true,
  strict: true,
  uniqueKeys: true,
});
const workflow = workflowDocument.toJS() as PullRequestWorkflow;
const steps = workflow.jobs.checks.steps;

function getStep(name: string): WorkflowStep {
  const step = steps.find((candidate) => candidate.name === name);
  expect(step, `Missing workflow step: ${name}`).toBeDefined();
  return step!;
}

describe('pull request CI workflow', () => {
  it('uses a read-only pull request trigger and cancels superseded runs', () => {
    expect(workflowDocument.errors).toEqual([]);
    expect(workflowDocument.warnings).toEqual([]);
    expect(workflow.name).toBe('CI');
    expect(workflow.on).toEqual({ pull_request: null });
    expect(workflow.permissions).toEqual({ contents: 'read' });
    expect(workflow.concurrency).toEqual({
      group: 'ci-${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}',
      'cancel-in-progress': true,
    });
    expect(workflow.jobs.checks).toMatchObject({
      name: 'Typecheck, test, and build',
      'runs-on': 'ubuntu-latest',
      'timeout-minutes': 20,
    });
  });

  it('pins setup and runs the complete Bun gate in order', () => {
    expect(steps.map((step) => step.name)).toEqual([
      'Check out the pull request',
      'Set up Bun',
      'Install frozen dependencies',
      'Typecheck',
      'Test',
      'Build',
    ]);
    expect(getStep('Check out the pull request')).toMatchObject({
      uses: 'actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5',
      with: { 'persist-credentials': false },
    });
    expect(getStep('Set up Bun')).toMatchObject({
      uses: 'oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6',
      with: { 'bun-version': '1.3.6' },
    });
    expect(getStep('Install frozen dependencies').run).toContain(
      'bun install --frozen-lockfile',
    );
    expect(getStep('Typecheck').run).toContain('bun run typecheck');
    expect(getStep('Test').run).toContain('bun run test');
    expect(getStep('Build').run).toContain('bun run build');
  });

  it('fails closed without secrets or browser-only evidence steps', () => {
    for (const step of steps.filter((candidate) => candidate.run !== undefined)) {
      expect(step.run!.trimStart(), step.name).toMatch(/^set -euo pipefail(?:\n|$)/);
    }
    expect(workflowText).not.toContain('secrets.');
    expect(workflowText).not.toContain('audit:ui');
    expect(workflowText).not.toContain('WXT_GITHUB_OAUTH_CLIENT_ID');
  });
});
