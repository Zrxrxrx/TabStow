import { MAX_SYNC_DOCUMENT_BYTES } from '@tabstow/core';

type Fetcher = typeof fetch;

type GistFileResponse = {
  content?: string;
  raw_url?: string;
  truncated?: boolean;
};

type GistResponse = {
  id?: string;
  description?: string | null;
  public?: boolean;
  html_url?: string;
  owner?: { id?: number; login?: string } | null;
  files?: Record<string, GistFileResponse>;
};

export type GitHubUser = {
  id: number;
  login: string;
};

export type GistInfo = {
  id: string;
  description: string;
  public: boolean;
  htmlUrl: string;
  owner: GitHubUser;
  files: Record<string, GistFileResponse>;
};

const GITHUB_API_VERSION = '2022-11-28';
const REQUEST_TIMEOUT_MS = 25_000;

export class GistFileNotFoundError extends Error {}

export class GitHubApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfterMs?: number,
    readonly rateLimitResetAt?: number,
  ) {
    super(message);
    this.name = 'GitHubApiError';
  }
}

function isTrustedRawGistUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'gist.githubusercontent.com';
  } catch {
    return false;
  }
}

function contentByteLength(content: string): number {
  return new TextEncoder().encode(content).byteLength;
}

async function readLimitedText(response: Response): Promise<string> {
  if (!response.body) {
    const content = await response.text();
    if (contentByteLength(content) > MAX_SYNC_DOCUMENT_BYTES) {
      throw new Error('Gist sync file exceeded the 5 MiB limit.');
    }
    return content;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let content = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_SYNC_DOCUMENT_BYTES) {
      await reader.cancel();
      throw new Error('Gist sync file exceeded the 5 MiB limit.');
    }
    content += decoder.decode(value, { stream: true });
  }
  return content + decoder.decode();
}

function parseRetryAfter(response: Response): number | undefined {
  const value = response.headers.get('retry-after');
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

function parseRateLimitReset(response: Response): number | undefined {
  const seconds = Number(response.headers.get('x-ratelimit-reset'));
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1_000 : undefined;
}

function parseGist(value: GistResponse): GistInfo {
  if (
    typeof value.id !== 'string' ||
    typeof value.public !== 'boolean' ||
    typeof value.html_url !== 'string' ||
    typeof value.owner?.id !== 'number' ||
    typeof value.owner.login !== 'string' ||
    !value.files ||
    typeof value.files !== 'object'
  ) {
    throw new Error('GitHub returned an invalid Gist response.');
  }
  const htmlUrl = new URL(value.html_url);
  if (htmlUrl.protocol !== 'https:' || htmlUrl.hostname !== 'gist.github.com') {
    throw new Error('GitHub returned an invalid Gist URL.');
  }
  return {
    id: value.id,
    description: value.description ?? '',
    public: value.public,
    htmlUrl: htmlUrl.toString(),
    owner: { id: value.owner.id, login: value.owner.login },
    files: value.files,
  };
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

  private async request(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await this.fetcher(url, { ...init, signal: controller.signal });
      if (!response.ok) {
        throw new GitHubApiError(
          `GitHub returned ${response.status}.`,
          response.status,
          parseRetryAfter(response),
          parseRateLimitReset(response),
        );
      }
      return response;
    } finally {
      clearTimeout(timeout);
    }
  }

  async getAuthenticatedUser(): Promise<GitHubUser> {
    const response = await this.request('https://api.github.com/user', {
      method: 'GET',
      headers: this.headers(),
    });
    const value = (await response.json()) as { id?: unknown; login?: unknown };
    if (typeof value.id !== 'number' || typeof value.login !== 'string') {
      throw new Error('GitHub returned an invalid user response.');
    }
    return { id: value.id, login: value.login };
  }

  async listGists(): Promise<GistInfo[]> {
    const gists: GistInfo[] = [];
    for (let page = 1; ; page += 1) {
      const response = await this.request(
        `https://api.github.com/gists?per_page=100&page=${page}`,
        { method: 'GET', headers: this.headers() },
      );
      const values = (await response.json()) as GistResponse[];
      if (!Array.isArray(values)) throw new Error('GitHub returned an invalid Gist list.');
      gists.push(...values.map(parseGist));
      const hasNext = /<[^>]+>;\s*rel="next"/u.test(response.headers.get('link') ?? '');
      if (!hasNext) break;
    }
    return gists;
  }

  async getGist(gistId: string): Promise<GistInfo> {
    const response = await this.request(`https://api.github.com/gists/${encodeURIComponent(gistId)}`, {
      method: 'GET',
      headers: this.headers(),
    });
    return parseGist((await response.json()) as GistResponse);
  }

  private async readFile(file: GistFileResponse): Promise<string> {
    if (!file.truncated && typeof file.content === 'string') {
      if (contentByteLength(file.content) > MAX_SYNC_DOCUMENT_BYTES) {
        throw new Error('Gist sync file exceeded the 5 MiB limit.');
      }
      return file.content;
    }

    if (!file.raw_url) throw new Error('Gist file content was unavailable.');
    if (!isTrustedRawGistUrl(file.raw_url)) {
      throw new Error('Gist file raw URL was invalid.');
    }

    const rawResponse = await this.request(file.raw_url, { method: 'GET' });
    if (rawResponse.url && !isTrustedRawGistUrl(rawResponse.url)) {
      throw new Error('Gist file redirected to an untrusted URL.');
    }
    const declaredLength = Number(rawResponse.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_SYNC_DOCUMENT_BYTES) {
      throw new Error('Gist sync file exceeded the 5 MiB limit.');
    }
    return readLimitedText(rawResponse);
  }

  async getFileContent(gistId: string, fileName: string): Promise<string> {
    const gist = await this.getGist(gistId);
    const file = gist.files[fileName];
    if (!file) throw new GistFileNotFoundError('Gist file was not found.');
    return this.readFile(file);
  }

  async getFileContentFromGist(gist: GistInfo, fileName: string): Promise<string> {
    const file = gist.files[fileName];
    if (!file) throw new GistFileNotFoundError('Gist file was not found.');
    return this.readFile(file);
  }

  async updateFile(gistId: string, fileName: string, content: string): Promise<void> {
    await this.request(`https://api.github.com/gists/${encodeURIComponent(gistId)}`, {
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
  }
}
