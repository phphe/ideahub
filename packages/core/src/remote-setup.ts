import type { GitHubClient } from './github';
import { translate, type Translator } from './i18n';
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
  branchInput: string = '',
  t: Translator = translate
): Promise<ValidateRemoteResult> {
  const parsed = parseRemoteUrl(url, t);
  if (!parsed.ok) {
    return parsed;
  }

  let repo;
  try {
    repo = await client.getRepository(parsed.value.owner, parsed.value.repo);
  } catch (error) {
    return {
      ok: false,
      error: t(
        'Unable to access the remote repository: {0}',
        error instanceof Error ? error.message : String(error)
      )
    };
  }

  if (!repo) {
    return {
      ok: false,
      error: t('The repository does not exist, or the current GitHub account cannot access it.')
    };
  }
  if (repo.isPrivate) {
    return { ok: false, error: t('The remote idea repository must be public.') };
  }
  if (!repo.canPush) {
    return {
      ok: false,
      error: t(
        'The current GitHub account does not have write access to this repository. Make sure you are the owner or a collaborator.'
      )
    };
  }

  const requested = branchInput.trim();
  let branch: string;
  if (requested.length > 0) {
    const branchError = validateBranchName(requested, t);
    if (branchError) {
      return { ok: false, error: t('Invalid branch name: {0}', branchError) };
    }
    let head;
    try {
      head = await client.getBranchHead(parsed.value.owner, parsed.value.repo, requested);
    } catch (error) {
      return {
        ok: false,
        error: t(
          'Unable to read the remote branch "{0}": {1}',
          requested,
          error instanceof Error ? error.message : String(error)
        )
      };
    }
    if (!head) {
      return {
        ok: false,
        error: t(
          'The branch "{0}" does not exist in the remote repository. Check the branch name, or create and push the branch on GitHub first.',
          requested
        )
      };
    }
    branch = requested;
  } else {
    branch = repo.defaultBranch.trim();
    if (branch.length === 0) {
      return {
        ok: false,
        error: t(
          'Unable to read the remote repository default branch. Enter a branch name manually and retry.'
        )
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
