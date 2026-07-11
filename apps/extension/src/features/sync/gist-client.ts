type Fetcher = typeof fetch;

type GistFileResponse = {
  content?: string;
  raw_url?: string;
  truncated?: boolean;
};

type GistResponse = {
  files?: Record<string, GistFileResponse>;
};

const GITHUB_API_VERSION = '2022-11-28';

export class GistFileNotFoundError extends Error {}

function isTrustedRawGistUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'gist.githubusercontent.com';
  } catch {
    return false;
  }
}

export class GistClient {
  constructor(
    private readonly token: string,
    private readonly fetcher: Fetcher = globalThis.fetch.bind(globalThis),
  ) {}

  private headers(): HeadersInit {
    return {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${this.token}`,
      'X-GitHub-Api-Version': GITHUB_API_VERSION,
    };
  }

  async getFileContent(gistId: string, fileName: string): Promise<string> {
    const response = await this.fetcher(`https://api.github.com/gists/${gistId}`, {
      method: 'GET',
      headers: this.headers(),
    });

    if (!response.ok) {
      throw new Error(`GitHub returned ${response.status} while reading the Gist.`);
    }

    const gist = (await response.json()) as GistResponse;
    const file = gist.files?.[fileName];

    if (!file) {
      throw new GistFileNotFoundError('Gist file was not found.');
    }

    if (!file.truncated && typeof file.content === 'string') {
      return file.content;
    }

    if (!file.raw_url) {
      throw new Error('Gist file content was unavailable.');
    }
    if (!isTrustedRawGistUrl(file.raw_url)) {
      throw new Error('Gist file raw URL was invalid.');
    }

    const rawResponse = await this.fetcher(file.raw_url, {
      method: 'GET',
    });

    if (!rawResponse.ok) {
      throw new Error(`GitHub returned ${rawResponse.status} while reading raw Gist content.`);
    }

    return rawResponse.text();
  }

  async updateFile(gistId: string, fileName: string, content: string): Promise<void> {
    const response = await this.fetcher(`https://api.github.com/gists/${gistId}`, {
      method: 'PATCH',
      headers: {
        ...this.headers(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        files: {
          [fileName]: {
            content,
          },
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`GitHub returned ${response.status} while updating the Gist.`);
    }
  }
}
