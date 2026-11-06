import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  commitAndPushInnerRepository,
  copyProjectIntoInnerRepository,
  remoteProjectUrl,
  restoreInnerRepository,
  scanProjectDirectory
} from '../src/core/publish';
import { runGit } from '../src/core/git';
import { appendMarkerLine } from '../src/core/ideas';

const roots: string[] = [];

async function tempDir(prefix: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe('scanProjectDirectory', () => {
  it('lists regular files recursively and blocks nested git repositories', async () => {
    const project = await tempDir('ideahub-scan-');
    await fs.writeFile(path.join(project, 'ideas.md'), 'idea', 'utf8');
    await fs.mkdir(path.join(project, 'assets'), { recursive: true });
    await fs.writeFile(path.join(project, 'assets', 'image.png'), 'x', 'utf8');
    await fs.mkdir(path.join(project, '.git'), { recursive: true });

    const scan = await scanProjectDirectory(project);
    expect(scan.files).toEqual(['assets/image.png', 'ideas.md']);
    expect(scan.blocked).toEqual(['.git（嵌套 Git 仓库）']);
  });

  it.skipIf(process.platform === 'win32')('blocks symbolic links', async () => {
    const project = await tempDir('ideahub-symlink-');
    await fs.writeFile(path.join(project, 'ideas.md'), 'idea', 'utf8');
    await fs.symlink(path.join(project, 'ideas.md'), path.join(project, 'link.md'));
    const scan = await scanProjectDirectory(project);
    expect(scan.blocked).toEqual(['link.md（符号链接）']);
  });
});

describe('copyProjectIntoInnerRepository', () => {
  it('replaces an existing target and copies nested files', async () => {
    const project = await tempDir('ideahub-copy-src-');
    await fs.writeFile(path.join(project, 'ideas.md'), 'new', 'utf8');
    await fs.mkdir(path.join(project, 'assets'), { recursive: true });
    await fs.writeFile(path.join(project, 'assets', 'a.txt'), 'a', 'utf8');

    const inner = await tempDir('ideahub-copy-dst-');
    const target = path.join(inner, 'MyGame');
    await fs.mkdir(target, { recursive: true });
    await fs.writeFile(path.join(target, 'old.txt'), 'old', 'utf8');

    const result = await copyProjectIntoInnerRepository(inner, 'MyGame', project);
    expect(result.ok).toBe(true);
    await expect(fs.access(path.join(target, 'old.txt'))).rejects.toThrow();
    expect(await fs.readFile(path.join(target, 'ideas.md'), 'utf8')).toBe('new');
    expect(await fs.readFile(path.join(target, 'assets', 'a.txt'), 'utf8')).toBe('a');
  });

  it('carries the Published marker written before the copy into the snapshot', async () => {
    const project = await tempDir('ideahub-copy-published-');
    const localIdeas = path.join(project, 'ideas.md');
    const marker = '###### `Published: 2026-11-06 18:33:28 (UTC+08:00) [ideahub]`';
    await fs.writeFile(localIdeas, appendMarkerLine('创意原文\n', marker), 'utf8');

    const inner = await tempDir('ideahub-copy-published-dst-');
    const result = await copyProjectIntoInnerRepository(inner, 'MyGame', project);
    expect(result.ok).toBe(true);

    const published = await fs.readFile(path.join(inner, 'MyGame', 'ideas.md'), 'utf8');
    expect(published).toContain('创意原文');
    expect(published).toContain(marker);
  });
});

describe('remoteProjectUrl', () => {
  it('encodes branch and project names', () => {
    expect(remoteProjectUrl('owner', 'repo', 'main', 'My Game')).toBe(
      'https://github.com/owner/repo/tree/main/My%20Game'
    );
  });
});

describe('restoreInnerRepository', { timeout: 30000 }, () => {
  async function initInnerRepository(): Promise<string> {
    const inner = await tempDir('ideahub-rollback-');
    expect((await runGit(inner, ['init'])).code).toBe(0);
    await runGit(inner, ['config', 'user.name', 'Test']);
    await runGit(inner, ['config', 'user.email', 'test@example.com']);
    await fs.mkdir(path.join(inner, 'MyGame'), { recursive: true });
    await fs.writeFile(path.join(inner, 'MyGame', 'ideas.md'), 'original', 'utf8');
    await fs.writeFile(path.join(inner, 'README.md'), 'readme', 'utf8');
    await runGit(inner, ['add', '-A']);
    expect((await runGit(inner, ['commit', '-m', 'base'])).code).toBe(0);
    return inner;
  }

  it('restores files and HEAD after a simulated push failure', async () => {
    const inner = await initInnerRepository();
    const beforeHead = (await runGit(inner, ['rev-parse', 'HEAD'])).stdout.trim();

    const project = await tempDir('ideahub-rollback-src-');
    await fs.writeFile(path.join(project, 'ideas.md'), 'published', 'utf8');
    await fs.writeFile(path.join(project, 'extra.txt'), 'new', 'utf8');

    expect((await copyProjectIntoInnerRepository(inner, 'MyGame', project)).ok).toBe(true);

    // A malformed refspec makes git reject the push locally, so the test never
    // touches the network while still failing at the real push stage.
    const push = await commitAndPushInnerRepository(inner, {
      url: 'https://github.com/owner/repo',
      branch: 'main..bad',
      projectName: 'MyGame',
      token: 'token'
    });
    expect(push).toMatchObject({ ok: false, stage: 'push' });

    // Untracked content outside the published project must survive.
    await fs.writeFile(path.join(inner, 'keep-me.txt'), 'user', 'utf8');

    expect(await restoreInnerRepository(inner, beforeHead, 'MyGame')).toEqual({ ok: true });

    expect((await runGit(inner, ['rev-parse', 'HEAD'])).stdout.trim()).toBe(beforeHead);
    expect(await fs.readFile(path.join(inner, 'MyGame', 'ideas.md'), 'utf8')).toBe('original');
    await expect(fs.access(path.join(inner, 'MyGame', 'extra.txt'))).rejects.toThrow();
    expect(await fs.readFile(path.join(inner, 'README.md'), 'utf8')).toBe('readme');
    expect(await fs.readFile(path.join(inner, 'keep-me.txt'), 'utf8')).toBe('user');
    await expect(fs.access(path.join(inner, '.git'))).resolves.toBeUndefined();

    const status = await runGit(inner, ['status', '--porcelain']);
    expect(status.stdout.trim()).toBe('?? keep-me.txt');
  });
});
