import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { configPath, writeConfig } from '../src/core/config';
import { runGit } from '../src/core/git';
import {
  commitSingleFile,
  CONFIG_INIT_COMMIT_MESSAGE,
  CONFIG_REMOTE_COMMIT_MESSAGE
} from '../src/core/marker-commit';

const roots: string[] = [];

async function createRepo(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ideahub-config-commit-'));
  roots.push(root);
  await runGit(root, ['init']);
  await runGit(root, ['config', 'user.name', 'Test']);
  await runGit(root, ['config', 'user.email', 'test@example.com']);
  await fs.writeFile(path.join(root, 'notes.md'), 'user notes\n');
  await runGit(root, ['add', 'notes.md']);
  await runGit(root, ['commit', '-m', 'initial']);
  return root;
}

async function headSubject(root: string): Promise<string> {
  return (await runGit(root, ['log', '-1', '--format=%s'])).stdout.trim();
}

async function changedFiles(root: string): Promise<string[]> {
  const result = await runGit(root, ['show', '--name-only', '--format=', 'HEAD']);
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

afterEach(async () => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root) {
      await fs.rm(root, { recursive: true, force: true }).catch(() => undefined);
    }
  }
});

describe('commitSingleFile', { timeout: 30000 }, () => {
  it('commits a newly created config.json without touching other files', async () => {
    const root = await createRepo();
    await writeConfig(root, { version: 1 });

    const result = await commitSingleFile({
      root,
      filePath: configPath(root),
      message: CONFIG_INIT_COMMIT_MESSAGE
    });

    expect(result.status).toBe('committed');
    expect(await headSubject(root)).toBe('ideahub: initialize config');
    expect(await changedFiles(root)).toEqual(['.ideahub/config.json']);
  });

  it('commits only config.json and leaves the user staged changes alone', async () => {
    const root = await createRepo();
    await writeConfig(root, { version: 1 });
    await commitSingleFile({
      root,
      filePath: configPath(root),
      message: CONFIG_INIT_COMMIT_MESSAGE
    });

    await fs.writeFile(path.join(root, 'notes.md'), 'user staged edit\n');
    await runGit(root, ['add', 'notes.md']);
    await writeConfig(root, {
      version: 1,
      remote: {
        provider: 'github',
        owner: 'owner',
        repo: 'repo',
        url: 'https://github.com/owner/repo',
        branch: 'dev'
      }
    });

    const result = await commitSingleFile({
      root,
      filePath: configPath(root),
      message: CONFIG_REMOTE_COMMIT_MESSAGE
    });

    expect(result.status).toBe('committed');
    expect(await headSubject(root)).toBe('ideahub: update remote config');
    expect(await changedFiles(root)).toEqual(['.ideahub/config.json']);
    expect((await runGit(root, ['diff', '--cached', '--name-only'])).stdout.trim()).toBe(
      'notes.md'
    );
  });

  it('skips when the config content did not change', async () => {
    const root = await createRepo();
    await writeConfig(root, { version: 1 });
    await commitSingleFile({
      root,
      filePath: configPath(root),
      message: CONFIG_INIT_COMMIT_MESSAGE
    });
    const before = (await runGit(root, ['rev-parse', 'HEAD'])).stdout.trim();

    const result = await commitSingleFile({
      root,
      filePath: configPath(root),
      message: CONFIG_REMOTE_COMMIT_MESSAGE
    });

    expect(result.status).toBe('skipped');
    expect(result.silent).toBe(true);
    expect((await runGit(root, ['rev-parse', 'HEAD'])).stdout.trim()).toBe(before);
  });

  it('skips when the workspace is not a git repository', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ideahub-not-git-'));
    roots.push(root);
    await writeConfig(root, { version: 1 });

    const result = await commitSingleFile({
      root,
      filePath: configPath(root),
      message: CONFIG_INIT_COMMIT_MESSAGE
    });

    expect(result.status).toBe('skipped');
    expect(result.silent).toBe(true);
  });
});
