import { promises as fs } from 'node:fs';
import { describeError, readConfig, remoteRepoPath, writeConfig, type RemoteConfig } from './config';
import { hasHeadCommit, isGitRepository, runGit } from './git';
import { translate, type Translator } from './i18n';
import { parseRemoteUrl } from './remote-url';

export type CloneResult =
  | { ok: true; branch: string }
  | { ok: false; error: string; detail?: string };

export const REMOTE_PATH_NOT_DIRECTORY_ERROR =
  '.ideahub/remote exists and is not a directory. Handle it manually and try again.';

export const REMOTE_DIR_NON_EMPTY_ERROR =
  'The .ideahub/remote directory already exists and is not empty. To avoid overwriting existing content, the clone was stopped; use "Re-clone" if you need a fresh clone.';

export const INNER_REPO_NO_HEAD_ERROR =
  'The inner repository is empty, incomplete, or the clone did not finish (no usable HEAD). Use "Re-clone" to fetch the remote idea repository again, then retry.';

export interface RepositoryReadyResult {
  ok: boolean;
  error?: string;
  detail?: string;
}

/**
 * A successful `git clone` can still leave an unborn HEAD (empty remote or an
 * interrupted checkout). Treat that as a failed clone so the half-finished
 * directory is cleaned up and the user keeps a retry entry point.
 */
export async function verifyClonedRepository(
  target: string,
  t: Translator = translate
): Promise<RepositoryReadyResult> {
  if (!(await isGitRepository(target))) {
    return {
      ok: false,
      error: t(INNER_REPO_NO_HEAD_ERROR),
      detail: 'git rev-parse --git-dir failed'
    };
  }
  const head = await runGit(target, ['rev-parse', '--verify', 'HEAD']);
  if (head.code !== 0 || head.stdout.trim().length === 0) {
    return {
      ok: false,
      error: t(INNER_REPO_NO_HEAD_ERROR),
      detail: head.stderr.trim() || head.stdout.trim() || 'git rev-parse --verify HEAD failed'
    };
  }
  return { ok: true };
}

export type RemoteTargetInspection =
  | { kind: 'missing' }
  | { kind: 'valid-repo' }
  | { kind: 'blocked'; reason: string };

export async function inspectRemoteTarget(
  root: string,
  t: Translator = translate
): Promise<RemoteTargetInspection> {
  const target = remoteRepoPath(root);
  let stat;
  try {
    stat = await fs.stat(target);
  } catch {
    return { kind: 'missing' };
  }
  if (!stat.isDirectory()) {
    return { kind: 'blocked', reason: t(REMOTE_PATH_NOT_DIRECTORY_ERROR) };
  }
  if (await isGitRepository(target)) {
    if (await hasHeadCommit(target)) {
      return { kind: 'valid-repo' };
    }
    return { kind: 'blocked', reason: t(INNER_REPO_NO_HEAD_ERROR) };
  }
  try {
    const entries = await fs.readdir(target);
    return entries.length === 0
      ? { kind: 'missing' }
      : { kind: 'blocked', reason: t(REMOTE_DIR_NON_EMPTY_ERROR) };
  } catch (error) {
    return {
      kind: 'blocked',
      reason: t('Unable to read .ideahub/remote: {0}', describeError(error))
    };
  }
}

export function describeCloneFailure(
  output: string,
  t: Translator = translate
): string {
  const text = output.trim();
  if (!text) {
    return t('Failed to clone the remote idea repository: git returned no error message.');
  }
  if (
    /Authentication failed|could not read Username|could not read Password|terminal prompts disabled|Permission denied|403|access denied/i.test(
      text
    )
  ) {
    return t(
      'Failed to clone the remote idea repository: authentication failed, so the remote repository cannot be accessed with the current credentials. Make sure you are signed in to GitHub and have write access.\nRaw message: {0}',
      text
    );
  }
  if (/Repository not found|repository .* does not exist/i.test(text)) {
    return t(
      'Failed to clone the remote idea repository: the repository does not exist, or the current account cannot access it.\nRaw message: {0}',
      text
    );
  }
  if (
    /Could not resolve host|unable to access|Connection (timed out|refused|reset)|Network is unreachable|SSL|TLS|proxy|RPC failed/i.test(
      text
    )
  ) {
    return t(
      'Failed to clone the remote idea repository: network error, the remote repository cannot be reached. Check your network or proxy settings.\nRaw message: {0}',
      text
    );
  }
  return t('Failed to clone the remote idea repository: {0}', text);
}

export function buildCloneArgs(url: string, branch: string, target: string): string[] {
  return ['clone', '--depth', '1', '--branch', branch, url, target];
}

export async function cloneRemoteRepository(
  root: string,
  remote: RemoteConfig,
  t: Translator = translate
): Promise<CloneResult> {
  const parsed = parseRemoteUrl(remote.url, t);
  if (!parsed.ok) {
    return { ok: false, error: parsed.error };
  }
  if (remote.branch.trim().length === 0) {
    return {
      ok: false,
      error: t(
        'The remote branch is empty and cannot be cloned. Save the remote repository configuration first (leave it empty to use the remote default branch).'
      )
    };
  }

  const target = remoteRepoPath(root);
  let targetExists = false;
  let targetWasEmpty = false;
  try {
    const stat = await fs.stat(target);
    if (!stat.isDirectory()) {
      return { ok: false, error: t(REMOTE_PATH_NOT_DIRECTORY_ERROR) };
    }
    targetExists = true;
    targetWasEmpty = (await fs.readdir(target)).length === 0;
  } catch {
    targetExists = false;
  }

  if (targetExists && !targetWasEmpty) {
    return { ok: false, error: t(REMOTE_DIR_NON_EMPTY_ERROR) };
  }

  const result = await runGit(root, buildCloneArgs(remote.url, remote.branch, target), {
    timeoutMs: 300_000
  });

  if (result.code !== 0) {
    await cleanupFailedClone(target, targetExists, targetWasEmpty);
    return {
      ok: false,
      error: describeCloneFailure(result.stderr.trim() || result.stdout.trim(), t),
      detail: result.stderr.trim() || result.stdout.trim()
    };
  }

  const verified = await verifyClonedRepository(target, t);
  if (!verified.ok) {
    await cleanupFailedClone(target, targetExists, targetWasEmpty);
    return {
      ok: false,
      error: verified.error ?? t(INNER_REPO_NO_HEAD_ERROR),
      detail: verified.detail
    };
  }

  const branchResult = await runGit(target, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const branch = branchResult.stdout.trim();
  if (branchResult.code !== 0 || branch.length === 0 || branch === 'HEAD') {
    return {
      ok: false,
      error: t(INNER_REPO_NO_HEAD_ERROR),
      detail: branchResult.stderr.trim() || branch
    };
  }

  if (branch !== remote.branch) {
    const configResult = await readConfig(root);
    if (configResult.ok && configResult.config.remote) {
      await writeConfig(root, {
        version: 1,
        remote: { ...configResult.config.remote, branch }
      });
    }
  }

  return { ok: true, branch };
}

async function cleanupFailedClone(
  target: string,
  targetExists: boolean,
  targetWasEmpty: boolean
): Promise<void> {
  try {
    if (!targetExists) {
      await fs.rm(target, { recursive: true, force: true });
    } else if (targetWasEmpty) {
      await fs.rm(target, { recursive: true, force: true });
      await fs.mkdir(target, { recursive: true });
    }
  } catch {
    // Best effort cleanup; the caller still reports the clone failure.
  }
}

export async function removeLocalClone(
  root: string,
  t: Translator = translate
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await fs.rm(remoteRepoPath(root), { recursive: true, force: true });
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: t('Unable to delete .ideahub/remote: {0}', describeError(error))
    };
  }
}
