import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/core/git', () => ({
  runGit: vi.fn(async () => ({
    code: 1,
    stdout: '',
    stderr: '',
    missing: true
  }))
}));

import { buildFingerprint } from '../src/core/fingerprint';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe('buildFingerprint without git', () => {
  it('reports a missing git executable instead of hashing files in JS', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ideahub-no-git-'));
    roots.push(root);
    const projectDir = path.join(root, 'MyGame');
    await fs.mkdir(projectDir, { recursive: true });
    await fs.writeFile(path.join(projectDir, 'a.png'), 'image', 'utf8');

    const result = await buildFingerprint({
      project: 'MyGame',
      text: '![a](./a.png)',
      projectDir,
      repoRoot: root
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('expected failure');
    }
    expect(result.code).toBe('git-missing');
    expect(result.message).toContain('未找到 git');
  });
});
