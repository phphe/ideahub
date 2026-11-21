import { translate, type Translator } from './i18n';

const MAX_REF_LENGTH = 120;
const INVALID_REF_CHARS = new Set([' ', '~', '^', ':', '?', '*', '[', '\\']);

/** Section 6.7: a configured release commit is a full or abbreviated hex id. */
export const RELEASE_COMMIT_PATTERN = /^[0-9a-f]{7,64}$/i;

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
      return t('The branch name is empty.');
    case 'too-long':
      return t('The branch name exceeds {0} characters.', MAX_REF_LENGTH);
    case 'invalid-char':
      return t(
        'The branch name contains characters Git does not allow (space, ~ ^ : ? * [ \\ or control characters).'
      );
    case 'leading':
      return t('The branch name cannot start with "." or "/".');
    case 'trailing':
      return t('The branch name cannot end with "." or "/".');
    case 'leading-dash':
      return t('The branch name cannot start with "-" or be named "HEAD".');
    case 'dot-dot':
      return t('The branch name cannot contain consecutive "..".');
    case 'at-brace':
      return t('The branch name cannot contain "@{".');
    case 'double-slash':
      return t('The branch name cannot contain consecutive slashes.');
    case 'lock':
      return t('The branch name segments cannot end with ".lock".');
    default:
      return t('The branch name is invalid.');
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

export interface ReleaseTarget {
  /** Remote default branch, read from the repository API. */
  branch: string;
  /** Commit used as `target_commitish`. */
  sha: string;
  /** Whether the SHA came from the configured commit or the earliest fallback. */
  commitSource: 'config' | 'branch-earliest';
  /** Why a configured commit was not used, when applicable. */
  releaseCommitFallback?: 'invalid' | 'missing';
}

export type ReleaseTargetResult =
  | { ok: true; target: ReleaseTarget }
  | { ok: false; error: string };

export interface ReleaseTargetDeps {
  getRepository: (owner: string, repo: string) => Promise<{ defaultBranch: string } | null>;
  getCommit: (owner: string, repo: string, commit: string) => Promise<{ sha: string } | null>;
  getEarliestCommit: (
    owner: string,
    repo: string,
    branch: string
  ) => Promise<{ sha: string } | null>;
}

/**
 * Section 5.5: the Release target is the configured `releaseCommit` when it
 * exists on the remote, otherwise the *earliest* commit of the repository's
 * `default_branch` (never a hard-coded `main`). The same commit may back many
 * Releases, so this resolver never consults or caches Releases by commit.
 */
export async function resolveReleaseTarget(
  deps: ReleaseTargetDeps,
  owner: string,
  repo: string,
  releaseCommit: string = '',
  t: Translator = translate
): Promise<ReleaseTargetResult> {
  const commit = releaseCommit.trim();
  const commitValid = commit.length === 0 || RELEASE_COMMIT_PATTERN.test(commit);

  let repository: { defaultBranch: string } | null;
  try {
    repository = await deps.getRepository(owner, repo);
  } catch (error) {
    return {
      ok: false,
      error: t(
        'Unable to read the remote proof repository default branch: {0}',
        error instanceof Error ? error.message : String(error)
      )
    };
  }
  const branch = repository?.defaultBranch.trim() ?? '';
  if (branch.length === 0) {
    return { ok: false, error: t('Unable to read the remote proof repository default branch.') };
  }

  if (commit.length > 0 && commitValid) {
    let found: { sha: string } | null;
    try {
      found = await deps.getCommit(owner, repo, commit);
    } catch (error) {
      return {
        ok: false,
        error: t(
          'Unable to check the configured release commit {0}: {1}',
          commit,
          error instanceof Error ? error.message : String(error)
        )
      };
    }
    if (found && found.sha.length > 0) {
      return { ok: true, target: { branch, sha: found.sha, commitSource: 'config' } };
    }
  }

  let earliest: { sha: string } | null;
  try {
    earliest = await deps.getEarliestCommit(owner, repo, branch);
  } catch (error) {
    return {
      ok: false,
      error: t(
        'Unable to read the earliest commit of the default branch {0}: {1}',
        branch,
        error instanceof Error ? error.message : String(error)
      )
    };
  }
  if (!earliest || earliest.sha.length === 0) {
    return {
      ok: false,
      error: t(
        'The default branch {0} has no commits. Push at least one commit to the remote proof repository first.',
        branch
      )
    };
  }

  const fallback: ReleaseTarget['releaseCommitFallback'] =
    commit.length === 0 ? undefined : commitValid ? 'missing' : 'invalid';
  return {
    ok: true,
    target: {
      branch,
      sha: earliest.sha,
      commitSource: 'branch-earliest',
      ...(fallback ? { releaseCommitFallback: fallback } : {})
    }
  };
}
