import {
  classifyImmutabilityProbe,
  GITHUB_COM_HOST,
  type ImmutabilityCheck
} from './immutability';

export interface GitHubRepositoryInfo {
  fullName: string;
  isPrivate: boolean;
  defaultBranch: string;
  canPush: boolean;
}

export interface GitHubReleaseInfo {
  tagName: string;
  publishedAt: string | null;
  immutable?: boolean;
}

export class GitHubApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = 'GitHubApiError';
  }
}

interface RawRepository {
  full_name?: string;
  private?: boolean;
  default_branch?: string;
  permissions?: { push?: boolean };
}

interface RawRelease {
  tag_name?: string;
  published_at?: string | null;
  immutable?: boolean;
}

function releaseFromRaw(raw: RawRelease): GitHubReleaseInfo {
  return {
    tagName: raw.tag_name ?? '',
    publishedAt: raw.published_at ?? null,
    immutable: typeof raw.immutable === 'boolean' ? raw.immutable : undefined
  };
}

export class GitHubClient {
  constructor(
    private readonly tokenProvider: () => Promise<string | null>,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  private async request<T>(
    method: string,
    apiPath: string,
    body?: unknown,
    allowNotFound = false
  ): Promise<T | null> {
    const token = await this.tokenProvider();
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'ideahub-vscode'
    };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    let response: Response;
    try {
      response = await fetch(`https://api.github.com${apiPath}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body)
      });
    } catch (error) {
      throw new GitHubApiError(
        `无法连接 GitHub API：${error instanceof Error ? error.message : String(error)}`,
        0
      );
    }

    if (allowNotFound && response.status === 404) {
      return null;
    }

    if (!response.ok) {
      const text = await response.text();
      let detail = '';
      try {
        const parsed = JSON.parse(text) as { message?: string };
        detail = parsed.message ?? '';
      } catch {
        detail = text;
      }
      throw new GitHubApiError(
        describeStatus(response.status, detail),
        response.status
      );
    }

    if (response.status === 204) {
      return null;
    }
    return (await response.json()) as T;
  }

  async getRepository(owner: string, repo: string): Promise<GitHubRepositoryInfo | null> {
    const raw = await this.request<RawRepository>(
      'GET',
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
      undefined,
      true
    );
    if (!raw) {
      return null;
    }
    return {
      fullName: raw.full_name ?? `${owner}/${repo}`,
      isPrivate: raw.private === true,
      defaultBranch: raw.default_branch ?? 'main',
      canPush: raw.permissions?.push === true
    };
  }

  async getImmutableReleasesStatus(
    owner: string,
    repo: string,
    host: string = GITHUB_COM_HOST
  ): Promise<ImmutabilityCheck> {
    if (host.toLowerCase() !== GITHUB_COM_HOST) {
      return { kind: 'unknown', reason: 'non-github-host' };
    }

    const token = await this.tokenProvider();
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'ideahub-vscode'
    };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    let response: Response;
    try {
      response = await this.fetchImpl(
        `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(
          repo
        )}/immutable-releases`,
        { method: 'GET', headers }
      );
    } catch (error) {
      return classifyImmutabilityProbe({
        type: 'network-error',
        message: error instanceof Error ? error.message : String(error)
      });
    }

    let body: unknown;
    if (response.status === 200) {
      try {
        body = await response.json();
      } catch {
        body = undefined;
      }
    }

    return classifyImmutabilityProbe({
      type: 'response',
      host,
      status: response.status,
      body
    });
  }

  async getReleaseByTag(
    owner: string,
    repo: string,
    tag: string
  ): Promise<GitHubReleaseInfo | null> {
    const raw = await this.request<RawRelease>(
      'GET',
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases/tags/${encodeURIComponent(
        tag
      )}`,
      undefined,
      true
    );
    return raw ? releaseFromRaw(raw) : null;
  }

  async createRelease(
    owner: string,
    repo: string,
    tag: string,
    hash: string,
    branch: string
  ): Promise<{ created: boolean; release: GitHubReleaseInfo | null }> {
    try {
      const raw = await this.request<RawRelease>(
        'POST',
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases`,
        {
          tag_name: tag,
          target_commitish: branch,
          name: hash,
          body: hash,
          draft: false,
          prerelease: false
        }
      );
      return { created: true, release: raw ? releaseFromRaw(raw) : null };
    } catch (error) {
      if (error instanceof GitHubApiError && error.status === 422) {
        const existing = await this.getReleaseByTag(owner, repo, tag);
        if (existing) {
          return { created: false, release: existing };
        }
      }
      throw error;
    }
  }

  async listReleases(owner: string, repo: string): Promise<GitHubReleaseInfo[]> {
    const raw = await this.request<RawRelease[]>(
      'GET',
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases?per_page=100`
    );
    return (raw ?? []).map(releaseFromRaw);
  }

  async hasContent(owner: string, repo: string, contentPath: string): Promise<boolean> {
    const raw = await this.request<unknown>(
      'GET',
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodeURIComponent(
        contentPath
      )}`,
      undefined,
      true
    );
    return raw !== null;
  }
}

function describeStatus(status: number, detail: string): string {
  if (status === 401) {
    return 'GitHub 认证已失效，请重新登录后重试。';
  }
  if (status === 403) {
    return `GitHub 拒绝访问（权限不足或触发速率限制）。${detail ? `详细信息：${detail}` : ''}`;
  }
  if (status === 404) {
    return '仓库不存在，或当前账号没有访问权限。';
  }
  return `GitHub API 请求失败（HTTP ${status}）。${detail ? `详细信息：${detail}` : ''}`;
}
