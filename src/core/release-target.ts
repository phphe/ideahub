import { runGit } from './git';

const MAX_REF_LENGTH = 120;
const INVALID_REF_CHARS = new Set([' ', '~', '^', ':', '?', '*', '[', '\\']);

type RefProblem =
  | 'empty'
  | 'too-long'
  | 'invalid-char'
  | 'leading'
  | 'trailing'
  | 'dot-dot'
  | 'at-brace'
  | 'double-slash'
  | 'lock'
  | 'leading-dash'
  | 'head';

function findRefProblem(name: string): RefProblem | null {
  if (name.length === 0) {
    return 'empty';
  }
  if (name.length > MAX_REF_LENGTH) {
    return 'too-long';
  }
  const hasInvalidChar = [...name].some((char) => {
    const code = char.charCodeAt(0);
    return code <= 0x1f || code === 0x7f || /\s/.test(char) || INVALID_REF_CHARS.has(char);
  });
  if (hasInvalidChar) {
    return 'invalid-char';
  }
  if (name.startsWith('.') || name.startsWith('/')) {
    return 'leading';
  }
  if (name.endsWith('.') || name.endsWith('/')) {
    return 'trailing';
  }
  if (name.startsWith('-') || name === 'HEAD') {
    return 'leading-dash';
  }
  if (name.includes('..')) {
    return 'dot-dot';
  }
  if (name.includes('@{')) {
    return 'at-brace';
  }
  if (name.includes('//')) {
    return 'double-slash';
  }
  if (name.split('/').some((segment) => segment.endsWith('.lock'))) {
    return 'lock';
  }
  return null;
}

function tagMessage(problem: RefProblem): string {
  switch (problem) {
    case 'empty':
      return '生成的 tag 为空，无法创建 Release。';
    case 'too-long':
      return `生成的 tag 超过 ${MAX_REF_LENGTH} 个字符，无法创建 Release。`;
    case 'invalid-char':
      return '生成的 tag 含 Git 不允许的字符（空格、~ ^ : ? * [ \\ 或控制字符）。';
    case 'leading':
      return '生成的 tag 不能以 "." 或 "/" 开头。';
    case 'trailing':
      return '生成的 tag 不能以 "." 或 "/" 结尾。';
    case 'leading-dash':
      return '生成的 tag 不能以 "-" 开头或命名为 "HEAD"。';
    case 'dot-dot':
      return '生成的 tag 不能包含连续的 ".."。';
    case 'at-brace':
      return '生成的 tag 不能包含 "@{"。';
    case 'double-slash':
      return '生成的 tag 不能包含连续的斜杠。';
    case 'lock':
      return '生成的 tag 分段不能以 ".lock" 结尾。';
    default:
      return '生成的 tag 不合法，无法创建 Release。';
  }
}

function branchMessage(problem: RefProblem): string {
  switch (problem) {
    case 'empty':
      return 'release 分支名为空，请检查扩展的开发者配置或使用默认值 main。';
    case 'too-long':
      return `release 分支名超过 ${MAX_REF_LENGTH} 个字符。`;
    case 'invalid-char':
      return 'release 分支名含 Git 不允许的字符（空格、~ ^ : ? * [ \\ 或控制字符）。';
    case 'leading':
      return 'release 分支名不能以 "." 或 "/" 开头。';
    case 'trailing':
      return 'release 分支名不能以 "." 或 "/" 结尾。';
    case 'leading-dash':
      return 'release 分支名不能以 "-" 开头或命名为 "HEAD"。';
    case 'dot-dot':
      return 'release 分支名不能包含连续的 ".."。';
    case 'at-brace':
      return 'release 分支名不能包含 "@{"。';
    case 'double-slash':
      return 'release 分支名不能包含连续的斜杠。';
    case 'lock':
      return 'release 分支名分段不能以 ".lock" 结尾。';
    default:
      return 'release 分支名不合法。';
  }
}

/**
 * Validates a bare tag name against Git's ref rules for `refs/tags/<tag>`
 * (the same checks as `git check-ref-format "refs/tags/<tag>"`).
 */
export function validateTagName(tag: string): string | null {
  const problem = findRefProblem(tag);
  return problem ? tagMessage(problem) : null;
}

/**
 * Validates a bare branch name against Git's ref rules for `refs/heads/<branch>`.
 */
export function validateBranchName(branch: string): string | null {
  const problem = findRefProblem(branch);
  return problem ? branchMessage(problem) : null;
}

export interface ReleaseTagResult {
  tag: string;
}

/**
 * Section 7.4: `ideahub-<sha256>` where the hash is computed over the project
 * name and the content sealed by the proof marker. Lowercase hex only contains
 * letters and digits, so it is always a valid tag.
 */
export function buildReleaseTag(hash: string): ReleaseTagResult {
  return { tag: `ideahub-${hash.trim().toLowerCase()}` };
}

export type BranchLookup =
  | { ok: true; sha: string }
  | { ok: false; missing: boolean; error: string };

/**
 * Reads `<sha>\trefs/heads/<branch>` from `git ls-remote` output.
 */
export function parseLsRemoteRef(stdout: string, ref: string): string | null {
  for (const line of stdout.split(/\r?\n/)) {
    const match = line.trim().match(/^([0-9a-f]{40}|[0-9a-f]{64})\s+(\S+)$/i);
    if (match && match[2] === ref) {
      return match[1];
    }
  }
  return null;
}

/**
 * Reads the latest commit SHA of a remote branch without fetching the whole
 * repository. Returns `missing: true` when ls-remote succeeded but the branch
 * does not exist, so callers can tell it apart from a network/URL failure.
 */
export async function lookupRemoteBranch(
  root: string,
  url: string,
  branch: string
): Promise<BranchLookup> {
  const ref = `refs/heads/${branch}`;
  const result = await runGit(root, ['ls-remote', url, ref], { timeoutMs: 60_000 });
  if (result.code !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || `exit ${result.code}`;
    return {
      ok: false,
      missing: false,
      error: `无法读取远程 release 分支（git ls-remote 失败）：${detail}`
    };
  }
  const sha = parseLsRemoteRef(result.stdout, ref);
  if (!sha) {
    return {
      ok: false,
      missing: true,
      error: `release 分支不存在：${branch}（${ref}）。`
    };
  }
  return { ok: true, sha };
}

export interface ReleaseTarget {
  branch: string;
  sha: string;
  defaultBranch: string | null;
}

export type ReleaseTargetResult =
  | { ok: true; target: ReleaseTarget }
  | { ok: false; error: string };

export interface ReleaseTargetDeps {
  getRepository: (owner: string, repo: string) => Promise<{ defaultBranch: string } | null>;
  lookupBranch: (branch: string) => Promise<BranchLookup>;
}

/**
 * Resolves the release branch commit that must exist on the remote. The
 * configured `releaseBranch` is authoritative; the repository's default branch
 * is only read so the caller can log both when they differ.
 */
export async function resolveReleaseTarget(
  deps: ReleaseTargetDeps,
  owner: string,
  repo: string,
  branch: string
): Promise<ReleaseTargetResult> {
  const branchError = validateBranchName(branch);
  if (branchError) {
    return { ok: false, error: branchError };
  }

  let defaultBranch: string | null = null;
  try {
    const repository = await deps.getRepository(owner, repo);
    defaultBranch = repository?.defaultBranch.trim() || null;
  } catch {
    // The API lookup is only used for logging; ls-remote is authoritative.
  }

  const lookup = await deps.lookupBranch(branch);
  if (!lookup.ok) {
    return { ok: false, error: lookup.error };
  }

  return {
    ok: true,
    target: { branch, sha: lookup.sha, defaultBranch }
  };
}

export interface EnsureReleaseTargetDeps extends ReleaseTargetDeps {
  /** Creates the missing release branch with only the `empty` file. */
  createBranch(branch: string): Promise<{ ok: true } | { ok: false; error: string }>;
}

/**
 * Section 5.5 / 8.9: when the release branch is missing, create it (and push
 * only the `empty` file) and then read its latest commit. Any creation or
 * lookup failure aborts before a Release request or a local marker is written.
 */
export async function ensureReleaseTarget(
  deps: EnsureReleaseTargetDeps,
  owner: string,
  repo: string,
  branch: string
): Promise<ReleaseTargetResult> {
  const branchError = validateBranchName(branch);
  if (branchError) {
    return { ok: false, error: branchError };
  }

  let defaultBranch: string | null = null;
  try {
    const repository = await deps.getRepository(owner, repo);
    defaultBranch = repository?.defaultBranch.trim() || null;
  } catch {
    // The API lookup is only used for logging; ls-remote is authoritative.
  }

  let lookup = await deps.lookupBranch(branch);
  if (lookup.ok) {
    return { ok: true, target: { branch, sha: lookup.sha, defaultBranch } };
  }
  if (!lookup.missing) {
    return { ok: false, error: lookup.error };
  }

  const created = await deps.createBranch(branch);
  if (!created.ok) {
    return {
      ok: false,
      error: `远程不存在 release 分支 ${branch}，自动创建失败：${created.error}`
    };
  }

  lookup = await deps.lookupBranch(branch);
  if (!lookup.ok) {
    return {
      ok: false,
      error: `release 分支 ${branch} 已自动创建，但读取最新 commit 失败：${lookup.error}`
    };
  }

  return { ok: true, target: { branch, sha: lookup.sha, defaultBranch } };
}
