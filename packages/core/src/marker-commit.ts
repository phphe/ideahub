import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { appendMarkerLine } from './ideas';
import { translate, type Translator } from './i18n';
import { isGitRepository, runGit, type GitResult } from './git';

export const DEFAULT_PROOF_COMMIT_MESSAGE = 'ideahub: record proof';
export const DEFAULT_PUBLISH_COMMIT_MESSAGE = 'ideahub: mark published';
export const CONFIG_INIT_COMMIT_MESSAGE = 'ideahub: initialize config';
export const CONFIG_REMOTE_COMMIT_MESSAGE = 'ideahub: update remote config';

export interface CommitMessageValues {
  project: string;
  time: string;
}

/**
 * Section 6.8: replace `{project}` and `{time}`; unknown placeholders are
 * kept verbatim, empty templates fall back to the given default.
 */
export function resolveCommitMessage(
  template: string | null | undefined,
  values: CommitMessageValues,
  fallback: string = DEFAULT_PROOF_COMMIT_MESSAGE
): string {
  const trimmed = typeof template === 'string' ? template.trim() : '';
  const chosen = trimmed.length > 0 ? trimmed : fallback;
  return chosen.replace(/\{(project|time)\}/g, (_match, key: string) => {
    return values[key as keyof CommitMessageValues];
  });
}

export interface MarkerCommitOptions {
  /** Workspace root (the local idea repository). */
  root: string;
  project: string;
  /** The exact marker line that was written, e.g. `Proof: ... [ideahub]`. */
  markerLine: string;
  message: string;
  /** Mirrors `ideahub.proof.autoCommit`. */
  enabled: boolean;
  t?: Translator;
}

export interface MarkerCommitResult {
  status: 'committed' | 'skipped' | 'failed';
  reason: string;
  /** True when the skip is expected and should only be logged. */
  silent: boolean;
  commit?: string;
}

function skipped(reason: string, silent: boolean): MarkerCommitResult {
  return { status: 'skipped', reason, silent };
}

function gitFailure(stage: string, result: GitResult, t: Translator): MarkerCommitResult {
  const detail = (
    result.stderr.trim() ||
    result.stdout.trim() ||
    t('exit code {0}', result.code)
  )
    .split(/\r?\n/)
    .join(' ');
  return { status: 'failed', reason: `${stage}: ${detail}`, silent: false };
}

function tempName(prefix: string): string {
  const unique = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return path.join(os.tmpdir(), `${prefix}-${unique}`);
}

/**
 * Sections 8.9 / 8.10: commit only the marker line of `ideas.md`.
 *
 * The commit is built from the HEAD blob plus the new marker line, using a
 * temporary index seeded with `HEAD`; the user's real index and working tree
 * are left untouched. Never pushes, never amends, never touches other files.
 */
export async function commitMarkerLine(
  options: MarkerCommitOptions
): Promise<MarkerCommitResult> {
  const t = options.t ?? translate;
  if (!options.enabled) {
    return skipped(t('Auto-commit is disabled (ideahub.proof.autoCommit=false)'), true);
  }
  if (!(await isGitRepository(options.root))) {
    return skipped(t('The local workspace is not a Git repository.'), true);
  }

  const toplevel = await runGit(options.root, ['rev-parse', '--show-toplevel']);
  if (toplevel.code !== 0) {
    return skipped(t('Unable to determine the Git repository root.'), true);
  }
  const repoRoot = toplevel.stdout.trim();
  const ideasPath = path.join(options.root, options.project, 'ideas.md');
  const relPath = path.relative(repoRoot, ideasPath).split(path.sep).join('/');
  if (!relPath || relPath.startsWith('../')) {
    return {
      status: 'failed',
      reason: t('ideas.md is not inside the Git repository.'),
      silent: false
    };
  }

  if ((await runGit(repoRoot, ['rev-parse', '--verify', 'HEAD'])).code !== 0) {
    return skipped(
      t('The local repository has no commit yet, so the baseline is unknown.'),
      false
    );
  }
  if ((await runGit(repoRoot, ['cat-file', '-e', `HEAD:${relPath}`])).code !== 0) {
    return skipped(
      t('ideas.md is not tracked by Git, so only the marker line cannot be committed.'),
      false
    );
  }

  const staged = await runGit(repoRoot, ['diff', '--cached', '--name-only', '--', relPath]);
  if (staged.code !== 0) {
    return gitFailure(t('Unable to inspect the staging area'), staged, t);
  }
  if (staged.stdout.trim().length > 0) {
    return skipped(t('ideas.md already has staged changes.'), false);
  }

  const headContent = await runGit(repoRoot, ['cat-file', '-p', `HEAD:${relPath}`]);
  if (headContent.code !== 0) {
    return skipped(t('Unable to read ideas.md from HEAD.'), false);
  }
  const updated = appendMarkerLine(headContent.stdout, options.markerLine);

  const tempFile = tempName('ideahub-marker');
  const tempIndex = tempName('ideahub-index');
  const indexEnv = { GIT_INDEX_FILE: tempIndex };
  try {
    await fs.writeFile(tempFile, updated, 'utf8');

    const blob = await runGit(repoRoot, ['hash-object', '-w', '-t', 'blob', tempFile]);
    if (blob.code !== 0) {
      return gitFailure(t('Unable to write the Git blob'), blob, t);
    }
    const blobSha = blob.stdout.trim();

    const readTree = await runGit(repoRoot, ['read-tree', 'HEAD'], { env: indexEnv });
    if (readTree.code !== 0) {
      return gitFailure(t('Unable to initialize the temporary index'), readTree, t);
    }

    const updateIndex = await runGit(
      repoRoot,
      ['update-index', '--add', '--cacheinfo', `100644,${blobSha},${relPath}`],
      { env: indexEnv }
    );
    if (updateIndex.code !== 0) {
      return gitFailure(t('Unable to write the temporary index'), updateIndex, t);
    }

    const commit = await runGit(repoRoot, ['commit', '-m', options.message], { env: indexEnv });
    if (commit.code !== 0) {
      return gitFailure(t('git commit failed'), commit, t);
    }

    // Keep the real index in sync for this path (there were no staged changes).
    await runGit(repoRoot, ['update-index', '--add', '--cacheinfo', `100644,${blobSha},${relPath}`]);

    const head = await runGit(repoRoot, ['rev-parse', 'HEAD']);
    return {
      status: 'committed',
      reason: '',
      silent: false,
      commit: head.stdout.trim()
    };
  } finally {
    await fs.unlink(tempFile).catch(() => undefined);
    await fs.unlink(tempIndex).catch(() => undefined);
  }
}

export interface SingleFileCommitOptions {
  /** Workspace root (the local idea repository). */
  root: string;
  /** Absolute path of the only file that may be committed. */
  filePath: string;
  message: string;
  t?: Translator;
}

/**
 * Section 2.4 exception two: commit `.ideahub/config.json` alone after it is
 * created by init or changed in settings. Uses the same temporary-index trick
 * as `commitMarkerLine`, so the user's index, working tree and other changes
 * are untouched. Never pushes, never amends.
 */
export async function commitSingleFile(
  options: SingleFileCommitOptions
): Promise<MarkerCommitResult> {
  const t = options.t ?? translate;
  if (!(await isGitRepository(options.root))) {
    return skipped(t('The local workspace is not a Git repository.'), true);
  }

  const toplevel = await runGit(options.root, ['rev-parse', '--show-toplevel']);
  if (toplevel.code !== 0) {
    return skipped(t('Unable to determine the Git repository root.'), true);
  }
  const repoRoot = toplevel.stdout.trim();
  const relPath = path.relative(repoRoot, options.filePath).split(path.sep).join('/');
  if (!relPath || relPath.startsWith('../')) {
    return {
      status: 'failed',
      reason: t('The configuration file is not inside the Git repository.'),
      silent: false
    };
  }

  let content: string;
  try {
    content = await fs.readFile(options.filePath, 'utf8');
  } catch {
    return skipped(t('The configuration file does not exist; nothing to commit.'), true);
  }

  const hasHead = (await runGit(repoRoot, ['rev-parse', '--verify', 'HEAD'])).code === 0;
  if (hasHead) {
    const headContent = await runGit(repoRoot, ['cat-file', '-p', `HEAD:${relPath}`]);
    if (headContent.code === 0 && headContent.stdout === content) {
      return skipped(t('The configuration file content did not change.'), true);
    }
  }

  const tempFile = tempName('ideahub-config');
  const tempIndex = tempName('ideahub-index');
  const indexEnv = { GIT_INDEX_FILE: tempIndex };
  try {
    await fs.writeFile(tempFile, content, 'utf8');

    const blob = await runGit(repoRoot, ['hash-object', '-w', '-t', 'blob', tempFile]);
    if (blob.code !== 0) {
      return gitFailure(t('Unable to write the Git blob'), blob, t);
    }
    const blobSha = blob.stdout.trim();

    const readTree = await runGit(repoRoot, ['read-tree', hasHead ? 'HEAD' : '--empty'], {
      env: indexEnv
    });
    if (readTree.code !== 0) {
      return gitFailure(t('Unable to initialize the temporary index'), readTree, t);
    }

    const updateIndex = await runGit(
      repoRoot,
      ['update-index', '--add', '--cacheinfo', `100644,${blobSha},${relPath}`],
      { env: indexEnv }
    );
    if (updateIndex.code !== 0) {
      return gitFailure(t('Unable to write the temporary index'), updateIndex, t);
    }

    const commit = await runGit(repoRoot, ['commit', '-m', options.message], { env: indexEnv });
    if (commit.code !== 0) {
      return gitFailure(t('git commit failed'), commit, t);
    }

    await runGit(repoRoot, ['update-index', '--add', '--cacheinfo', `100644,${blobSha},${relPath}`]);

    const head = await runGit(repoRoot, ['rev-parse', 'HEAD']);
    return {
      status: 'committed',
      reason: '',
      silent: false,
      commit: head.stdout.trim()
    };
  } finally {
    await fs.unlink(tempFile).catch(() => undefined);
    await fs.unlink(tempIndex).catch(() => undefined);
  }
}
