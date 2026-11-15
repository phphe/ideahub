/**
 * Section 13.2: the small GitHub REST surface the CLI needs. The VS Code
 * extension has its own client with different concerns; only the fingerprint
 * algorithm is shared, not the transport.
 */

export class RateLimitError extends Error {
  constructor(
    message: string,
    readonly retryAfter?: string
  ) {
    super(message);
    this.name = 'RateLimitError';
  }
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface RepoInfo {
  fullName: string;
  defaultBranch: string;
  isPrivate: boolean;
}

export interface ReleaseInfo {
  tagName: string;
  publishedAt: string | null;
  immutable?: boolean;
}

export interface TreeEntry {
  path: string;
  type: string;
  sha: string;
}

interface RawRelease {
  tag_name?: string;
  published_at?: string | null;
  immutable?: boolean;
}

const API = 'https://api.github.com';

export class CliGitHub {
  constructor(
    private readonly token: string | null,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'ideahub-cli'
    };
    if (this.token) {
      headers.Authorization = `Bearer ${this.token}`;
    }
    return headers;
  }

  private async requestJson<T>(apiPath: string, allowNotFound = false): Promise<T | null> {
    const url = `${API}${apiPath}`;
    let response: Response;
    try {
      response = await this.fetchImpl(url, { method: 'GET', headers: this.headers() });
    } catch (error) {
      throw new ApiError(
        `Cannot reach the GitHub API: ${error instanceof Error ? error.message : String(error)}`,
        0
      );
    }

    if (allowNotFound && response.status === 404) {
      return null;
    }
    if (response.status === 401) {
      throw new ApiError('GitHub authentication failed; run `ideahub login` again.', 401);
    }
    if (response.status === 403 || response.status === 429) {
      const remaining = response.headers.get('x-ratelimit-remaining');
      const retryAfter = response.headers.get('retry-after') ?? undefined;
      if (response.status === 429 || remaining === '0' || retryAfter) {
        throw new RateLimitError(
          'The GitHub API rate limit is exhausted. Run `ideahub login` and retry (5000 requests per hour when signed in).',
          retryAfter
        );
      }
      throw new ApiError('GitHub denied the request (HTTP 403).', 403);
    }
    if (!response.ok) {
      throw new ApiError(`GitHub API request failed (HTTP ${response.status}).`, response.status);
    }
    return (await response.json()) as T;
  }

  async getRepository(owner: string, repo: string): Promise<RepoInfo | null> {
    const raw = await this.requestJson<{
      full_name?: string;
      default_branch?: string;
      private?: boolean;
    }>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, true);
    if (!raw) {
      return null;
    }
    return {
      fullName: raw.full_name ?? `${owner}/${repo}`,
      defaultBranch: raw.default_branch ?? 'main',
      isPrivate: raw.private === true
    };
  }

  async listBranches(owner: string, repo: string): Promise<string[]> {
    const base = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches`;
    const names: string[] = [];
    for (let page = 1; page <= 100; page += 1) {
      const raw = await this.requestJson<Array<{ name?: string }>>(
        `${base}?per_page=100&page=${page}`
      );
      const items = (raw ?? []).filter((entry) => typeof entry.name === 'string' && entry.name);
      for (const item of items) {
        names.push(item.name as string);
      }
      if (items.length < 100) {
        break;
      }
    }
    return names;
  }

  async getBranchHeadSha(
    owner: string,
    repo: string,
    branch: string
  ): Promise<string | null> {
    const ref = branch.split('/').map(encodeURIComponent).join('/');
    const raw = await this.requestJson<{ object?: { sha?: string } }>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/ref/heads/${ref}`,
      true
    );
    const sha = raw?.object?.sha;
    return typeof sha === 'string' && sha.length > 0 ? sha : null;
  }

  async getTreeRecursive(
    owner: string,
    repo: string,
    sha: string
  ): Promise<{ entries: TreeEntry[]; truncated: boolean }> {
    const raw = await this.requestJson<{
      tree?: Array<{ path?: string; type?: string; sha?: string }>;
      truncated?: boolean;
    }>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(
        repo
      )}/git/trees/${encodeURIComponent(sha)}?recursive=1`
    );
    const entries: TreeEntry[] = [];
    for (const entry of raw?.tree ?? []) {
      if (typeof entry.path === 'string' && typeof entry.type === 'string') {
        entries.push({ path: entry.path, type: entry.type, sha: entry.sha ?? '' });
      }
    }
    return { entries, truncated: raw?.truncated === true };
  }

  async listReleases(owner: string, repo: string): Promise<ReleaseInfo[]> {
    const base = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases`;
    const all: ReleaseInfo[] = [];
    for (let page = 1; page <= 100; page += 1) {
      const raw = await this.requestJson<RawRelease[]>(`${base}?per_page=100&page=${page}`);
      const items = (raw ?? [])
        .map((entry) => ({
          tagName: entry.tag_name ?? '',
          publishedAt: entry.published_at ?? null,
          immutable: typeof entry.immutable === 'boolean' ? entry.immutable : undefined
        }))
        .filter((entry) => entry.tagName.length > 0);
      all.push(...items);
      if (items.length < 100) {
        break;
      }
    }
    return all;
  }

  /** Raw content does not consume the REST quota. */
  async getRawFile(
    owner: string,
    repo: string,
    ref: string,
    filePath: string
  ): Promise<string | null> {
    const url = `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(
      repo
    )}/${ref
      .split('/')
      .map(encodeURIComponent)
      .join('/')}/${filePath.split('/').map(encodeURIComponent).join('/')}`;
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: 'GET',
        headers: { 'User-Agent': 'ideahub-cli' }
      });
    } catch (error) {
      throw new ApiError(
        `Cannot read the remote file: ${error instanceof Error ? error.message : String(error)}`,
        0
      );
    }
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new ApiError(`Failed to read the remote file (HTTP ${response.status}).`, response.status);
    }
    return response.text();
  }

  async getAuthenticatedLogin(): Promise<string> {
    const raw = await this.requestJson<{ login?: string }>('/user');
    return raw?.login ?? 'unknown';
  }
}
