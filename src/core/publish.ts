import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { describeError } from './config';
import { redactSecrets, runGit } from './git';
import { parseRemoteUrl } from './remote-url';

export interface ProjectScan {
  files: string[];
  blocked: string[];
}

export async function scanProjectDirectory(projectDir: string): Promise<ProjectScan> {
  const files: string[] = [];
  const blocked: string[] = [];

  async function walk(directory: string, prefix: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      blocked.push(`${prefix || '.'}（无法读取：${describeError(error)}）`);
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) {
        blocked.push(`${relative}（符号链接）`);
        continue;
      }
      if (entry.isDirectory()) {
        if (entry.name === '.git') {
          blocked.push(`${relative}（嵌套 Git 仓库）`);
          continue;
        }
        await walk(path.join(directory, entry.name), relative);
        continue;
      }
      if (entry.isFile()) {
        files.push(relative);
        continue;
      }
      blocked.push(`${relative}（特殊文件）`);
    }
  }

  await walk(projectDir, '');
  return { files, blocked };
}

export async function syncInnerRepository(
  remotePath: string,
  branch: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const status = await runGit(remotePath, ['status', '--porcelain']);
  if (status.code !== 0) {
    return { ok: false, error: `无法读取内层仓库状态：${status.stderr.trim()}` };
  }
  if (status.stdout.trim().length > 0) {
    return {
      ok: false,
      error: '内层仓库存在未提交的变更或冲突。请先手动处理 .ideahub/remote/ 后再发布。'
    };
  }

  const fetch = await runGit(remotePath, ['fetch', 'origin'], { timeoutMs: 300_000 });
  if (fetch.code !== 0) {
    return {
      ok: false,
      error: `拉取远程创意仓库失败：${fetch.stderr.trim() || fetch.stdout.trim()}`
    };
  }

  const current = await runGit(remotePath, ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (current.code !== 0) {
    return { ok: false, error: `无法确定内层仓库当前分支：${current.stderr.trim()}` };
  }
  if (current.stdout.trim() !== branch) {
    const checkout = await runGit(remotePath, ['checkout', branch]);
    if (checkout.code !== 0) {
      return {
        ok: false,
        error: `切换到远程主要分支失败：${checkout.stderr.trim() || checkout.stdout.trim()}`
      };
    }
  }

  const merge = await runGit(remotePath, ['merge', '--ff-only', `origin/${branch}`]);
  if (merge.code !== 0) {
    return {
      ok: false,
      error:
        '内层仓库无法与远程分支快进同步，可能存在冲突或分支保护。请先手动处理，扩展不会强制覆盖。'
    };
  }
  return { ok: true };
}

export async function copyProjectIntoInnerRepository(
  remotePath: string,
  projectName: string,
  sourceDir: string
): Promise<{ ok: true; target: string } | { ok: false; error: string }> {
  const target = path.join(remotePath, projectName);
  try {
    let targetExists = false;
    try {
      const stat = await fs.lstat(target);
      targetExists = true;
      if (stat.isSymbolicLink()) {
        await fs.unlink(target);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
    if (targetExists && !(await isSymlink(target))) {
      await fs.rm(target, { recursive: true, force: true });
    }
    await fs.cp(sourceDir, target, { recursive: true, errorOnExist: false });
    return { ok: true, target };
  } catch (error) {
    return { ok: false, error: `复制项目到内层仓库失败：${describeError(error)}` };
  }
}

async function isSymlink(target: string): Promise<boolean> {
  try {
    return (await fs.lstat(target)).isSymbolicLink();
  } catch {
    return false;
  }
}

export async function commitAndPushInnerRepository(
  remotePath: string,
  params: {
    url: string;
    branch: string;
    projectName: string;
    token: string;
  }
): Promise<{ ok: true; pushed: boolean } | { ok: false; error: string }> {
  const parsed = parseRemoteUrl(params.url);
  if (!parsed.ok) {
    return { ok: false, error: parsed.error };
  }

  const add = await runGit(remotePath, ['add', '-A']);
  if (add.code !== 0) {
    return { ok: false, error: `暂存变更失败：${add.stderr.trim()}` };
  }

  const staged = await runGit(remotePath, ['diff', '--cached', '--name-only']);
  if (staged.code !== 0) {
    return { ok: false, error: `检查暂存变更失败：${staged.stderr.trim()}` };
  }
  const hasStagedChanges = staged.stdout.trim().length > 0;
  if (hasStagedChanges) {
    const commit = await runGit(remotePath, [
      'commit',
      '-m',
      `Publish project: ${params.projectName}`
    ]);
    if (commit.code !== 0) {
      return {
        ok: false,
        error: `提交内层仓库失败：${commit.stderr.trim() || commit.stdout.trim()}`
      };
    }
  }

  const ahead = await runGit(remotePath, ['rev-list', '--count', `origin/${params.branch}..HEAD`]);
  const aheadCount = ahead.code === 0 ? Number.parseInt(ahead.stdout.trim(), 10) || 0 : 1;
  if (aheadCount === 0) {
    return { ok: true, pushed: false };
  }

  const credentials = Buffer.from(`x-access-token:${params.token}`, 'utf8').toString('base64');
  const push = await runGit(
    remotePath,
    [
      '-c',
      `http.extraheader=AUTHORIZATION: basic ${credentials}`,
      'push',
      parsed.value.cloneUrl,
      `HEAD:${params.branch}`
    ],
    { timeoutMs: 300_000 }
  );
  if (push.code !== 0) {
    const detail = redactSecrets(push.stderr.trim() || push.stdout.trim(), [
      credentials,
      params.token
    ]);
    return {
      ok: false,
      error: `推送内层仓库失败（本地提交已产生，远程尚未更新）：${detail}`
    };
  }

  return { ok: true, pushed: true };
}

export function remoteProjectUrl(
  owner: string,
  repo: string,
  branch: string,
  projectName: string
): string {
  return `https://github.com/${owner}/${repo}/tree/${encodeURIComponent(branch)}/${encodeURIComponent(
    projectName
  )}`;
}
