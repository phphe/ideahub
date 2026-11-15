import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { isShallowRepository, redactSecrets, runGit, unshallowRepository } from './git';
import { translate, type Translator } from './i18n';
import { parseRemoteUrl } from './remote-url';
import { validateBranchName } from './release-target';

export const RELEASE_BRANCH_FILE = 'empty';
export const RELEASE_BRANCH_COMMIT_MESSAGE = 'ideahub: create release branch';

export type EnsureReleaseBranchResult =
  | { ok: true; commit: string }
  | { ok: false; error: string };

/**
 * Sections 5.5 / 8.9: create the missing release branch with a single empty
 * file and push only that branch. This is the only automatic push to the
 * user's public repository and never carries creative content.
 */
export async function ensureReleaseBranchExists(
  innerPath: string,
  url: string,
  branch: string,
  token: string,
  t: Translator = translate
): Promise<EnsureReleaseBranchResult> {
  const branchError = validateBranchName(branch, t);
  if (branchError) {
    return { ok: false, error: branchError };
  }
  const parsed = parseRemoteUrl(url, t);
  if (!parsed.ok) {
    return { ok: false, error: parsed.error };
  }

  // Section 8.5: the inner repository is shallow; complete the history before
  // the first push so the remote never rejects it with
  // `shallow update not allowed`.
  if (await isShallowRepository(innerPath)) {
    const unshallow = await unshallowRepository(innerPath);
    if (unshallow.code !== 0) {
      return {
        ok: false,
        error: t(
          'Unable to complete the Git history: {0}',
          unshallow.stderr.trim() || unshallow.stdout.trim()
        )
      };
    }
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ideahub-release-'));
  const tempIndex = path.join(tempDir, 'index');
  const emptyFile = path.join(tempDir, RELEASE_BRANCH_FILE);
  const indexEnv = { GIT_INDEX_FILE: tempIndex };
  try {
    await fs.writeFile(emptyFile, '', 'utf8');

    const blob = await runGit(innerPath, ['hash-object', '-w', '-t', 'blob', emptyFile]);
    if (blob.code !== 0) {
      return {
        ok: false,
        error: t('Unable to write the empty file object: {0}', blob.stderr.trim())
      };
    }
    const blobSha = blob.stdout.trim();

    const readTree = await runGit(innerPath, ['read-tree', '--empty'], { env: indexEnv });
    if (readTree.code !== 0) {
      return {
        ok: false,
        error: t('Unable to initialize the temporary index: {0}', readTree.stderr.trim())
      };
    }

    const updateIndex = await runGit(
      innerPath,
      ['update-index', '--add', '--cacheinfo', `100644,${blobSha},${RELEASE_BRANCH_FILE}`],
      { env: indexEnv }
    );
    if (updateIndex.code !== 0) {
      return {
        ok: false,
        error: t('Unable to write the temporary index: {0}', updateIndex.stderr.trim())
      };
    }

    const writeTree = await runGit(innerPath, ['write-tree'], { env: indexEnv });
    if (writeTree.code !== 0) {
      return {
        ok: false,
        error: t('Unable to generate the release branch tree: {0}', writeTree.stderr.trim())
      };
    }

    const treeSha = writeTree.stdout.trim();
    const commit = await runGit(
      innerPath,
      [
        '-c',
        'user.name=IdeaHub',
        '-c',
        'user.email=ideahub@users.noreply.github.com',
        'commit-tree',
        treeSha,
        '-m',
        RELEASE_BRANCH_COMMIT_MESSAGE
      ]
    );
    if (commit.code !== 0) {
      return {
        ok: false,
        error: t(
          'Unable to create the release branch commit: {0}',
          commit.stderr.trim() || commit.stdout.trim()
        )
      };
    }
    const commitSha = commit.stdout.trim();

    const credentials = Buffer.from(`x-access-token:${token}`, 'utf8').toString('base64');
    const push = await runGit(
      innerPath,
      [
        '-c',
        `http.extraheader=AUTHORIZATION: basic ${credentials}`,
        'push',
        parsed.value.cloneUrl,
        `${commitSha}:refs/heads/${branch}`
      ],
      { timeoutMs: 300_000 }
    );
    if (push.code !== 0) {
      const detail = redactSecrets(push.stderr.trim() || push.stdout.trim(), [
        credentials,
        token
      ]);
      return { ok: false, error: t('Failed to push the release branch: {0}', detail) };
    }

    return { ok: true, commit: commitSha };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
