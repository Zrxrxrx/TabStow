import { describe, expect, it, vi } from 'vitest';
import { GistClient, GitHubApiError } from './gist-client';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function gistResponse(files: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
  return jsonResponse({
    id: 'gist-1',
    description: 'Tabstow',
    public: false,
    html_url: 'https://gist.github.com/octocat/gist-1',
    owner: { id: 1, login: 'octocat' },
    files,
    ...overrides,
  });
}

describe('GistClient', () => {
  it('calls the default fetch with the worker global receiver', async () => {
    const fetcher = vi.fn(function (this: typeof globalThis) {
      if (this !== globalThis) {
        throw new TypeError(
          "Failed to execute 'fetch' on 'WorkerGlobalScope': Illegal invocation",
        );
      }
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal('fetch', fetcher);

    try {
      const client = new GistClient('token-1');
      await expect(
        client.updateFile('gist-1', 'tabstow.sync.json', '{"schemaVersion":1}'),
      ).resolves.toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('reads a configured gist file by name', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      gistResponse({
          'tabstow.sync.json': {
            content: '{"schemaVersion":1}',
            truncated: false,
          },
      }),
    );

    const client = new GistClient('token-1', fetcher);
    await expect(client.getFileContent('gist-1', 'tabstow.sync.json')).resolves.toBe(
      '{"schemaVersion":1}',
    );
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.github.com/gists/gist-1',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('updates a configured gist file by name', async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({}));
    const client = new GistClient('token-1', fetcher);

    await client.updateFile('gist-1', 'tabstow.sync.json', '{"schemaVersion":1}');

    expect(fetcher).toHaveBeenCalledWith(
      'https://api.github.com/gists/gist-1',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({
          files: {
            'tabstow.sync.json': {
              content: '{"schemaVersion":1}',
            },
          },
        }),
      }),
    );
  });

  it('throws when a configured file is missing', async () => {
    const fetcher = vi.fn().mockResolvedValue(gistResponse({}));
    const client = new GistClient('token-1', fetcher);

    await expect(client.getFileContent('gist-1', 'tabstow.sync.json')).rejects.toThrow(
      'Gist file was not found.',
    );
  });

  it('fetches truncated raw content without forwarding the authorization header', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        gistResponse({
            'tabstow.sync.json': {
              truncated: true,
              raw_url: 'https://gist.githubusercontent.com/user/gist/raw/file',
            },
        }),
      )
      .mockResolvedValueOnce(
        new Response('{"schemaVersion":1}', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );

    const client = new GistClient('token-1', fetcher);
    await expect(client.getFileContent('gist-1', 'tabstow.sync.json')).resolves.toBe(
      '{"schemaVersion":1}',
    );

    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      'https://gist.githubusercontent.com/user/gist/raw/file',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetcher.mock.calls[1]?.[1]?.headers).toBeUndefined();
  });

  it('lists authenticated Gists across pagination', async () => {
    const first = gistResponse(
      { 'tabstow.sync.json': { content: '{}' } },
      { id: 'gist-1' },
    );
    first.headers.set('link', '<https://api.github.com/gists?page=2>; rel="next"');
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify([await first.json()]), {
          status: 200,
          headers: { link: first.headers.get('link')! },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            await gistResponse({}, { id: 'gist-2' }).json(),
          ]),
          { status: 200 },
        ),
      );

    const client = new GistClient('token-1', fetcher);
    await expect(client.listGists()).resolves.toEqual([
      expect.objectContaining({ id: 'gist-1' }),
      expect.objectContaining({ id: 'gist-2' }),
    ]);
  });

  it('rejects oversized raw sync files before reading their body', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        gistResponse({
          'tabstow.sync.json': {
            truncated: true,
            raw_url: 'https://gist.githubusercontent.com/user/gist/raw/file',
          },
        }),
      )
      .mockResolvedValueOnce(
        new Response('not-read', {
          status: 200,
          headers: { 'content-length': String(5 * 1024 * 1024 + 1) },
        }),
      );

    await expect(
      new GistClient('token-1', fetcher).getFileContent('gist-1', 'tabstow.sync.json'),
    ).rejects.toThrow('5 MiB');
  });

  it('returns structured rate-limit errors', async () => {
    const response = jsonResponse({}, 403);
    response.headers.set('retry-after', '60');
    const client = new GistClient('token-1', vi.fn().mockResolvedValue(response));

    await expect(client.getGist('gist-1')).rejects.toMatchObject({
      status: 403,
      retryAfterMs: 60_000,
    } satisfies Partial<GitHubApiError>);
  });
});
