import { describe, expect, it, vi } from 'vitest';
import type { GistClient, GistInfo } from './gist-client';
import { discoverGistCandidates, inspectGistTarget } from './gist-discovery';

function gist(overrides: Partial<GistInfo> = {}): GistInfo {
  return {
    id: 'gist-1',
    description: 'Tabstow',
    public: false,
    htmlUrl: 'https://gist.github.com/octocat/gist-1',
    owner: { id: 1, login: 'octocat' },
    files: { 'tabstow.sync.json': { content: '{}' } },
    ...overrides,
  };
}

const validV1 = JSON.stringify({
  schemaVersion: 1,
  deviceId: 'legacy',
  exportedAt: '2026-07-12T00:00:00.000Z',
  sessions: [],
  quickLinks: [],
  settings: {
    deviceId: 'legacy',
    includePinnedTabs: false,
    closePinnedTabs: false,
  },
});

describe('Gist discovery', () => {
  it('keeps only valid owned canonical candidates', async () => {
    const valid = gist();
    const invalid = gist({ id: 'invalid' });
    const foreign = gist({ id: 'foreign', owner: { id: 2, login: 'other' } });
    const custom = gist({
      id: 'custom',
      files: { 'custom.json': { content: validV1 } },
    });
    const client = {
      listGists: vi.fn().mockResolvedValue([valid, invalid, foreign, custom]),
      getFileContentFromGist: vi
        .fn()
        .mockImplementation(async (candidate: GistInfo) =>
          candidate.id === 'invalid' ? '{' : validV1,
        ),
    } as unknown as GistClient;

    await expect(
      discoverGistCandidates(client, { id: 1, login: 'octocat' }, 'replica-local'),
    ).resolves.toEqual([
      expect.objectContaining({ gistId: 'gist-1', schemaVersion: 1 }),
    ]);
  });

  it('does not auto-narrow candidates when reading one fails in transit', async () => {
    const first = gist({ id: 'gist-1' });
    const second = gist({ id: 'gist-2' });
    const client = {
      listGists: vi.fn().mockResolvedValue([first, second]),
      getFileContentFromGist: vi
        .fn()
        .mockResolvedValueOnce(validV1)
        .mockRejectedValueOnce(new TypeError('network unavailable')),
    } as unknown as GistClient;

    await expect(
      discoverGistCandidates(client, { id: 1, login: 'octocat' }, 'replica-local'),
    ).rejects.toThrow('network unavailable');
  });

  it('classifies an explicitly selected missing or empty file without creating it', async () => {
    const missingClient = {
      getGist: vi.fn().mockResolvedValue(gist({ files: {} })),
    } as unknown as GistClient;
    await expect(
      inspectGistTarget(
        missingClient,
        { id: 1, login: 'octocat' },
        'gist-1',
        'custom.json',
        'replica-local',
      ),
    ).resolves.toMatchObject({ fileState: 'missing' });

    const emptyGist = gist({ files: { 'custom.json': { content: '{}' } } });
    const emptyClient = {
      getGist: vi.fn().mockResolvedValue(emptyGist),
      getFileContentFromGist: vi.fn().mockResolvedValue('{}'),
    } as unknown as GistClient;
    await expect(
      inspectGistTarget(
        emptyClient,
        { id: 1, login: 'octocat' },
        'gist-1',
        'custom.json',
        'replica-local',
      ),
    ).resolves.toMatchObject({ fileState: 'empty' });
  });

  it('rejects foreign ownership and invalid non-empty content', async () => {
    const foreignClient = {
      getGist: vi.fn().mockResolvedValue(gist({ owner: { id: 2, login: 'other' } })),
    } as unknown as GistClient;
    await expect(
      inspectGistTarget(
        foreignClient,
        { id: 1, login: 'octocat' },
        'gist-1',
        'tabstow.sync.json',
        'replica-local',
      ),
    ).rejects.toThrow('owned');

    const invalidGist = gist();
    const invalidClient = {
      getGist: vi.fn().mockResolvedValue(invalidGist),
      getFileContentFromGist: vi.fn().mockResolvedValue('{'),
    } as unknown as GistClient;
    await expect(
      inspectGistTarget(
        invalidClient,
        { id: 1, login: 'octocat' },
        'gist-1',
        'tabstow.sync.json',
        'replica-local',
      ),
    ).rejects.toThrow('invalid');
  });
});
