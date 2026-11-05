import { promises as fs } from 'node:fs';
import { describeError, readConfig, remoteRepoPath, writeConfig, type RemoteConfig } from './config';
import { isGitRepository, runGit } from './git';
import { parseRemoteUrl } from './remote-url';

export type CloneResult =
  | { ok: true; branch: string }
  | { ok: false; error: string };

export async function cloneRemoteRepository(
  root: string,
  remote: RemoteConfig
): Promise<CloneResult> {
  const parsed = parseRemoteUrl(remote.url);
  if (!parsed.ok) {
    return { ok: false, error: parsed.error };
  }

  const target = remoteRepoPath(root);
  let targetExists = false;
  let targetWasEmpty = false;
  try {
    const stat = await fs.stat(target);
    if (!stat.isDirectory()) {
      return {
        ok: false,
        error: '.ideahub/remote 已存在且不是目录，请先手动处理后再重试。'
      };
    }
    targetExists = true;
    targetWasEmpty = (await fs.readdir(target)).length === 0;
  } catch {
    targetExists = false;
  }

  if (targetExists && !targetWasEmpty) {
    return {
      ok: false,
      error:
        '.ideahub/remote 目录已存在且非空。为避免覆盖已有内容，已停止克隆；如需重新克隆，请使用“重新克隆”操作。'
    };
  }

  const result = await runGit(root, ['clone', remote.url, target], {
    timeoutMs: 300_000
  });

  if (result.code !== 0) {
    try {
      if (!targetExists) {
        await fs.rm(target, { recursive: true, force: true });
      } else if (targetWasEmpty) {
        await fs.rm(target, { recursive: true, force: true });
        await fs.mkdir(target, { recursive: true });
      }
    } catch {
      // Best effort cleanup; the error below still reports the clone failure.
    }
    return {
      ok: false,
      error: `克隆远程创意仓库失败：${result.stderr.trim() || result.stdout.trim()}`
    };
  }

  if (!(await isGitRepository(target))) {
    return { ok: false, error: '克隆完成，但 .ideahub/remote/.git 无效。' };
  }

  const branchResult = await runGit(target, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const branch = branchResult.stdout.trim() || remote.branch;

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

export async function removeLocalClone(root: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await fs.rm(remoteRepoPath(root), { recursive: true, force: true });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: `无法删除 .ideahub/remote：${describeError(error)}` };
  }
}
