import type { GitHubClient } from './github';

const MAX_TAG_LENGTH = 120;
const INVALID_TAG_CHARS = new Set([' ', '~', '^', ':', '?', '*', '[', '\\']);

function hasInvalidTagChar(tag: string): boolean {
  return [...tag].some((char) => {
    const code = char.charCodeAt(0);
    return code <= 0x1f || code === 0x7f || /\s/.test(char) || INVALID_TAG_CHARS.has(char);
  });
}

/**
 * Validates a bare tag name against Git's ref rules for `refs/tags/<tag>`
 * (the same checks as `git check-ref-format "refs/tags/<tag>"`).
 */
export function validateTagName(tag: string): string | null {
  if (tag.length === 0) {
    return '生成的 tag 为空，无法创建 Release。';
  }
  if (tag.length > MAX_TAG_LENGTH) {
    return `生成的 tag 超过 ${MAX_TAG_LENGTH} 个字符，无法创建 Release。`;
  }
  if (hasInvalidTagChar(tag)) {
    return '生成的 tag 含 Git 不允许的字符（空格、~ ^ : ? * [ \\ 或控制字符）。';
  }
  if (tag.startsWith('.') || tag.startsWith('/')) {
    return '生成的 tag 不能以 "." 或 "/" 开头。';
  }
  if (tag.endsWith('.') || tag.endsWith('/')) {
    return '生成的 tag 不能以 "." 或 "/" 结尾。';
  }
  if (tag.includes('..')) {
    return '生成的 tag 不能包含连续的 ".."。';
  }
  if (tag.includes('@{')) {
    return '生成的 tag 不能包含 "@{"。';
  }
  if (tag.includes('//')) {
    return '生成的 tag 不能包含连续的斜杠。';
  }
  if (tag.split('/').some((segment) => segment.endsWith('.lock'))) {
    return '生成的 tag 分段不能以 ".lock" 结尾。';
  }
  return null;
}

export interface ReleaseTagResult {
  tag: string;
  sanitized: boolean;
}

export function buildReleaseTag(hash: string): ReleaseTagResult {
  const cleaned = hash.replace(/[^0-9A-Za-z-]/g, '');
  return {
    tag: `ideahub-${cleaned}`,
    sanitized: cleaned !== hash
  };
}

export interface ReleaseTarget {
  branch: string;
  sha: string;
}

export type ReleaseTargetResult =
  | { ok: true; target: ReleaseTarget }
  | { ok: false; error: string };

type TargetClient = Pick<GitHubClient, 'getRepository' | 'getBranchHead'>;

/**
 * Resolves a target_commitish that definitely exists on the remote: the
 * repository's current default branch is checked first, with the configured
 * branch as a fallback. The commit SHA is returned so a branch deleted between
 * the check and the release request cannot produce a 422.
 */
export async function resolveReleaseTarget(
  client: TargetClient,
  owner: string,
  repo: string,
  configuredBranch: string
): Promise<ReleaseTargetResult> {
  let repository;
  try {
    repository = await client.getRepository(owner, repo);
  } catch (error) {
    return {
      ok: false,
      error: `无法读取远程仓库信息：${error instanceof Error ? error.message : String(error)}`
    };
  }
  if (!repository) {
    return { ok: false, error: '仓库不存在，或当前账号没有访问权限。' };
  }

  const candidates = [repository.defaultBranch, configuredBranch]
    .map((branch) => branch.trim())
    .filter((branch, index, all) => branch.length > 0 && all.indexOf(branch) === index);
  if (candidates.length === 0) {
    return {
      ok: false,
      error: '远程仓库没有可用的分支名；请先把至少一个提交推送到远程仓库，再生成证明。'
    };
  }

  for (const branch of candidates) {
    const head = await client.getBranchHead(owner, repo, branch);
    if (head) {
      return { ok: true, target: { branch, sha: head.sha } };
    }
  }

  return {
    ok: false,
    error: `远端分支不存在（已检查 ${candidates.join('、')}）。请先把至少一个提交推送到远程仓库，再生成证明；扩展不会自动推送。`
  };
}
