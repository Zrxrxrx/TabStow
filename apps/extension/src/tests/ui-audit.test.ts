// @vitest-environment node

import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';
import { ensureEmptyOutputDirectory } from '../../scripts/ui-audit';
import {
  evaluateUiAuditCase,
  getUiAuditBrowserArgumentErrors,
  getUiAuditRuntimeIdentityErrors,
  hashUiAuditEntries,
  normalizeCdpRuntimeError,
  parseUiAuditArguments,
  selectUiAuditCase,
  validateUiAuditManifest,
} from '../../scripts/ui-audit-core';

const manifestInput = {
  schemaVersion: 1,
  baselineCommit: '5bc9f6a765a8464f5bfe74f59620ad4459e87369',
  cases: [{
    id: 'BASELINE',
    description: 'Built New Tab smoke gate',
    page: 'newtab.html',
    viewport: { width: 1440, height: 900 },
    zoom: 1,
    theme: 'light',
    locale: 'en',
    setup: ['Use a dedicated clean Chrome profile.'],
    cleanup: ['Close the generated audit target.'],
    screenshot: 'BASELINE.png',
    assertions: [{
      metric: 'horizontalOverflowPx',
      operator: 'atMost',
      value: 0,
    }],
  }],
};

describe('UI audit command', () => {
  it('parses a named case and deterministic output settings', () => {
    expect(parseUiAuditArguments([
      '--port',
      '9333',
      '--case',
      'BASELINE',
      '--output',
      '.artifacts/ui-audit/example',
      '--extension-id',
      'abcdefghijklmnopabcdefghijklmnop',
    ])).toEqual({
      port: 9333,
      caseId: 'BASELINE',
      outputDirectory: '.artifacts/ui-audit/example',
      extensionId: 'abcdefghijklmnopabcdefghijklmnop',
      help: false,
    });
  });

  it('rejects an audit run without a named case', () => {
    expect(() => parseUiAuditArguments(['--port', '9333'])).toThrow(
      'Missing required --case',
    );
  });

  it('rejects an invalid CDP port', () => {
    expect(() => parseUiAuditArguments([
      '--port',
      '80',
      '--case',
      'BASELINE',
    ])).toThrow('Invalid --port');
  });

  it('rejects unknown or valueless flags', () => {
    expect(() => parseUiAuditArguments([
      '--case',
      'BASELINE',
      '--unknown',
    ])).toThrow('Unknown option: --unknown');
    expect(() => parseUiAuditArguments(['--case'])).toThrow(
      'Missing value for --case',
    );
  });

  it('rejects an invalid expected extension ID', () => {
    expect(() => parseUiAuditArguments([
      '--case',
      'BASELINE',
      '--extension-id',
      'not-an-extension-id',
    ])).toThrow('Invalid --extension-id');
  });

  it('rejects an absolute evidence output path', () => {
    const windowsOutputPath = ['C:', 'Users', 'example', 'evidence'].join('\\');
    const windowsDriveRelativePath = ['D:', 'evidence'].join('');

    expect(() => parseUiAuditArguments([
      '--case',
      'BASELINE',
      '--output',
      resolve('evidence'),
    ])).toThrow('--output must be repository-relative');
    expect(() => parseUiAuditArguments([
      '--case',
      'BASELINE',
      '--output',
      windowsOutputPath,
    ])).toThrow('--output must be repository-relative');
    expect(() => parseUiAuditArguments([
      '--case',
      'BASELINE',
      '--output',
      windowsDriveRelativePath,
    ])).toThrow('--output must be repository-relative');
  });

  it('rejects an evidence output path that escapes the repository', () => {
    expect(() => parseUiAuditArguments([
      '--case',
      'BASELINE',
      '--output',
      '../evidence',
    ])).toThrow('--output must stay within the repository');
  });

  it('rejects an evidence output path that uses a symbolic link', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'tabstow-ui-audit-root-'));
    const outside = await mkdtemp(resolve(tmpdir(), 'tabstow-ui-audit-outside-'));
    const linkedOutput = resolve(root, 'evidence');
    try {
      await mkdir(resolve(outside, 'target'));
      await symlink(resolve(outside, 'target'), linkedOutput, 'dir');
      await expect(ensureEmptyOutputDirectory(linkedOutput, root)).rejects.toThrow(
        'Evidence directory must not use symbolic links: evidence',
      );
    } finally {
      await Promise.all([
        rm(root, { recursive: true, force: true }),
        rm(outside, { recursive: true, force: true }),
      ]);
    }
  });
});

describe('UI audit manifest', () => {
  it('accepts the versioned baseline case contract', () => {
    expect(validateUiAuditManifest(manifestInput)).toEqual(manifestInput);
  });

  it('keeps the checked-in case manifest valid', () => {
    const checkedInManifest = JSON.parse(readFileSync(
      new URL('../../scripts/ui-audit-cases.json', import.meta.url),
      'utf8',
    ));
    expect(validateUiAuditManifest(checkedInManifest).cases).toHaveLength(1);
  });

  it('rejects a case name that is absent from the manifest', () => {
    const manifest = validateUiAuditManifest(manifestInput);
    expect(() => selectUiAuditCase(manifest, 'MISSING')).toThrow(
      'Unknown UI audit case: MISSING',
    );
  });

  it('rejects range operators for string-valued metrics', () => {
    const invalidManifest = structuredClone(manifestInput);
    invalidManifest.cases[0]!.assertions[0] = {
      metric: 'themeMode',
      operator: 'atMost',
      value: 1,
    };
    expect(() => validateUiAuditManifest(invalidManifest)).toThrow(
      'string metrics require equals',
    );
  });
});

describe('UI audit assertions', () => {
  it('fails a selected case when an observed threshold is breached', () => {
    const auditCase = validateUiAuditManifest(manifestInput).cases[0]!;
    const result = evaluateUiAuditCase(auditCase, {
      rootChildCount: 1,
      horizontalOverflowPx: 12,
      themeMode: 'light',
      locale: 'en',
      pagePath: '/newtab.html',
      workspaceLandmarks: 'Quick links|Active tabs|Saved for later',
      viewportWidth: 1440,
      viewportHeight: 900,
      zoom: 1,
    }, []);

    expect(result.passed).toBe(false);
    expect(result.assertions).toEqual([expect.objectContaining({
      metric: 'horizontalOverflowPx',
      expected: 0,
      actual: 12,
      passed: false,
    })]);
  });

  it('treats captured runtime errors as a non-configurable failure', () => {
    const auditCase = validateUiAuditManifest(manifestInput).cases[0]!;
    const result = evaluateUiAuditCase(auditCase, {
      rootChildCount: 1,
      horizontalOverflowPx: 0,
      themeMode: 'light',
      locale: 'en',
      pagePath: '/newtab.html',
      workspaceLandmarks: 'Quick links|Active tabs|Saved for later',
      viewportWidth: 1440,
      viewportHeight: 900,
      zoom: 1,
    }, ['Unhandled exception']);

    expect(result.assertions.every((assertion) => assertion.passed)).toBe(true);
    expect(result.passed).toBe(false);
  });
});

describe('CDP runtime error gate', () => {
  it('normalizes exceptions and error-level console events only', () => {
    expect(normalizeCdpRuntimeError({
      method: 'Runtime.exceptionThrown',
      params: { exceptionDetails: { exception: { description: 'Error: broken' } } },
    })).toBe('Error: broken');
    expect(normalizeCdpRuntimeError({
      method: 'Runtime.consoleAPICalled',
      params: { type: 'error', args: [{ value: 'failed' }, { description: 'request' }] },
    })).toBe('failed request');
    expect(normalizeCdpRuntimeError({
      method: 'Runtime.consoleAPICalled',
      params: { type: 'log', args: [{ value: 'diagnostic' }] },
    })).toBeNull();
  });

  it('removes filesystem paths before errors reach reports or terminal output', () => {
    const posixSourcePath = resolve(tmpdir(), 'tabstow-ui-audit.example', 'bundle.js');
    const windowsSourcePath = ['C:', 'Users', 'example', 'project', 'bundle.js'].join('\\');

    expect(normalizeCdpRuntimeError({
      method: 'Runtime.exceptionThrown',
      params: {
        exceptionDetails: {
          exception: { description: `Error at ${posixSourcePath}:12:3` },
        },
      },
    })).toBe('Error at [path]:12:3');
    expect(normalizeCdpRuntimeError({
      method: 'Runtime.exceptionThrown',
      params: {
        exceptionDetails: {
          exception: { description: `Error at ${windowsSourcePath}:7:2` },
        },
      },
    })).toBe('Error at [path]:7:2');
  });
});

describe('UI audit build identity', () => {
  it('hashes normalized build entries independently of traversal order', () => {
    const first = hashUiAuditEntries([
      { path: 'manifest.json', contents: '{"name":"Tabstow"}' },
      { path: 'assets/newtab.js', contents: 'console.log("ready")' },
    ]);
    const reordered = hashUiAuditEntries([
      { path: 'assets\\newtab.js', contents: 'console.log("ready")' },
      { path: 'manifest.json', contents: '{"name":"Tabstow"}' },
    ]);
    const changed = hashUiAuditEntries([
      { path: 'manifest.json', contents: '{"name":"Changed"}' },
      { path: 'assets/newtab.js', contents: 'console.log("ready")' },
    ]);

    expect(reordered).toBe(first);
    expect(changed).not.toBe(first);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
  });

  it('accepts a utility page when the runtime resources match the local build', () => {
    expect(getUiAuditRuntimeIdentityErrors({
      extensionId: 'abcdefghijklmnopabcdefghijklmnop',
      runtimeId: 'abcdefghijklmnopabcdefghijklmnop',
      localManifest: {
        name: 'Tabstow',
        version: '2.1.0',
        chrome_url_overrides: { newtab: 'newtab.html' },
      },
      runtimeManifest: {
        name: 'Tabstow',
        version: '2.1.0',
        chrome_url_overrides: { newtab: 'newtab.html' },
      },
      localResourceHashes: { manifest: 'manifest-hash', page: 'options-hash' },
      runtimeResourceHashes: { manifest: 'manifest-hash', page: 'options-hash' },
    })).toEqual([]);
  });

  it('rejects a runtime page from a stale build', () => {
    expect(getUiAuditRuntimeIdentityErrors({
      extensionId: 'abcdefghijklmnopabcdefghijklmnop',
      runtimeId: 'abcdefghijklmnopabcdefghijklmnop',
      localManifest: {
        name: 'Tabstow',
        version: '2.1.0',
        chrome_url_overrides: { newtab: 'newtab.html' },
      },
      runtimeManifest: {
        name: 'Tabstow',
        version: '2.1.0',
        chrome_url_overrides: { newtab: 'newtab.html' },
      },
      localResourceHashes: { manifest: 'manifest-hash', page: 'current-page-hash' },
      runtimeResourceHashes: { manifest: 'manifest-hash', page: 'stale-page-hash' },
    })).toContain('Running page resource does not match the production build');
  });
});

describe('UI audit browser isolation', () => {
  it('requires a disposable profile and the exact production build flags', () => {
    const buildDirectory = resolve('fixtures/build/chrome-mv3');
    const temporaryDirectory = tmpdir();
    const profileDirectory = resolve(temporaryDirectory, 'tabstow-ui-audit.example');
    expect(getUiAuditBrowserArgumentErrors([
      'chrome',
      '--enable-automation',
      '--remote-debugging-address=127.0.0.1',
      `--user-data-dir=${profileDirectory}`,
      `--disable-extensions-except=${buildDirectory}`,
      `--load-extension=${buildDirectory}`,
    ], buildDirectory, {
      temporaryDirectory,
      profileMarkerExists: true,
    })).toEqual([]);
    expect(getUiAuditBrowserArgumentErrors([
      'chrome',
      '--enable-automation',
      '--remote-debugging-address=127.0.0.1',
    ], buildDirectory, {
      temporaryDirectory,
      profileMarkerExists: false,
    })).toEqual([
      'Chrome must use an explicit non-default --user-data-dir',
      'Chrome must disable extensions except the audited production build',
      'Chrome must load the audited production build',
    ]);
  });

  it('rejects a daily-use profile even when Chrome receives an explicit path', () => {
    const buildDirectory = resolve('fixtures/build/chrome-mv3');
    const temporaryDirectory = tmpdir();
    const dailyProfileDirectory = resolve(temporaryDirectory, '..', 'daily-profile');
    expect(getUiAuditBrowserArgumentErrors([
      'chrome',
      `--user-data-dir=${dailyProfileDirectory}`,
      `--disable-extensions-except=${buildDirectory}`,
      `--load-extension=${buildDirectory}`,
    ], buildDirectory, {
      temporaryDirectory,
      profileMarkerExists: false,
    })).toContain(
      'Chrome profile must be a marked tabstow-ui-audit directory under the system temp directory',
    );
  });
});
