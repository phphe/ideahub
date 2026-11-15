import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { INNER_REPO_NO_HEAD_ERROR, verifyClonedRepository } from './clone';
import { describeError } from './config';
import { isShallowRepository, redactSecrets, runGit, unshallowRepository } from './git';
import { translate, type Translator } from './i18n';
import { parseRemoteUrl } from './remote-url';

export type InnerRepositoryHeadCheck =
  | { ok: true }
  | { ok: false; error: string; detail: string };

/**
 * Section 8.10 preflight: an inner repository can exist but have no usable
 * HEAD (empty clone, interrupted clone). Publishing must stop with an
 * actionable message instead of leaking `fatal: ambiguous argument 'HEAD'`.
 */
export async function checkInnerRepositoryHead(
  remotePath: string,
  t: Translator = translate
): Promise<InnerRepositoryHeadCheck> {
  const verified = await verifyClonedRepository(remotePath, t);
  if (verified.ok) {
    return { ok: true };
  }
  return {
    ok: false,
    error: verified.error ?? t(INNER_REPO_NO_HEAD_ERROR),
    detail: verified.detail ?? 'git rev-parse --verify HEAD failed'
  };
}

export interface ProjectScan {
  files: string[];
  blocked: string[];
}

export async function scanProjectDirectory(
  projectDir: string,
  t: Translator = translate
): Promise<ProjectScan> {
  const files: string[] = [];
  const blocked: string[] = [];

  async function walk(directory: string, prefix: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      blocked.push(
        t('{0} (unreadable: {1})', prefix || '.', describeError(error))
      );
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) {
        blocked.push(t('{0} (symbolic link)', relative));
        continue;
      }
      if (entry.isDirectory()) {
        if (entry.name === '.git') {
          blocked.push(t('{0} (nested Git repository)', relative));
          continue;
        }
        await walk(path.join(directory, entry.name), relative);
        continue;
      }
      if (entry.isFile()) {
        files.push(relative);
        continue;
      }
      blocked.push(t('{0} (special file)', relative));
    }
  }

  await walk(projectDir, '');
  return { files, blocked };
}

export async function syncInnerRepository(
  remotePath: string,
  branch: string,
  t: Translator = translate
): Promise<{ ok: true } | { ok: false; error: string; detail?: string }> {
  const readiness = await checkInnerRepositoryHead(remotePath, t);
  if (!readiness.ok) {
    return readiness;
  }

  const status = await runGit(remotePath, ['status', '--porcelain']);
  if (status.code !== 0) {
    return {
      ok: false,
      error: t('Unable to read the inner repository status: {0}', status.stderr.trim())
    };
  }
  if (status.stdout.trim().length > 0) {
    return {
      ok: false,
      error: t(
        'The inner repository has uncommitted changes or conflicts. Handle .ideahub/remote/ manually before publishing.'
      )
    };
  }

  const fetch = await runGit(remotePath, ['fetch', 'origin'], { timeoutMs: 300_000 });
  if (fetch.code !== 0) {
    return {
      ok: false,
      error: t(
        'Failed to fetch the remote idea repository: {0}',
        fetch.stderr.trim() || fetch.stdout.trim()
      )
    };
  }

  const current = await runGit(remotePath, ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (current.code !== 0) {
    return {
      ok: false,
      error: t(INNER_REPO_NO_HEAD_ERROR),
      detail: current.stderr.trim() || current.stdout.trim()
    };
  }
  if (current.stdout.trim() !== branch) {
    const checkout = await runGit(remotePath, ['checkout', branch]);
    if (checkout.code !== 0) {
      return {
        ok: false,
        error: t(
          'Failed to switch to the remote main branch: {0}',
          checkout.stderr.trim() || checkout.stdout.trim()
        )
      };
    }
  }

  const merge = await runGit(remotePath, ['merge', '--ff-only', `origin/${branch}`]);
  if (merge.code !== 0) {
    return {
      ok: false,
      error: t(
        'The inner repository cannot fast-forward to the remote branch; there may be conflicts or branch protection. Handle it manually; the extension never force-overwrites.'
      )
    };
  }
  return { ok: true };
}

/**
 * Section 8.10 / 7.8: copy the project for publishing without `ideas.md`;
 * the generated proof file is written as `README.md` (overwriting any
 * existing one, deliberately and silently).
 */
export async function copyProjectIntoInnerRepository(
  remotePath: string,
  projectName: string,
  sourceDir: string,
  proofFile: string,
  t: Translator = translate
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
    await fs.cp(sourceDir, target, {
      recursive: true,
      errorOnExist: false,
      filter: (source) =>
        !(path.dirname(source) === sourceDir && path.basename(source) === 'ideas.md')
    });
    await fs.writeFile(path.join(target, 'README.md'), proofFile, 'utf8');
    return { ok: true, target };
  } catch (error) {
    return {
      ok: false,
      error: t('Failed to copy the project into the inner repository: {0}', describeError(error))
    };
  }
}

async function isSymlink(target: string): Promise<boolean> {
  try {
    return (await fs.lstat(target)).isSymbolicLink();
  } catch {
    return false;
  }
}

export type InnerRepositoryHead =
  | { ok: true; head: string }
  | { ok: false; error: string; detail: string };

export async function readInnerRepositoryHead(
  remotePath: string,
  t: Translator = translate
): Promise<InnerRepositoryHead> {
  const head = await runGit(remotePath, ['rev-parse', '--verify', 'HEAD']);
  if (head.code !== 0 || head.stdout.trim().length === 0) {
    return {
      ok: false,
      error: t(INNER_REPO_NO_HEAD_ERROR),
      detail: head.stderr.trim() || head.stdout.trim()
    };
  }
  return { ok: true, head: head.stdout.trim() };
}

/**
 * Restores the inner repository after a failed publish. Only tracked changes
 * are reset and only untracked files under the published project are removed;
 * `.git`, ignored files and other user content are left alone.
 */
export async function restoreInnerRepository(
  remotePath: string,
  head: string,
  projectName: string,
  t: Translator = translate
): Promise<{ ok: true } | { ok: false; error: string }> {
  const reset = await runGit(remotePath, ['reset', '--hard', head]);
  if (reset.code !== 0) {
    return {
      ok: false,
      error: t(
        'Failed to reset the local remote: {0}',
        reset.stderr.trim() || reset.stdout.trim()
      )
    };
  }
  const clean = await runGit(remotePath, ['clean', '-fd', '--', projectName]);
  if (clean.code !== 0) {
    return {
      ok: false,
      error: t(
        'Failed to clean up files from this publish: {0}',
        clean.stderr.trim() || clean.stdout.trim()
      )
    };
  }
  return { ok: true };
}

export async function commitAndPushInnerRepository(
  remotePath: string,
  params: {
    url: string;
    branch: string;
    projectName: string;
    token: string;
  },
  t: Translator = translate
): Promise<
  | { ok: true; pushed: boolean }
  | { ok: false; error: string; stage: 'add' | 'commit' | 'push' }
> {
  const parsed = parseRemoteUrl(params.url, t);
  if (!parsed.ok) {
    return { ok: false, error: parsed.error, stage: 'add' };
  }

  const add = await runGit(remotePath, ['add', '-A']);
  if (add.code !== 0) {
    return {
      ok: false,
      error: t('Failed to stage changes: {0}', add.stderr.trim()),
      stage: 'add'
    };
  }

  const staged = await runGit(remotePath, ['diff', '--cached', '--name-only']);
  if (staged.code !== 0) {
    return {
      ok: false,
      error: t('Failed to inspect staged changes: {0}', staged.stderr.trim()),
      stage: 'add'
    };
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
        error: t(
          'Failed to commit the inner repository: {0}',
          commit.stderr.trim() || commit.stdout.trim()
        ),
        stage: 'commit'
      };
    }
  }

  const ahead = await runGit(remotePath, ['rev-list', '--count', `origin/${params.branch}..HEAD`]);
  const aheadCount = ahead.code === 0 ? Number.parseInt(ahead.stdout.trim(), 10) || 0 : 1;
  if (aheadCount === 0) {
    return { ok: true, pushed: false };
  }

  // Section 8.5: the inner repository is a `--depth 1` clone. Pushing from a
  // shallow clone can be rejected (`shallow update not allowed`) when the
  // remote lacks the missing history, so complete it once before pushing.
  if (await isShallowRepository(remotePath)) {
    const unshallow = await unshallowRepository(remotePath);
    if (unshallow.code !== 0) {
      return {
        ok: false,
        error: t(
          'Failed to complete the Git history: {0}',
          unshallow.stderr.trim() || unshallow.stdout.trim()
        ),
        stage: 'push'
      };
    }
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
      error: t('Failed to push the inner repository: {0}', detail),
      stage: 'push'
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
