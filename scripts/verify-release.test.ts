import { describe, expect, it } from 'vitest';

import { extractWorkspaceVersion, validateReleaseVersions } from './verify-release';

const matchingVersions = {
  packageVersion: '1.0.0',
  lockVersion: '1.0.0',
  manifestVersion: '1.0.0',
  tag: 'v1.0.0',
};

describe('extractWorkspaceVersion', () => {
  it('extracts a workspace version from Bun\'s text lockfile', () => {
    const lockText = `{
  "lockfileVersion": 1,
  "workspaces": {
    "packages/core": {
      "name": "@tabstow/core",
      "version": "0.0.0",
    },
    "apps/extension": {
      "name": "@tabstow/extension",
      "version": "1.0.0",
      "dependencies": {
        "@tabstow/core": "workspace:*",
      },
    },
  },
}`;

    expect(extractWorkspaceVersion(lockText, 'apps/extension')).toBe('1.0.0');
  });

  it.each([
    [
      'is absent',
      `{
  "workspaces": {
    "packages/core": {
      "version": "0.0.0",
    },
  },
}`,
    ],
    [
      'has no version',
      `{
  "workspaces": {
    "apps/extension": {
      "name": "@tabstow/extension",
    },
  },
}`,
    ],
  ])('throws a precise error when the workspace %s', (_scenario, lockText) => {
    expect(() => extractWorkspaceVersion(lockText, 'apps/extension')).toThrowError(
      'Missing version for workspace "apps/extension" in bun.lock',
    );
  });
});

describe('validateReleaseVersions', () => {
  it('accepts a matching v1.0.0 release state', () => {
    expect(validateReleaseVersions(matchingVersions)).toBe('1.0.0');
  });

  it.each([
    ['package', 'packageVersion', '1.0.1'],
    ['lock', 'lockVersion', '1.0.1'],
    ['manifest', 'manifestVersion', '1.0.1'],
    ['tag', 'tag', 'v1.0.1'],
  ] as const)('rejects a %s version mismatch', (_source, key, value) => {
    const versions = { ...matchingVersions, [key]: value };

    expect(() => validateReleaseVersions(versions)).toThrowError(
      `Release version mismatch: package=${versions.packageVersion}, lock=${versions.lockVersion}, manifest=${versions.manifestVersion}, tag=${versions.tag}`,
    );
  });

  it.each([
    ['packageVersion', '1.0.x', 'Invalid package version "1.0.x": expected numeric x.y.z'],
    ['lockVersion', '1.0.x', 'Invalid lock version "1.0.x": expected numeric x.y.z'],
    ['manifestVersion', '1.0.x', 'Invalid manifest version "1.0.x": expected numeric x.y.z'],
    ['tag', 'v1.0.x', 'Invalid tag "v1.0.x": expected numeric vX.Y.Z'],
  ] as const)('rejects a non-numeric %s', (key, value, message) => {
    expect(() => validateReleaseVersions({ ...matchingVersions, [key]: value })).toThrowError(message);
  });
});
