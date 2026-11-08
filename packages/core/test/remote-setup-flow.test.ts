import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { RemoteConfig } from '../src/config';
import { remoteRepoPath } from '../src/config';
import {
  describeCloneFailure,
  inspectRemoteTarget,
  REMOTE_DIR_NON_EMPTY_ERROR,
  REMOTE_PATH_NOT_DIRECTORY_ERROR
} from '../src/clone';
import { runGit } from '../src/git';
import type { ImmutabilityCheck } from '../src/immutability';
import {
  planRemoteClone,
  runRemoteSetupFlow,
  type RemoteSetupFlowDeps
} from '../src/remote-setup-flow';
import type { ValidateRemoteResult } from '../src/remote-setup';

const REMOTE: RemoteConfig = {
  provider: 'github',
  owner: 'owner',
  repo: 'repo',
  url: 'https://github.com/owner/repo',
  branch: 'main'
};

const ENABLED: ImmutabilityCheck = { kind: 'enabled', enforcedByOwner: false };
const VALID: ValidateRemoteResult = { ok: true, remote: REMOTE, immutability: ENABLED };

function createDeps(overrides: Partial<RemoteSetupFlowDeps> = {}): RemoteSetupFlowDeps {
  return {
    validate: vi.fn(async () => VALID),
    decideImmutability: vi.fn(() => ({ ok: true, message: '已确认 Release 不可变。' })),
    persist: vi.fn(async () => ({ ok: true as const })),
    inspect: vi.fn(async () => ({ kind: 'missing' as const })),
    clone: vi.fn(async () => ({ ok: true as const, branch: 'main' })),
    ...overrides
  };
}

describe('runRemoteSetupFlow', () => {
  it('validates and then clones automatically after the remote passes validation', async () => {
    const steps: string[] = [];
    const deps = createDeps({ onStep: (step) => steps.push(step) });

    const result = await runRemoteSetupFlow(deps);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('expected a successful flow');
    }
    expect(result.clone).toBe('cloned');
    expect(result.branch).toBe('main');
    expect(deps.persist).toHaveBeenCalledTimes(1);
    expect(deps.clone).toHaveBeenCalledTimes(1);
    expect(deps.clone).toHaveBeenCalledWith(REMOTE);
    expect(steps).toEqual(['validate', 'persist', 'clone']);
  });

  it('does not persist or clone when remote validation fails', async () => {
    const deps = createDeps({
      validate: vi.fn(async (): Promise<ValidateRemoteResult> => ({
        ok: false,
        error: '仓库不存在，或当前 GitHub 账号没有访问权限。'
      }))
    });

    const result = await runRemoteSetupFlow(deps);

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('expected a validation failure');
    }
    expect(result.stage).toBe('validation');
    expect(result.retryClone).toBe(false);
    expect(deps.persist).not.toHaveBeenCalled();
    expect(deps.clone).not.toHaveBeenCalled();
  });

  it('does not clone when immutability is not confirmed', async () => {
    const deps = createDeps({
      decideImmutability: vi.fn(() => ({
        ok: false,
        message: '请勾选“我已确认仓库启用了 Enable release immutability”后重试。'
      }))
    });

    const result = await runRemoteSetupFlow(deps);

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('expected an immutability failure');
    }
    expect(result.stage).toBe('validation');
    expect(deps.persist).not.toHaveBeenCalled();
    expect(deps.clone).not.toHaveBeenCalled();
  });

  it('skips cloning when a valid inner repository already exists', async () => {
    const deps = createDeps({
      inspect: vi.fn(async () => ({ kind: 'valid-repo' as const }))
    });

    const result = await runRemoteSetupFlow(deps);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('expected a successful flow');
    }
    expect(result.clone).toBe('skipped');
    expect(deps.persist).toHaveBeenCalledTimes(1);
    expect(deps.clone).not.toHaveBeenCalled();
  });

  it('refuses a non-empty directory and keeps the clone entry as retry', async () => {
    const deps = createDeps({
      inspect: vi.fn(async () => ({
        kind: 'blocked' as const,
        reason: REMOTE_DIR_NON_EMPTY_ERROR
      }))
    });

    const result = await runRemoteSetupFlow(deps);

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('expected a blocked clone');
    }
    expect(result.stage).toBe('clone');
    expect(result.retryClone).toBe(true);
    expect(result.message).toBe(REMOTE_DIR_NON_EMPTY_ERROR);
    expect(deps.clone).not.toHaveBeenCalled();
  });

  it('keeps the retry entry when cloning fails', async () => {
    const deps = createDeps({
      clone: vi.fn(async () => ({
        ok: false as const,
        error: '克隆远程创意仓库失败：网络错误，无法连接到远程仓库。'
      }))
    });

    const result = await runRemoteSetupFlow(deps);

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('expected a clone failure');
    }
    expect(result.stage).toBe('clone');
    expect(result.retryClone).toBe(true);
    expect(result.message).toContain('网络错误');
    expect(deps.clone).toHaveBeenCalledTimes(1);
  });

  it('does not clone when saving the config or hook fails', async () => {
    const deps = createDeps({
      persist: vi.fn(async () => ({ ok: false as const, error: 'hook 写入失败' }))
    });

    const result = await runRemoteSetupFlow(deps);

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('expected a persist failure');
    }
    expect(result.stage).toBe('config');
    expect(result.retryClone).toBe(false);
    expect(deps.clone).not.toHaveBeenCalled();
  });

  it('does not persist or clone when the user cancels the remote change', async () => {
    const deps = createDeps({
      confirmChange: vi.fn(async () => false)
    });

    const result = await runRemoteSetupFlow(deps);

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('expected a cancelled flow');
    }
    expect(result.stage).toBe('validation');
    expect(result.message).toBe('已取消更换远程地址。');
    expect(deps.persist).not.toHaveBeenCalled();
    expect(deps.clone).not.toHaveBeenCalled();
  });
});

describe('planRemoteClone', () => {
  it('skips an existing valid repository', () => {
    expect(planRemoteClone({ kind: 'valid-repo' })).toEqual({
      action: 'skip',
      reason: 'existing-repo'
    });
  });

  it('blocks a non-empty target instead of overwriting it', () => {
    expect(
      planRemoteClone({ kind: 'blocked', reason: REMOTE_DIR_NON_EMPTY_ERROR })
    ).toEqual({ action: 'block', reason: REMOTE_DIR_NON_EMPTY_ERROR });
  });

  it('clones when the target is missing or empty', () => {
    expect(planRemoteClone({ kind: 'missing' })).toEqual({ action: 'clone' });
  });
});

describe('inspectRemoteTarget', () => {
  it('treats a missing or empty target as cloneable', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ideahub-target-'));
    expect(await inspectRemoteTarget(root)).toEqual({ kind: 'missing' });

    await fs.mkdir(remoteRepoPath(root), { recursive: true });
    expect(await inspectRemoteTarget(root)).toEqual({ kind: 'missing' });

    await fs.rm(root, { recursive: true, force: true });
  });

  it('treats an existing inner Git repository as a valid clone', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ideahub-target-'));
    await fs.mkdir(remoteRepoPath(root), { recursive: true });
    const init = await runGit(remoteRepoPath(root), ['init']);
    expect(init.code).toBe(0);
    const commit = await runGit(remoteRepoPath(root), [
      '-c',
      'user.email=test@example.com',
      '-c',
      'user.name=Test',
      'commit',
      '--allow-empty',
      '-m',
      'inner head'
    ]);
    expect(commit.code).toBe(0);

    expect(await inspectRemoteTarget(root)).toEqual({ kind: 'valid-repo' });

    await fs.rm(root, { recursive: true, force: true });
  });

  it('refuses a non-empty target that is not a Git repository', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ideahub-target-'));
    await fs.mkdir(remoteRepoPath(root), { recursive: true });
    await fs.writeFile(path.join(remoteRepoPath(root), 'keep.txt'), 'keep', 'utf8');

    expect(await inspectRemoteTarget(root)).toEqual({
      kind: 'blocked',
      reason: REMOTE_DIR_NON_EMPTY_ERROR
    });

    await fs.rm(root, { recursive: true, force: true });
  });

  it('refuses when .ideahub/remote is a file', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ideahub-target-'));
    await fs.mkdir(path.join(root, '.ideahub'), { recursive: true });
    await fs.writeFile(remoteRepoPath(root), 'not a directory', 'utf8');

    expect(await inspectRemoteTarget(root)).toEqual({
      kind: 'blocked',
      reason: REMOTE_PATH_NOT_DIRECTORY_ERROR
    });

    await fs.rm(root, { recursive: true, force: true });
  });
});

describe('describeCloneFailure', () => {
  it('distinguishes authentication, missing repository and network failures', () => {
    expect(
      describeCloneFailure(
        "fatal: could not read Username for 'https://github.com': terminal prompts disabled"
      )
    ).toContain('认证失败');
    expect(describeCloneFailure('remote: Repository not found.')).toContain(
      '仓库不存在'
    );
    expect(
      describeCloneFailure('fatal: unable to access: Could not resolve host: github.com')
    ).toContain('网络错误');
  });
});
