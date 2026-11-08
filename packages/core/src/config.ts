import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { parseRemoteUrl } from './remote-url';

export interface RemoteConfig {
  provider: 'github';
  owner: string;
  repo: string;
  url: string;
  branch: string;
}

export interface IdeahubConfig {
  version: 1;
  remote?: RemoteConfig;
}

export type ReadConfigResult =
  | { ok: true; config: IdeahubConfig }
  | { ok: false; error: string };

export function ideahubDir(root: string): string {
  return path.join(root, '.ideahub');
}

export function configPath(root: string): string {
  return path.join(root, '.ideahub', 'config.json');
}

export function configGitignorePath(root: string): string {
  return path.join(root, '.ideahub', '.gitignore');
}

export function remoteRepoPath(root: string): string {
  return path.join(root, '.ideahub', 'remote');
}

export async function readConfig(root: string): Promise<ReadConfigResult> {
  let raw: string;
  try {
    raw = await fs.readFile(configPath(root), 'utf8');
  } catch (error) {
    if (isNotFound(error)) {
      return { ok: false, error: '缺少 .ideahub/config.json 配置文件。' };
    }
    return { ok: false, error: `无法读取 .ideahub/config.json：${describeError(error)}` };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: '.ideahub/config.json 不是有效的 JSON，请修正或重新填写。' };
  }

  if (!isObject(parsed)) {
    return { ok: false, error: '.ideahub/config.json 顶层必须是对象。' };
  }
  if (parsed.version !== 1) {
    return { ok: false, error: '不支持的 config.json 版本（应为 version: 1）。' };
  }

  const remote = parsed.remote;
  if (remote === undefined || remote === null) {
    return { ok: true, config: { version: 1 } };
  }
  if (!isObject(remote)) {
    return { ok: false, error: 'config.json 中的 remote 字段必须是对象。' };
  }

  const owner = typeof remote.owner === 'string' ? remote.owner.trim() : '';
  const repo = typeof remote.repo === 'string' ? remote.repo.trim() : '';
  const url = typeof remote.url === 'string' ? remote.url.trim() : '';
  const branch = typeof remote.branch === 'string' ? remote.branch.trim() : '';

  if (!owner || !repo || !url) {
    return {
      ok: false,
      error: 'config.json 的 remote 字段缺少 owner、repo 或 url。'
    };
  }
  const parsedUrl = parseRemoteUrl(url);
  if (!parsedUrl.ok) {
    return { ok: false, error: `config.json 中的远程地址无效：${parsedUrl.error}` };
  }
  if (
    parsedUrl.value.owner.toLowerCase() !== owner.toLowerCase() ||
    parsedUrl.value.repo.toLowerCase() !== repo.toLowerCase()
  ) {
    return { ok: false, error: 'config.json 中 owner/repo 与 url 不一致。' };
  }
  if (!branch) {
    return { ok: false, error: 'config.json 的 remote 字段缺少 branch。' };
  }
  if (remote.provider !== undefined && remote.provider !== 'github') {
    return { ok: false, error: 'config.json 仅支持 provider: "github"。' };
  }

  return {
    ok: true,
    config: {
      version: 1,
      remote: {
        provider: 'github',
        owner,
        repo,
        url,
        branch
      }
    }
  };
}

export async function writeConfig(root: string, config: IdeahubConfig): Promise<void> {
  await fs.mkdir(ideahubDir(root), { recursive: true });
  const body = `${JSON.stringify(config, null, 2)}\n`;
  await fs.writeFile(configPath(root), body, 'utf8');
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}

export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
