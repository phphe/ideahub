/**
 * Section 13.2: strict project URL parsing.
 *
 * Only two forms are accepted:
 *   https://github.com/<owner>/<repo>/tree/<branch>/<path...>
 *   https://github.com/<owner>/<repo>/tree/<branch>/<path...>/README.md
 *
 * Anything else is rejected with a message and exit code 2. The branch/path
 * boundary is resolved later against the repository's real branch list,
 * because branch names may contain `/`.
 */

export interface ParsedProjectUrl {
  owner: string;
  repo: string;
  /** Segments after `tree/`, with a trailing `README.md` removed. */
  segments: string[];
  /** True when the input pointed at `.../README.md`. */
  readme: boolean;
}

export type ParseProjectUrlResult =
  | { ok: true; value: ParsedProjectUrl }
  | { ok: false; message: string };

const OWNER_OR_REPO = /^[A-Za-z0-9._-]+$/;

function invalid(input: string, reason: string): ParseProjectUrlResult {
  return {
    ok: false,
    message: `无法解析的地址或不符合要求的地址：${input}\n${reason}`
  };
}

export function parseProjectUrl(input: string): ParseProjectUrlResult {
  const raw = input.trim();
  if (raw.length === 0) {
    return invalid(input, '地址为空。');
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return invalid(input, '不是合法的 URL。');
  }

  if (url.protocol !== 'https:') {
    return invalid(input, '只支持 https 地址。');
  }
  if (url.hostname.toLowerCase() !== 'github.com') {
    return invalid(input, '只支持 github.com 的仓库地址。');
  }

  let segments: string[];
  try {
    // Query strings (`?tab=readme-ov-file`) and anchors are dropped by
    // `pathname`, trailing slashes are dropped by filtering empty segments.
    segments = url.pathname
      .split('/')
      .filter((segment) => segment.length > 0)
      .map((segment) => decodeURIComponent(segment));
  } catch {
    return invalid(input, '路径中存在无法解码的百分号编码。');
  }

  if (segments.length < 3 || segments[2] !== 'tree') {
    return invalid(
      input,
      '只接受 /tree/<branch>/<path...> 形式，不接受 blob/、根地址或其它路径。'
    );
  }

  const owner = segments[0];
  const repo = segments[1];
  if (!OWNER_OR_REPO.test(owner) || !OWNER_OR_REPO.test(repo)) {
    return invalid(input, 'owner 或 repo 名称不合法。');
  }

  let rest = segments.slice(3);
  for (const segment of rest) {
    if (segment === '.' || segment === '..') {
      return invalid(input, '路径中不允许出现 . 或 .. 段。');
    }
  }

  const readmeIndex = rest.indexOf('README.md');
  if (readmeIndex >= 0 && readmeIndex !== rest.length - 1) {
    return invalid(input, 'README.md 之后不允许再有路径。');
  }

  let readme = false;
  if (rest.length > 0 && rest[rest.length - 1] === 'README.md') {
    readme = true;
    rest = rest.slice(0, -1);
  }
  if (rest.length < 2) {
    return invalid(input, '缺少分支或项目路径，无法确定要校验的项目。');
  }

  return { ok: true, value: { owner, repo, segments: rest, readme } };
}

export interface BranchResolution {
  branch: string;
  /** Path segments that belong to the project folder. */
  projectSegments: string[];
}

/**
 * Section 13.2: pick the longest branch name that is a segment prefix of the
 * URL path. No guessing, no `default_branch` fallback.
 */
export function resolveBranch(
  segments: string[],
  branchNames: string[]
): BranchResolution | null {
  const candidates = branchNames
    .map((branch) => ({ branch, parts: branch.split('/').filter(Boolean) }))
    .filter((entry) => entry.parts.length > 0 && entry.parts.length < segments.length)
    .filter((entry) => entry.parts.every((part, index) => segments[index] === part))
    .sort((left, right) => right.parts.length - left.parts.length);

  const best = candidates[0];
  if (!best) {
    return null;
  }
  return { branch: best.branch, projectSegments: segments.slice(best.parts.length) };
}
