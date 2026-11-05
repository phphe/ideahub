import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  copyProjectIntoInnerRepository,
  remoteProjectUrl,
  scanProjectDirectory
} from '../src/core/publish';
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
    const marker = 'Published: 2026-11-06 18:33:28 (UTC+08:00) [ideahub]';
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
