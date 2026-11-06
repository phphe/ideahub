import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { initializeLocalRepository } from '../src/core/init';
import { configPath } from '../src/core/config';
import { runGit } from '../src/core/git';
import { hasHookBlock, prePushPath, readPrePushHook } from '../src/core/hook';
import { detectWorkspace } from '../src/core/status';

describe('initializeLocalRepository', () => {
  it('creates the local structure only in an empty folder', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ideahub-init-'));
    const result = await initializeLocalRepository(root);
    expect(result.ok).toBe(true);

    const config = JSON.parse(await fs.readFile(configPath(root), 'utf8')) as { version: number };
    expect(config.version).toBe(1);

    const gitignore = await fs.readFile(path.join(root, '.ideahub', '.gitignore'), 'utf8');
    expect(gitignore).toContain('remote/');

    const hook = await readPrePushHook(root);
    expect(hook).not.toBeNull();
    expect(hasHookBlock(hook ?? '')).toBe(true);

    await fs.access(path.join(root, 'README.md'));
    await fs.access(prePushPath(root));

    const state = await detectWorkspace(root);
    expect(state.kind).toBe('local');
    if (state.kind === 'local') {
      expect(state.issues.map((issue) => issue.id)).toContain('remote-url');
      expect(state.projects).toEqual([]);
    }

    const again = await initializeLocalRepository(root);
    expect(again.ok).toBe(false);
    if (!again.ok) {
      expect(again.completedSteps).toEqual([]);
    }

    await fs.rm(root, { recursive: true, force: true });
  });

  it('commits only the newly created config.json when git identity is available', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ideahub-init-commit-'));
    const previous = {
      GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME,
      GIT_AUTHOR_EMAIL: process.env.GIT_AUTHOR_EMAIL,
      GIT_COMMITTER_NAME: process.env.GIT_COMMITTER_NAME,
      GIT_COMMITTER_EMAIL: process.env.GIT_COMMITTER_EMAIL
    };
    Object.assign(process.env, {
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 'test@example.com'
    });
    try {
      const result = await initializeLocalRepository(root);
      expect(result.ok).toBe(true);

      expect((await runGit(root, ['log', '-1', '--format=%s'])).stdout.trim()).toBe(
        'ideahub: initialize config'
      );
      const changed = (await runGit(root, ['show', '--name-only', '--format=', 'HEAD'])).stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      expect(changed).toEqual(['.ideahub/config.json']);
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('does not initialize a non-empty folder without .ideahub', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ideahub-nonempty-'));
    await fs.writeFile(path.join(root, 'keep.txt'), 'keep', 'utf8');
    const state = await detectWorkspace(root);
    expect(state.kind).toBe('not-ideahub');
    await fs.rm(root, { recursive: true, force: true });
  });

  it('reports no folder when no workspace is open', async () => {
    expect((await detectWorkspace(null)).kind).toBe('no-folder');
  });
});
