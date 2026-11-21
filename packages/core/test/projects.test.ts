import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createProject, IDEAS_FILE, ideasTemplate, listProjects } from '../src/projects';
import { runGit } from '../src/git';

async function tempRoot(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'ideahub-project-'));
}

describe('createProject', () => {
  it('creates <name>/ideas.md with the minimal template', async () => {
    const root = await tempRoot();
    const result = await createProject(root, 'My Game');

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error);
    }
    expect(result.content).toBe(ideasTemplate('My Game'));

    const text = await fs.readFile(path.join(root, 'My Game', IDEAS_FILE), 'utf8');
    expect(text).toBe('### My Game\n');
    expect(await listProjects(root)).toEqual(['My Game']);

    await fs.rm(root, { recursive: true, force: true });
  });

  it('commits the new ideas.md when the root is a Git repository', async () => {
    const root = await tempRoot();
    await runGit(root, ['init']);
    await runGit(root, ['config', 'user.name', 'Test']);
    await runGit(root, ['config', 'user.email', 'test@example.com']);

    const result = await createProject(root, 'MyGame');

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error);
    }
    expect(result.commit.status).toBe('committed');
    expect((await runGit(root, ['log', '-1', '--format=%s'])).stdout.trim()).toBe(
      'ideahub: create project'
    );
    const committed = (await runGit(root, ['show', '--name-only', '--format=', 'HEAD'])).stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    expect(committed).toEqual(['MyGame/ideas.md']);
    expect((await runGit(root, ['status', '--porcelain'])).stdout.trim()).toBe('');

    await fs.rm(root, { recursive: true, force: true });
  });

  it('refuses an existing project folder without overwriting ideas.md', async () => {
    const root = await tempRoot();
    const first = await createProject(root, 'Existing');
    expect(first.ok).toBe(true);

    const original = await fs.readFile(path.join(root, 'Existing', IDEAS_FILE), 'utf8');
    const second = await createProject(root, 'Existing');

    expect(second.ok).toBe(false);
    if (second.ok) {
      throw new Error('expected a duplicate rejection');
    }
    expect(second.error).toContain('same name already exists');
    expect(await fs.readFile(path.join(root, 'Existing', IDEAS_FILE), 'utf8')).toBe(original);

    await fs.rm(root, { recursive: true, force: true });
  });

  it('refuses a same-name folder that is not a project', async () => {
    const root = await tempRoot();
    await fs.mkdir(path.join(root, 'ccc'));

    const result = await createProject(root, 'ccc');

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('expected the folder guard to reject');
    }
    expect(result.error).toContain('folder with the same name already exists');
    await expect(fs.access(path.join(root, 'ccc', IDEAS_FILE))).rejects.toThrow();

    await fs.rm(root, { recursive: true, force: true });
  });

  it('rejects invalid names without creating anything', async () => {
    const root = await tempRoot();

    for (const name of ['', '.hidden', 'a/b', 'a:b']) {
      const result = await createProject(root, name);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.length).toBeGreaterThan(0);
      }
    }

    await expect(fs.access(path.join(root, 'a'))).rejects.toThrow();
    await fs.rm(root, { recursive: true, force: true });
  });

  it('rejects names that conflict with a remote project folder', async () => {
    const root = await tempRoot();
    const result = await createProject(root, 'My Game', ['my game']);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('remote directory with the same name');
    }

    await fs.rm(root, { recursive: true, force: true });
  });
});
