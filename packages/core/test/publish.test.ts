import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  checkProjectReadme,
  commitAndPushInnerRepository,
  copyProjectIntoInnerRepository,
  formatPushFailure,
  pushWithDivergenceRetry,
  remoteProjectUrl,
  restoreInnerRepository,
  scanProjectDirectory
} from '../src/publish';
import { runGit } from '../src/git';
import { appendMarkerLine } from '../src/ideas';

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
    expect(scan.blocked).toEqual(['.git (nested Git repository)']);
  });

  it.skipIf(process.platform === 'win32')('blocks symbolic links', async () => {
    const project = await tempDir('ideahub-symlink-');
    await fs.writeFile(path.join(project, 'ideas.md'), 'idea', 'utf8');
    await fs.symlink(path.join(project, 'ideas.md'), path.join(project, 'link.md'));
    const scan = await scanProjectDirectory(project);
    expect(scan.blocked).toEqual(['link.md (symbolic link)']);
  });
});

describe('copyProjectIntoInnerRepository', () => {
  it('replaces an existing target, copies nested files and omits ideas.md', async () => {
    const project = await tempDir('ideahub-copy-src-');
    await fs.writeFile(path.join(project, 'ideas.md'), 'new', 'utf8');
    await fs.mkdir(path.join(project, 'assets'), { recursive: true });
    await fs.writeFile(path.join(project, 'assets', 'a.txt'), 'a', 'utf8');

    const inner = await tempDir('ideahub-copy-dst-');
    const target = path.join(inner, 'MyGame');
    await fs.mkdir(target, { recursive: true });
    await fs.writeFile(path.join(target, 'old.txt'), 'old', 'utf8');

    const result = await copyProjectIntoInnerRepository(inner, 'MyGame', project, 'proof file');
    expect(result.ok).toBe(true);
    await expect(fs.access(path.join(target, 'old.txt'))).rejects.toThrow();
    await expect(fs.access(path.join(target, 'ideas.md'))).rejects.toThrow();
    expect(await fs.readFile(path.join(target, 'README.md'), 'utf8')).toBe('proof file');
    expect(await fs.readFile(path.join(target, 'assets', 'a.txt'), 'utf8')).toBe('a');
  });

  it('refuses a source project that contains README.md', async () => {
    const project = await tempDir('ideahub-copy-readme-');
    const marker = '###### `Published: 2026-11-06 18:33:28 (UTC+08:00) [ideahub]`';
    await fs.writeFile(
      path.join(project, 'ideas.md'),
      appendMarkerLine('创意原文\n', marker),
      'utf8'
    );
    await fs.writeFile(path.join(project, 'README.md'), 'user readme', 'utf8');

    const inner = await tempDir('ideahub-copy-readme-dst-');
    const proofFile = `---\nversion: "1"\n---\n\n${marker}\n\n创意原文\n`;
    const result = await copyProjectIntoInnerRepository(inner, 'MyGame', project, proofFile);

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('expected the copy to be refused');
    }
    expect(result.error.startsWith('Publish blocked:')).toBe(true);
    expect(result.error).toContain('README.md');
    await expect(fs.access(path.join(inner, 'MyGame'))).rejects.toThrow();
  });
});

describe('checkProjectReadme', () => {
  it('refuses an existing README.md for both proof and publish', async () => {
    const project = await tempDir('ideahub-readme-check-');
    await fs.writeFile(path.join(project, 'README.md'), 'user readme', 'utf8');

    const proof = await checkProjectReadme(project, 'proof');
    const publish = await checkProjectReadme(project, 'publish');

    expect(proof.ok).toBe(false);
    expect(publish.ok).toBe(false);
    if (!proof.ok) {
      expect(proof.error.startsWith('Proof blocked:')).toBe(true);
    }
    if (!publish.ok) {
      expect(publish.error.startsWith('Publish blocked:')).toBe(true);
    }
  });

  it('allows a project without README.md', async () => {
    const project = await tempDir('ideahub-readme-missing-');
    await fs.writeFile(path.join(project, 'ideas.md'), 'idea', 'utf8');
    expect(await checkProjectReadme(project, 'proof')).toEqual({ ok: true });
  });
});

describe('formatPushFailure', () => {
  it('explains a rejected push and prints manual commands with the directory', () => {
    const message = formatPushFailure(
      'C:/repo/.ideahub/remote',
      'main',
      "! [rejected] HEAD -> main (non-fast-forward)\nerror: failed to push some refs"
    );

    expect(
      message.startsWith(
        'Publish failed: the remote proof repository changed after syncing, so the push was rejected.'
      )
    ).toBe(true);
    expect(message).toContain('Another person may have pushed to it.');
    expect(message).toContain('Directory: C:/repo/.ideahub/remote');
    expect(message).toContain('git -C "C:/repo/.ideahub/remote" fetch origin');
    expect(message).toContain('git -C "C:/repo/.ideahub/remote" merge --ff-only origin/main');
    expect(message).toContain('git -C "C:/repo/.ideahub/remote" push origin HEAD:main');
  });

  it('keeps the generic summary for other push failures but still prints commands', () => {
    const message = formatPushFailure('/repo/.ideahub/remote', 'main', 'remote: Permission denied');

    expect(message.startsWith('Publish failed: the inner repository could not be pushed.')).toBe(
      true
    );
    expect(message).toContain('Push the inner repository manually:');
  });
});

describe('pushWithDivergenceRetry', () => {
  const REJECTED = '! [rejected] HEAD -> main (non-fast-forward)';

  async function createDivergedRepositories(): Promise<{
    inner: string;
    other: string;
  }> {
    const bare = await tempDir('ideahub-retry-bare-');
    await runGit(bare, ['init', '--bare']);

    const seed = await tempDir('ideahub-retry-seed-');
    await runGit(seed, ['init']);
    await runGit(seed, ['config', 'user.name', 'Test']);
    await runGit(seed, ['config', 'user.email', 'test@example.com']);
    await fs.writeFile(path.join(seed, 'ideas.md'), 'base\n', 'utf8');
    await runGit(seed, ['add', '.']);
    await runGit(seed, ['commit', '-m', 'base']);
    await runGit(seed, ['remote', 'add', 'origin', bare]);
    await runGit(seed, ['push', 'origin', 'HEAD:main']);
    await runGit(bare, ['symbolic-ref', 'HEAD', 'refs/heads/main']);

    const inner = await tempDir('ideahub-retry-inner-');
    await runGit(inner, ['clone', bare, '.']);
    await runGit(inner, ['config', 'user.name', 'Test']);
    await runGit(inner, ['config', 'user.email', 'test@example.com']);

    const other = await tempDir('ideahub-retry-other-');
    await runGit(other, ['clone', bare, '.']);
    await runGit(other, ['config', 'user.name', 'Other']);
    await runGit(other, ['config', 'user.email', 'other@example.com']);

    return { inner, other };
  }

  async function commitFile(root: string, file: string, content: string): Promise<void> {
    await fs.writeFile(path.join(root, file), content, 'utf8');
    await runGit(root, ['add', '.']);
    expect((await runGit(root, ['commit', '-m', `update ${file}`])).code).toBe(0);
  }

  it('retries once after a divergence and succeeds without manual instructions', async () => {
    const { inner, other } = await createDivergedRepositories();
    await commitFile(other, 'other.txt', 'other\n');
    await runGit(other, ['push', 'origin', 'HEAD:main']);
    await commitFile(inner, 'local.txt', 'local\n');

    let calls = 0;
    const result = await pushWithDivergenceRetry(inner, 'main', async () => {
      calls += 1;
      return calls === 1 ? { ok: false, detail: REJECTED } : { ok: true };
    });

    expect(result).toEqual({ ok: true, retried: true });
    expect(calls).toBe(2);
    expect((await runGit(inner, ['merge-base', '--is-ancestor', 'origin/main', 'HEAD'])).code).toBe(0);
    expect(await fs.readFile(path.join(inner, 'local.txt'), 'utf8')).toBe('local\n');
    expect(await fs.readFile(path.join(inner, 'other.txt'), 'utf8')).toBe('other\n');
  });

  it('aborts a conflicted rebase, restores the pre-retry HEAD and keeps our commit', async () => {
    const { inner, other } = await createDivergedRepositories();
    await commitFile(other, 'ideas.md', 'remote\n');
    await runGit(other, ['push', 'origin', 'HEAD:main']);
    await commitFile(inner, 'ideas.md', 'local\n');

    const before = (await runGit(inner, ['rev-parse', 'HEAD'])).stdout.trim();
    let calls = 0;
    const result = await pushWithDivergenceRetry(inner, 'main', async () => {
      calls += 1;
      return { ok: false, detail: REJECTED };
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('expected the retry to fail');
    }
    expect(result.retried).toBe(true);
    expect(result.detail).toContain('git rebase origin/main failed');
    expect(calls).toBe(1);
    expect((await runGit(inner, ['rev-parse', 'HEAD'])).stdout.trim()).toBe(before);
    expect(await fs.readFile(path.join(inner, 'ideas.md'), 'utf8')).toBe('local\n');
    expect((await runGit(inner, ['status', '--porcelain'])).stdout.trim()).toBe('');
  });

  it('does not retry a non-divergence push failure', async () => {
    const { inner } = await createDivergedRepositories();
    await commitFile(inner, 'local.txt', 'local\n');
    const before = (await runGit(inner, ['rev-parse', 'HEAD'])).stdout.trim();

    let calls = 0;
    const result = await pushWithDivergenceRetry(inner, 'main', async () => {
      calls += 1;
      return { ok: false, detail: 'remote: Permission denied' };
    });

    expect(result).toEqual({ ok: false, detail: 'remote: Permission denied', retried: false });
    expect(calls).toBe(1);
    expect((await runGit(inner, ['rev-parse', 'HEAD'])).stdout.trim()).toBe(before);
  });

  it('restores the pre-retry HEAD when the second push is also rejected', async () => {
    const { inner, other } = await createDivergedRepositories();
    await commitFile(other, 'other.txt', 'other\n');
    await runGit(other, ['push', 'origin', 'HEAD:main']);
    await commitFile(inner, 'local.txt', 'local\n');

    const before = (await runGit(inner, ['rev-parse', 'HEAD'])).stdout.trim();
    let calls = 0;
    const result = await pushWithDivergenceRetry(inner, 'main', async () => {
      calls += 1;
      return { ok: false, detail: REJECTED };
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('expected the retry to fail');
    }
    expect(result.retried).toBe(true);
    expect(calls).toBe(2);
    expect((await runGit(inner, ['rev-parse', 'HEAD'])).stdout.trim()).toBe(before);
    expect(await fs.readFile(path.join(inner, 'local.txt'), 'utf8')).toBe('local\n');
  });
});

describe('remoteProjectUrl', () => {
  it('encodes branch and project names', () => {
    expect(remoteProjectUrl('owner', 'repo', 'main', 'My Game')).toBe(
      'https://github.com/owner/repo/tree/main/My%20Game'
    );
  });
});

describe('restoreInnerRepository', () => {
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

    expect((await copyProjectIntoInnerRepository(inner, 'MyGame', project, 'proof')).ok).toBe(true);

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
