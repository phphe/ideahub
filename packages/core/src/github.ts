import { translate, type Translator } from './i18n';
export interface GitHubRepositoryInfo {
  fullName: string;
  isPrivate: boolean;
  defaultBranch: string;
  canPush: boolean;
}

export interface GitHubReleaseInfo {
  id?: number;
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
  id?: number;
  tag_name?: string;
  published_at?: string | null;
  immutable?: boolean;
}

interface RawCommit {
  sha?: string;
}

/**
 * Section 5.5: reads the `page` of the `rel="last"` entry from a GitHub `Link`
 * header. Returns `null` when the header is absent or has no usable page.
 */
function parseLastPage(link: string | null): number | null {
  if (!link) {
    return null;
  }
  for (const part of link.split(',')) {
    const rel = part.match(/;\s*rel="?([^";]+)"?/);
    if (!rel) {
      continue;
    }
    if (!rel[1].split(/\s+/).includes('last')) {
      continue;
    }
    const url = part.match(/<([^>]+)>/);
    if (!url) {
      return null;
    }
    try {
      const page = Number(new URL(url[1]).searchParams.get('page'));
      return Number.isInteger(page) && page > 0 ? page : null;
    } catch {
      return null;
    }
  }
  return null;
}

function earliestSha(commits: RawCommit[] | null): { sha: string } | null {
  if (!commits || commits.length === 0) {
    return null;
  }
  const sha = commits[commits.length - 1]?.sha;
  return typeof sha === 'string' && sha.length > 0 ? { sha } : null;
}

function releaseFromRaw(raw: RawRelease): GitHubReleaseInfo {
  return {
    id: typeof raw.id === 'number' ? raw.id : undefined,
    tagName: raw.tag_name ?? '',
    publishedAt: raw.published_at ?? null,
    immutable: typeof raw.immutable === 'boolean' ? raw.immutable : undefined
  };
}

function hasAlreadyExistsCode(payload: GitHubErrorPayload | undefined): boolean {
  return (payload?.errors ?? []).some((item) => item.code === 'already_exists');
}

export class GitHubClient {
  constructor(
    private readonly tokenProvider: () => Promise<string | null>,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly t: Translator = translate
  ) {}

  private async request<T>(
    method: string,
    apiPath: string,
    body?: unknown,
    allowNotFound = false
  ): Promise<T | null> {
    return (await this.requestDetailed<T>(method, apiPath, body, allowNotFound)).data;
  }

  private async requestDetailed<T>(
    method: string,
    apiPath: string,
    body?: unknown,
    allowNotFound = false
  ): Promise<{ data: T | null; link: string | null }> {
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
        this.t(
          'Unable to connect to the GitHub API: {0}',
          error instanceof Error ? error.message : String(error)
        ),
        0,
        url
      );
    }

    if (allowNotFound && response.status === 404) {
      return { data: null, link: null };
    }

    if (!response.ok) {
      const text = await response.text();
      const payload = parseErrorPayload(text);
      const detail = payload?.message ?? text;
      throw new GitHubApiError(
        describeStatus(response.status, detail, payload?.errors, this.t),
        response.status,
        url,
        payload,
        text
      );
    }

    if (response.status === 204) {
      return { data: null, link: response.headers.get('link') };
    }
    return { data: (await response.json()) as T, link: response.headers.get('link') };
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

  /**
   * Section 5.5: checks that a configured commit exists on the remote. Returns
   * `null` for 404/409/422 so the caller can fall back to the default branch.
   */
  async getCommit(
    owner: string,
    repo: string,
    commit: string
  ): Promise<{ sha: string } | null> {
    try {
      const raw = await this.request<{ sha?: string }>(
        'GET',
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits/${encodeURIComponent(
          commit
        )}`
      );
      const sha = raw?.sha;
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

  /**
   * Section 5.5: returns the earliest commit of `branch`. GitHub lists commits
   * newest-first, so the last item of the last page is the earliest. The last
   * page is taken from the `Link` header's `rel="last"` entry; without it the
   * first page is also the last page.
   */
  async getEarliestCommit(
    owner: string,
    repo: string,
    branch: string
  ): Promise<{ sha: string } | null> {
    const basePath =
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits` +
      `?sha=${encodeURIComponent(branch)}&per_page=100`;
    try {
      const first = await this.requestDetailed<RawCommit[]>('GET', basePath);
      const lastPage = parseLastPage(first.link);
      if (lastPage === null || lastPage <= 1) {
        return earliestSha(first.data);
      }
      const last = await this.requestDetailed<RawCommit[]>('GET', `${basePath}&page=${lastPage}`);
      return earliestSha(last.data);
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

  private async postRelease(
    owner: string,
    repo: string,
    tag: string,
    targetCommitish: string
  ): Promise<{ created: boolean; release: GitHubReleaseInfo | null }> {
    const raw = await this.request<RawRelease>(
      'POST',
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases`,
      {
        tag_name: tag,
        target_commitish: targetCommitish,
        name: tag,
        body: '',
        draft: false,
        prerelease: false
      }
    );
    return { created: true, release: raw ? releaseFromRaw(raw) : null };
  }

  async deleteRelease(owner: string, repo: string, id: number): Promise<void> {
    await this.request(
      'DELETE',
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases/${id}`
    );
  }

  /**
   * Section 7.4: when the tag already exists, an immutable Release is the
   * idempotent result. A mutable (or unknown) one is deleted silently and
   * recreated; any other failure keeps the original error.
   */
  async createRelease(
    owner: string,
    repo: string,
    tag: string,
    targetCommitish: string
  ): Promise<{ created: boolean; release: GitHubReleaseInfo | null }> {
    try {
      return await this.postRelease(owner, repo, tag, targetCommitish);
    } catch (error) {
      if (
        !(
          error instanceof GitHubApiError &&
          error.status === 422 &&
          hasAlreadyExistsCode(error.payload)
        )
      ) {
        throw error;
      }
      const existing = await this.getReleaseByTag(owner, repo, tag);
      if (!existing) {
        throw error;
      }
      if (existing.immutable === true) {
        return { created: false, release: existing };
      }
      if (typeof existing.id !== 'number') {
        throw error;
      }
      await this.deleteRelease(owner, repo, existing.id);
      return this.postRelease(owner, repo, tag, targetCommitish);
    }
  }

  async listReleases(owner: string, repo: string): Promise<GitHubReleaseInfo[]> {
    const raw = await this.request<RawRelease[]>(
      'GET',
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases?per_page=100`
    );
    return (raw ?? []).map(releaseFromRaw);
  }

  /**
   * Section 7.6: paginate the whole release list before comparing proof tags,
   * instead of requesting each tag individually.
   */
  async listAllReleases(owner: string, repo: string): Promise<GitHubReleaseInfo[]> {
    const base = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases`;
    const all: GitHubReleaseInfo[] = [];
    for (let page = 1; page <= 100; page += 1) {
      const raw = await this.request<RawRelease[]>(
        'GET',
        `${base}?per_page=100&page=${page}`
      );
      const items = (raw ?? []).map(releaseFromRaw).filter((item) => item.tagName.length > 0);
      all.push(...items);
      if (items.length < 100) {
        break;
      }
    }
    return all;
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

function describe422Hint(
  errors: GitHubValidationError[] | undefined,
  t: Translator
): string {
  if (!errors || errors.length === 0) {
    return '';
  }
  const fields = new Set(errors.map((entry) => entry.field).filter(Boolean));
  const codes = new Set(errors.map((entry) => entry.code).filter(Boolean));
  if (fields.has('target_commitish')) {
    return t(
      '\nHint: the branch or commit referenced by target_commitish does not exist in the remote proof repository. Make sure the remote proof repository has at least one commit and the branch has been pushed.'
    );
  }
  if (fields.has('tag_name') || codes.has('already_exists')) {
    return t(
      '\nHint: tag_name already exists (there may be an existing Git tag or Release). To avoid overwriting, the extension does not modify or delete existing content.'
    );
  }
  return t('\nHint: fix the resource / field / code in errors and retry the request.');
}

function describeStatus(
  status: number,
  detail: string,
  errors: GitHubValidationError[] | undefined,
  t: Translator
): string {
  const errorsLine =
    errors && errors.length > 0
      ? `\n${t('errors (raw response): {0}', JSON.stringify(errors))}`
      : '';
  if (status === 401) {
    return t('GitHub authentication has expired. Sign in again and retry.');
  }
  if (status === 403) {
    return `${t('GitHub access denied (insufficient permission or rate limit).')}${
      detail ? ` ${t('Detail: {0}', detail)}` : ''
    }${errorsLine}`;
  }
  if (status === 404) {
    return t('The repository does not exist, or the current account cannot access it.');
  }
  if (status === 422) {
    return `${t('GitHub API request failed (HTTP 422).')}${
      detail ? ` ${t('Detail: {0}', detail)}` : ''
    }${errorsLine}${describe422Hint(errors, t)}`;
  }
  return `${t('GitHub API request failed (HTTP {0}).', status)}${
    detail ? ` ${t('Detail: {0}', detail)}` : ''
  }${errorsLine}`;
}
