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

export interface GitHubValidationError {
  resource?: string;
  field?: string;
  code?: string;
  message?: string;
  [key: string]: unknown;
}

export interface GitHubErrorPayload {
  message?: string;
  errors?: GitHubValidationError[];
  documentation_url?: string;
}

export class GitHubApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly url?: string,
    readonly payload?: GitHubErrorPayload,
    readonly rawBody?: string
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
    const url = `https://api.github.com${apiPath}`;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body)
      });
    } catch (error) {
      throw new GitHubApiError(
        `无法连接 GitHub API：${error instanceof Error ? error.message : String(error)}`,
        0,
        url
      );
    }

    if (allowNotFound && response.status === 404) {
      return null;
    }

    if (!response.ok) {
      const text = await response.text();
      const payload = parseErrorPayload(text);
      const detail = payload?.message ?? text;
      throw new GitHubApiError(
        describeStatus(response.status, detail, payload?.errors),
        response.status,
        url,
        payload,
        text
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

  async getBranchHead(
    owner: string,
    repo: string,
    branch: string
  ): Promise<{ sha: string } | null> {
    const ref = branch.split('/').map(encodeURIComponent).join('/');
    try {
      const raw = await this.request<{ object?: { sha?: string } }>(
        'GET',
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/ref/heads/${ref}`
      );
      const sha = raw?.object?.sha;
      return typeof sha === 'string' && sha.length > 0 ? { sha } : null;
    } catch (error) {
      if (
        error instanceof GitHubApiError &&
        (error.status === 404 || error.status === 409 || error.status === 422)
      ) {
        return null;
      }
      throw error;
    }
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
    description: string,
    targetCommitish: string
  ): Promise<{ created: boolean; release: GitHubReleaseInfo | null }> {
    try {
      const raw = await this.request<RawRelease>(
        'POST',
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases`,
        {
          tag_name: tag,
          target_commitish: targetCommitish,
          name: tag,
          body: description,
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseErrorPayload(text: string): GitHubErrorPayload | undefined {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!isRecord(parsed)) {
      return undefined;
    }
    return {
      message: typeof parsed.message === 'string' ? parsed.message : undefined,
      errors: Array.isArray(parsed.errors)
        ? (parsed.errors as GitHubValidationError[])
        : undefined,
      documentation_url:
        typeof parsed.documentation_url === 'string'
          ? parsed.documentation_url
          : undefined
    };
  } catch {
    return undefined;
  }
}

function describe422Hint(errors?: GitHubValidationError[]): string {
  if (!errors || errors.length === 0) {
    return '';
  }
  const fields = new Set(errors.map((entry) => entry.field).filter(Boolean));
  const codes = new Set(errors.map((entry) => entry.code).filter(Boolean));
  if (fields.has('target_commitish')) {
    return '\n提示：target_commitish 指向的分支或提交在远程仓库中不存在。请确认远程仓库至少有一个提交，且该分支已推送到远端。';
  }
  if (fields.has('tag_name') || codes.has('already_exists')) {
    return '\n提示：tag_name 已存在（可能已有同名 Git tag 或 Release）。为避免覆盖，扩展不会修改或删除已有内容。';
  }
  return '\n提示：请根据 errors 中的 resource / field / code 修正请求参数后重试。';
}

function describeStatus(
  status: number,
  detail: string,
  errors?: GitHubValidationError[]
): string {
  const errorsLine =
    errors && errors.length > 0
      ? `\nerrors（原始响应）：${JSON.stringify(errors)}`
      : '';
  if (status === 401) {
    return 'GitHub 认证已失效，请重新登录后重试。';
  }
  if (status === 403) {
    return `GitHub 拒绝访问（权限不足或触发速率限制）。${detail ? `详细信息：${detail}` : ''}${errorsLine}`;
  }
  if (status === 404) {
    return '仓库不存在，或当前账号没有访问权限。';
  }
  if (status === 422) {
    return `GitHub API 请求失败（HTTP 422）。${detail ? `详细信息：${detail}` : ''}${errorsLine}${describe422Hint(errors)}`;
  }
  return `GitHub API 请求失败（HTTP ${status}）。${detail ? `详细信息：${detail}` : ''}${errorsLine}`;
}
