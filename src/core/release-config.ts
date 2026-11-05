import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { describeError, isNotFound, isObject } from './config';
import { validateBranchName } from './release-target';

export const RELEASE_CONFIG_FILE = 'ideahub.config.json';
export const DEFAULT_RELEASE_BRANCH = 'main';
export const RELEASE_BRANCH_ENV_KEY = 'IDEAHUB_RELEASE_BRANCH';

export type ReleaseBranchSource = 'env' | 'file' | 'default';

export interface ReleaseBranchConfig {
  branch: string;
  source: ReleaseBranchSource;
  warnings: string[];
}

export function releaseConfigPath(root: string): string {
  return path.join(root, RELEASE_CONFIG_FILE);
}

export function defaultReleaseConfigContent(): string {
  return `${JSON.stringify({ releaseBranch: DEFAULT_RELEASE_BRANCH }, null, 2)}\n`;
}

async function readEnvValue(root: string, key: string): Promise<string | null> {
  let raw: string;
  try {
    raw = await fs.readFile(path.join(root, '.env'), 'utf8');
  } catch (error) {
    if (isNotFound(error)) {
      return null;
    }
    throw error;
  }

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) {
      continue;
    }
    const separator = trimmed.indexOf('=');
    if (separator <= 0) {
      continue;
    }
    const name = trimmed.slice(0, separator).trim();
    if (name !== key) {
      continue;
    }
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    return value;
  }
  return null;
}

/**
 * Reads `releaseBranch` with priority: `.env` > `ideahub.config.json` > `main`.
 * Invalid values never throw; they produce a readable warning and fall back.
 */
export async function loadReleaseBranch(root: string): Promise<ReleaseBranchConfig> {
  const warnings: string[] = [];

  let envValue: string | null = null;
  try {
    envValue = await readEnvValue(root, RELEASE_BRANCH_ENV_KEY);
  } catch (error) {
    warnings.push(`无法读取 .env：${describeError(error)}，已忽略该来源。`);
  }
  if (envValue !== null) {
    const branch = envValue.trim();
    if (branch.length === 0) {
      warnings.push(`.env 中的 ${RELEASE_BRANCH_ENV_KEY} 为空，已忽略该来源。`);
    } else {
      const error = validateBranchName(branch);
      if (!error) {
        return { branch, source: 'env', warnings };
      }
      warnings.push(`.env 中的 ${RELEASE_BRANCH_ENV_KEY} 无效：${error}`);
    }
  }

  let raw: string;
  try {
    raw = await fs.readFile(releaseConfigPath(root), 'utf8');
  } catch (error) {
    if (isNotFound(error)) {
      warnings.push(
        `未找到 ${RELEASE_CONFIG_FILE}，使用默认 releaseBranch=${DEFAULT_RELEASE_BRANCH}。`
      );
      return { branch: DEFAULT_RELEASE_BRANCH, source: 'default', warnings };
    }
    warnings.push(
      `无法读取 ${RELEASE_CONFIG_FILE}：${describeError(error)}，使用默认 releaseBranch=${DEFAULT_RELEASE_BRANCH}。`
    );
    return { branch: DEFAULT_RELEASE_BRANCH, source: 'default', warnings };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    warnings.push(
      `${RELEASE_CONFIG_FILE} 不是有效的 JSON，使用默认 releaseBranch=${DEFAULT_RELEASE_BRANCH}。`
    );
    return { branch: DEFAULT_RELEASE_BRANCH, source: 'default', warnings };
  }
  if (!isObject(parsed)) {
    warnings.push(
      `${RELEASE_CONFIG_FILE} 顶层必须是对象，使用默认 releaseBranch=${DEFAULT_RELEASE_BRANCH}。`
    );
    return { branch: DEFAULT_RELEASE_BRANCH, source: 'default', warnings };
  }

  const value = parsed.releaseBranch;
  if (value === undefined || value === null) {
    warnings.push(
      `${RELEASE_CONFIG_FILE} 缺少 releaseBranch，使用默认 releaseBranch=${DEFAULT_RELEASE_BRANCH}。`
    );
    return { branch: DEFAULT_RELEASE_BRANCH, source: 'default', warnings };
  }
  if (typeof value !== 'string') {
    warnings.push(
      `${RELEASE_CONFIG_FILE} 的 releaseBranch 必须是字符串，使用默认 releaseBranch=${DEFAULT_RELEASE_BRANCH}。`
    );
    return { branch: DEFAULT_RELEASE_BRANCH, source: 'default', warnings };
  }

  const branch = value.trim();
  const error = validateBranchName(branch);
  if (error) {
    warnings.push(
      `${RELEASE_CONFIG_FILE} 的 releaseBranch 无效：${error} 使用默认 releaseBranch=${DEFAULT_RELEASE_BRANCH}。`
    );
    return { branch: DEFAULT_RELEASE_BRANCH, source: 'default', warnings };
  }

  return { branch, source: 'file', warnings };
}
