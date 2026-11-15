import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { translate, type Translator } from './i18n';
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

export async function readConfig(
  root: string,
  t: Translator = translate
): Promise<ReadConfigResult> {
  let raw: string;
  try {
    raw = await fs.readFile(configPath(root), 'utf8');
  } catch (error) {
    if (isNotFound(error)) {
      return { ok: false, error: t('The .ideahub/config.json configuration file is missing.') };
    }
    return {
      ok: false,
      error: t('Unable to read .ideahub/config.json: {0}', describeError(error))
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      ok: false,
      error: t('.ideahub/config.json is not valid JSON. Fix it or fill it in again.')
    };
  }

  if (!isObject(parsed)) {
    return { ok: false, error: t('The top level of .ideahub/config.json must be an object.') };
  }
  if (parsed.version !== 1) {
    return {
      ok: false,
      error: t('Unsupported config.json version (expected version: 1).')
    };
  }

  const remote = parsed.remote;
  if (remote === undefined || remote === null) {
    return { ok: true, config: { version: 1 } };
  }
  if (!isObject(remote)) {
    return { ok: false, error: t('The remote field in config.json must be an object.') };
  }

  const owner = typeof remote.owner === 'string' ? remote.owner.trim() : '';
  const repo = typeof remote.repo === 'string' ? remote.repo.trim() : '';
  const url = typeof remote.url === 'string' ? remote.url.trim() : '';
  const branch = typeof remote.branch === 'string' ? remote.branch.trim() : '';

  if (!owner || !repo || !url) {
    return {
      ok: false,
      error: t('The remote field in config.json is missing owner, repo, or url.')
    };
  }
  const parsedUrl = parseRemoteUrl(url, t);
  if (!parsedUrl.ok) {
    return {
      ok: false,
      error: t('Invalid remote URL in config.json: {0}', parsedUrl.error)
    };
  }
  if (
    parsedUrl.value.owner.toLowerCase() !== owner.toLowerCase() ||
    parsedUrl.value.repo.toLowerCase() !== repo.toLowerCase()
  ) {
    return { ok: false, error: t('owner/repo in config.json does not match url.') };
  }
  if (!branch) {
    return { ok: false, error: t('The remote field in config.json is missing branch.') };
  }
  if (remote.provider !== undefined && remote.provider !== 'github') {
    return { ok: false, error: t('config.json only supports provider: "github".') };
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
