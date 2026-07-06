import { describe, expect, it, vi } from 'vitest';
import { GistClient } from './gist-client';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('GistClient', () => {
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
});
