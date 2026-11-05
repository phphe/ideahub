import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { initializeLocalRepository } from '../src/core/init';
import { configPath } from '../src/core/config';
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

    const releaseConfig = JSON.parse(
      await fs.readFile(path.join(root, 'ideahub.config.json'), 'utf8')
    ) as { releaseBranch: string };
    expect(releaseConfig.releaseBranch).toBe('main');

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
