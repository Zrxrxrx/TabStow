import { describe, expect, it, vi } from 'vitest';
import { GistClient } from './gist-client';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
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
      jsonResponse({
        files: {
          'tabstow.sync.json': {
            content: '{"schemaVersion":1}',
            truncated: false,
          },
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
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({ files: {} }));
    const client = new GistClient('token-1', fetcher);

    await expect(client.getFileContent('gist-1', 'tabstow.sync.json')).rejects.toThrow(
      'Gist file was not found.',
    );
  });

  it('fetches truncated raw content without forwarding the authorization header', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          files: {
            'tabstow.sync.json': {
              truncated: true,
              raw_url: 'https://gist.githubusercontent.com/user/gist/raw/file',
            },
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
      {
        method: 'GET',
      },
    );
  });
});
