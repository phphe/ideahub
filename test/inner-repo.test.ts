import { promises as fs } from 'node:fs';
import os from 'node:os';
import * as path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  INNER_REPO_NO_HEAD_ERROR,
  REMOTE_DIR_NON_EMPTY_ERROR,
  inspectRemoteTarget,
  verifyClonedRepository
} from '../src/core/clone';
import { runGit } from '../src/core/git';
import { checkInnerRepositoryHead, syncInnerRepository } from '../src/core/publish';

const roots: string[] = [];

async function makeRoot(): Promise<{ root: string; remotePath: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ideahub-inner-'));
  roots.push(root);
  await fs.mkdir(path.join(root, '.ideahub'), { recursive: true });
  return { root, remotePath: path.join(root, '.ideahub', 'remote') };
}

async function initRepository(remotePath: string): Promise<void> {
  await runGit(path.dirname(remotePath), ['init', remotePath]);
}

async function commitEmpty(remotePath: string): Promise<void> {
  const result = await runGit(remotePath, [
    '-c',
    'user.email=test@example.com',
    '-c',
    'user.name=Test',
    'commit',
    '--allow-empty',
    '-m',
    'init'
  ]);
  expect(result.code).toBe(0);
}

afterAll(async () => {
  await Promise.all(
    roots.map((root) =>
      fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    )
  );
});

describe('inner repository state', { timeout: 20000 }, () => {
  it('treats a missing or empty remote/ directory as missing', async () => {
    const { root, remotePath } = await makeRoot();
    expect(await inspectRemoteTarget(root)).toEqual({ kind: 'missing' });

    await fs.mkdir(remotePath, { recursive: true });
    expect(await inspectRemoteTarget(root)).toEqual({ kind: 'missing' });

    const check = await checkInnerRepositoryHead(remotePath);
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.error).toBe(INNER_REPO_NO_HEAD_ERROR);
    }
  });

  it('rejects a .git shell without HEAD and stops publishing with an actionable message', async () => {
    const { root, remotePath } = await makeRoot();
    await initRepository(remotePath);

    expect(await inspectRemoteTarget(root)).toEqual({
      kind: 'blocked',
      reason: INNER_REPO_NO_HEAD_ERROR
    });

    const verified = await verifyClonedRepository(remotePath);
    expect(verified.ok).toBe(false);
    if (!verified.ok) {
      expect(verified.error).toBe(INNER_REPO_NO_HEAD_ERROR);
      expect(verified.detail).toBeTruthy();
    }

    const check = await checkInnerRepositoryHead(remotePath);
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.error).toBe(INNER_REPO_NO_HEAD_ERROR);
      expect(check.detail).toBeTruthy();
    }

    const sync = await syncInnerRepository(remotePath, 'main');
    expect(sync.ok).toBe(false);
    if (!sync.ok) {
      expect(sync.error).toBe(INNER_REPO_NO_HEAD_ERROR);
      expect(sync.detail).toBeTruthy();
      expect(sync.error).not.toContain("ambiguous argument 'HEAD'");
    }
  });

  it('accepts a repository that has a commit', async () => {
    const { root, remotePath } = await makeRoot();
    await initRepository(remotePath);
    await commitEmpty(remotePath);

    expect(await inspectRemoteTarget(root)).toEqual({ kind: 'valid-repo' });
    expect(await verifyClonedRepository(remotePath)).toEqual({ ok: true });
    expect(await checkInnerRepositoryHead(remotePath)).toEqual({ ok: true });
  });

  it('still blocks a non-empty directory without a usable .git', async () => {
    const { root, remotePath } = await makeRoot();
    await fs.mkdir(remotePath, { recursive: true });
    await fs.writeFile(path.join(remotePath, 'README.md'), 'content');

    expect(await inspectRemoteTarget(root)).toEqual({
      kind: 'blocked',
      reason: REMOTE_DIR_NON_EMPTY_ERROR
    });
  });
});
