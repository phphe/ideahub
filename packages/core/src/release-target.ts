import { runGit } from './git';
import { translate, type Translator } from './i18n';

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

function tagMessage(problem: RefProblem, t: Translator): string {
  switch (problem) {
    case 'empty':
      return t('The generated tag is empty and cannot be used to create a Release.');
    case 'too-long':
      return t(
        'The generated tag exceeds {0} characters and cannot be used to create a Release.',
        MAX_REF_LENGTH
      );
    case 'invalid-char':
      return t(
        'The generated tag contains characters Git does not allow (space, ~ ^ : ? * [ \\ or control characters).'
      );
    case 'leading':
      return t('The generated tag cannot start with "." or "/".');
    case 'trailing':
      return t('The generated tag cannot end with "." or "/".');
    case 'leading-dash':
      return t('The generated tag cannot start with "-" or be named "HEAD".');
    case 'dot-dot':
      return t('The generated tag cannot contain consecutive "..".');
    case 'at-brace':
      return t('The generated tag cannot contain "@{".');
    case 'double-slash':
      return t('The generated tag cannot contain consecutive slashes.');
    case 'lock':
      return t('The generated tag segments cannot end with ".lock".');
    default:
      return t('The generated tag is invalid and cannot be used to create a Release.');
  }
}

function branchMessage(problem: RefProblem, t: Translator): string {
  switch (problem) {
    case 'empty':
      return t(
        'The release branch name is empty. Check the extension developer configuration or use the default "main".'
      );
    case 'too-long':
      return t('The release branch name exceeds {0} characters.', MAX_REF_LENGTH);
    case 'invalid-char':
      return t(
        'The release branch name contains characters Git does not allow (space, ~ ^ : ? * [ \\ or control characters).'
      );
    case 'leading':
      return t('The release branch name cannot start with "." or "/".');
    case 'trailing':
      return t('The release branch name cannot end with "." or "/".');
    case 'leading-dash':
      return t('The release branch name cannot start with "-" or be named "HEAD".');
    case 'dot-dot':
      return t('The release branch name cannot contain consecutive "..".');
    case 'at-brace':
      return t('The release branch name cannot contain "@{".');
    case 'double-slash':
      return t('The release branch name cannot contain consecutive slashes.');
    case 'lock':
      return t('The release branch name segments cannot end with ".lock".');
    default:
      return t('The release branch name is invalid.');
  }
}

/**
 * Validates a bare tag name against Git's ref rules for `refs/tags/<tag>`
 * (the same checks as `git check-ref-format "refs/tags/<tag>"`).
 */
export function validateTagName(tag: string, t: Translator = translate): string | null {
  const problem = findRefProblem(tag);
  return problem ? tagMessage(problem, t) : null;
}

/**
 * Validates a bare branch name against Git's ref rules for `refs/heads/<branch>`.
 */
export function validateBranchName(
  branch: string,
  t: Translator = translate
): string | null {
  const problem = findRefProblem(branch);
  return problem ? branchMessage(problem, t) : null;
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
  branch: string,
  t: Translator = translate
): Promise<BranchLookup> {
  const ref = `refs/heads/${branch}`;
  const result = await runGit(root, ['ls-remote', url, ref], { timeoutMs: 60_000 });
  if (result.code !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || t('exit code {0}', result.code);
    return {
      ok: false,
      missing: false,
      error: t('Unable to read the remote release branch (git ls-remote failed): {0}', detail)
    };
  }
  const sha = parseLsRemoteRef(result.stdout, ref);
  if (!sha) {
    return {
      ok: false,
      missing: true,
      error: t('The release branch does not exist: {0} ({1}).', branch, ref)
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
  branch: string,
  t: Translator = translate
): Promise<ReleaseTargetResult> {
  const branchError = validateBranchName(branch, t);
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
  branch: string,
  t: Translator = translate
): Promise<ReleaseTargetResult> {
  const branchError = validateBranchName(branch, t);
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
      error: t(
        'The remote release branch {0} does not exist, and automatic creation failed: {1}',
        branch,
        created.error
      )
    };
  }

  lookup = await deps.lookupBranch(branch);
  if (!lookup.ok) {
    return {
      ok: false,
      error: t(
        'The release branch {0} was created automatically, but reading its latest commit failed: {1}',
        branch,
        lookup.error
      )
    };
  }

  return { ok: true, target: { branch, sha: lookup.sha, defaultBranch } };
}
