import { promises as fs } from 'node:fs';
import { describeError, readConfig, remoteRepoPath, writeConfig, type RemoteConfig } from './config';
import { hasHeadCommit, isGitRepository, runGit } from './git';
import { parseRemoteUrl } from './remote-url';

export type CloneResult =
  | { ok: true; branch: string }
  | { ok: false; error: string; detail?: string };

export const REMOTE_PATH_NOT_DIRECTORY_ERROR =
  '.ideahub/remote 已存在且不是目录，请先手动处理后再重试。';

export const REMOTE_DIR_NON_EMPTY_ERROR =
  '.ideahub/remote 目录已存在且非空。为避免覆盖已有内容，已停止克隆；如需重新克隆，请使用“重新克隆”操作。';

export const INNER_REPO_NO_HEAD_ERROR =
  '内层仓库为空、不完整或克隆未完成（没有可用的 HEAD）。请先使用“重新克隆”重新获取远程创意仓库，然后再重试。';

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
export async function verifyClonedRepository(target: string): Promise<RepositoryReadyResult> {
  if (!(await isGitRepository(target))) {
    return {
      ok: false,
      error: INNER_REPO_NO_HEAD_ERROR,
      detail: 'git rev-parse --git-dir failed'
    };
  }
  const head = await runGit(target, ['rev-parse', '--verify', 'HEAD']);
  if (head.code !== 0 || head.stdout.trim().length === 0) {
    return {
      ok: false,
      error: INNER_REPO_NO_HEAD_ERROR,
      detail: head.stderr.trim() || head.stdout.trim() || 'git rev-parse --verify HEAD failed'
    };
  }
  return { ok: true };
}

export type RemoteTargetInspection =
  | { kind: 'missing' }
  | { kind: 'valid-repo' }
  | { kind: 'blocked'; reason: string };

export async function inspectRemoteTarget(root: string): Promise<RemoteTargetInspection> {
  const target = remoteRepoPath(root);
  let stat;
  try {
    stat = await fs.stat(target);
  } catch {
    return { kind: 'missing' };
  }
  if (!stat.isDirectory()) {
    return { kind: 'blocked', reason: REMOTE_PATH_NOT_DIRECTORY_ERROR };
  }
  if (await isGitRepository(target)) {
    if (await hasHeadCommit(target)) {
      return { kind: 'valid-repo' };
    }
    return { kind: 'blocked', reason: INNER_REPO_NO_HEAD_ERROR };
  }
  try {
    const entries = await fs.readdir(target);
    return entries.length === 0
      ? { kind: 'missing' }
      : { kind: 'blocked', reason: REMOTE_DIR_NON_EMPTY_ERROR };
  } catch (error) {
    return {
      kind: 'blocked',
      reason: `无法读取 .ideahub/remote：${describeError(error)}`
    };
  }
}

export function describeCloneFailure(output: string): string {
  const text = output.trim();
  if (!text) {
    return '克隆远程创意仓库失败：git 未返回错误信息。';
  }
  if (
    /Authentication failed|could not read Username|could not read Password|terminal prompts disabled|Permission denied|403|access denied/i.test(
      text
    )
  ) {
    return `克隆远程创意仓库失败：认证失败，无法用当前凭据访问远程仓库。请确认已登录 GitHub 且拥有写入权限。\n原始信息：${text}`;
  }
  if (/Repository not found|repository .* does not exist/i.test(text)) {
    return `克隆远程创意仓库失败：仓库不存在，或当前账号无权访问。\n原始信息：${text}`;
  }
  if (
    /Could not resolve host|unable to access|Connection (timed out|refused|reset)|Network is unreachable|SSL|TLS|proxy|RPC failed/i.test(
      text
    )
  ) {
    return `克隆远程创意仓库失败：网络错误，无法连接到远程仓库。请检查网络或代理设置。\n原始信息：${text}`;
  }
  return `克隆远程创意仓库失败：${text}`;
}

export function buildCloneArgs(url: string, branch: string, target: string): string[] {
  return ['clone', '--depth', '1', '--branch', branch, url, target];
}

export async function cloneRemoteRepository(
  root: string,
  remote: RemoteConfig
): Promise<CloneResult> {
  const parsed = parseRemoteUrl(remote.url);
  if (!parsed.ok) {
    return { ok: false, error: parsed.error };
  }
  if (remote.branch.trim().length === 0) {
    return {
      ok: false,
      error: '远程分支为空，无法克隆。请先保存远程仓库配置（留空会自动使用远程默认分支）。'
    };
  }

  const target = remoteRepoPath(root);
  let targetExists = false;
  let targetWasEmpty = false;
  try {
    const stat = await fs.stat(target);
    if (!stat.isDirectory()) {
      return { ok: false, error: REMOTE_PATH_NOT_DIRECTORY_ERROR };
    }
    targetExists = true;
    targetWasEmpty = (await fs.readdir(target)).length === 0;
  } catch {
    targetExists = false;
  }

  if (targetExists && !targetWasEmpty) {
    return { ok: false, error: REMOTE_DIR_NON_EMPTY_ERROR };
  }

  const result = await runGit(root, buildCloneArgs(remote.url, remote.branch, target), {
    timeoutMs: 300_000
  });

  if (result.code !== 0) {
    await cleanupFailedClone(target, targetExists, targetWasEmpty);
    return {
      ok: false,
      error: describeCloneFailure(result.stderr.trim() || result.stdout.trim()),
      detail: result.stderr.trim() || result.stdout.trim()
    };
  }

  const verified = await verifyClonedRepository(target);
  if (!verified.ok) {
    await cleanupFailedClone(target, targetExists, targetWasEmpty);
    return {
      ok: false,
      error: verified.error ?? INNER_REPO_NO_HEAD_ERROR,
      detail: verified.detail
    };
  }

  const branchResult = await runGit(target, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const branch = branchResult.stdout.trim();
  if (branchResult.code !== 0 || branch.length === 0 || branch === 'HEAD') {
    return {
      ok: false,
      error: INNER_REPO_NO_HEAD_ERROR,
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

export async function removeLocalClone(root: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await fs.rm(remoteRepoPath(root), { recursive: true, force: true });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: `无法删除 .ideahub/remote：${describeError(error)}` };
  }
}
