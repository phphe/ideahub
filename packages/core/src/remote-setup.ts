import type { GitHubClient } from './github';
import type { ImmutabilityCheck } from './immutability';
import { parseRemoteUrl } from './remote-url';
import type { RemoteConfig } from './config';
import { validateBranchName } from './release-target';

export type ValidateRemoteResult =
  | { ok: true; remote: RemoteConfig; immutability: ImmutabilityCheck }
  | { ok: false; error: string };

/**
 * Section 6.3 / 8.4: the branch input is optional. When empty the repository's
 * `default_branch` is used and written back to config; when filled in it must
 * exist on the remote, otherwise the user gets an actionable error and the
 * default branch is never substituted silently.
 */
export async function validateRemoteRepository(
  url: string,
  client: GitHubClient,
  branchInput: string = ''
): Promise<ValidateRemoteResult> {
  const parsed = parseRemoteUrl(url);
  if (!parsed.ok) {
    return parsed;
  }

  let repo;
  try {
    repo = await client.getRepository(parsed.value.owner, parsed.value.repo);
  } catch (error) {
    return {
      ok: false,
      error: `无法访问远程仓库：${error instanceof Error ? error.message : String(error)}`
    };
  }

  if (!repo) {
    return { ok: false, error: '仓库不存在，或当前 GitHub 账号没有访问权限。' };
  }
  if (repo.isPrivate) {
    return { ok: false, error: '远程创意仓库必须是公开仓库。' };
  }
  if (!repo.canPush) {
    return {
      ok: false,
      error: '当前 GitHub 账号对该仓库没有写入权限，请确认你是仓库的所有者或协作者。'
    };
  }

  const requested = branchInput.trim();
  let branch: string;
  if (requested.length > 0) {
    const branchError = validateBranchName(requested);
    if (branchError) {
      return { ok: false, error: `分支名无效：${branchError}` };
    }
    let head;
    try {
      head = await client.getBranchHead(parsed.value.owner, parsed.value.repo, requested);
    } catch (error) {
      return {
        ok: false,
        error: `无法读取远程分支“${requested}”：${
          error instanceof Error ? error.message : String(error)
        }`
      };
    }
    if (!head) {
      return {
        ok: false,
        error: `远程仓库中不存在分支“${requested}”。请检查分支名，或先在 GitHub 上创建并推送该分支后再试。`
      };
    }
    branch = requested;
  } else {
    branch = repo.defaultBranch.trim();
    if (branch.length === 0) {
      return {
        ok: false,
        error: '无法读取远程仓库的默认分支，请手动填写分支名后重试。'
      };
    }
  }

  const immutability = await client.getImmutableReleasesStatus(
    parsed.value.owner,
    parsed.value.repo,
    parsed.value.host
  );

  return {
    ok: true,
    remote: {
      provider: 'github',
      owner: parsed.value.owner,
      repo: parsed.value.repo,
      url: url.trim(),
      branch
    },
    immutability
  };
}
