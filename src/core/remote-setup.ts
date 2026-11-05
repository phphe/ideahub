import type { GitHubClient } from './github';
import { parseRemoteUrl } from './remote-url';
import type { RemoteConfig } from './config';

export type ValidateRemoteResult =
  | { ok: true; remote: RemoteConfig }
  | { ok: false; error: string };

export async function validateRemoteRepository(
  url: string,
  client: GitHubClient
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

  return {
    ok: true,
    remote: {
      provider: 'github',
      owner: parsed.value.owner,
      repo: parsed.value.repo,
      url: parsed.value.canonicalUrl,
      branch: repo.defaultBranch
    }
  };
}
