import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { buildCloneArgs } from '../src/clone';
import { isShallowRepository, runGit, unshallowRepository } from '../src/git';

const roots: string[] = [];

async function makeRemote(): Promise<{ base: string; url: string; emptyUrl: string }> {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'ideahub-shallow-'));
  roots.push(base);
  const remote = path.join(base, 'remote.git');
  const empty = path.join(base, 'empty.git');
  const work = path.join(base, 'work');
  await runGit(base, ['init', '--bare', '-b', 'main', remote]);
  await runGit(base, ['init', '--bare', '-b', 'main', empty]);
  await runGit(base, ['init', '-b', 'main', work]);
  await runGit(work, ['config', 'user.name', 'Test']);
  await runGit(work, ['config', 'user.email', 'test@example.com']);
  await runGit(work, ['commit', '--allow-empty', '-m', 'one']);
  await runGit(work, ['commit', '--allow-empty', '-m', 'two']);
  const url = pathToFileURL(remote).href;
  const emptyUrl = pathToFileURL(empty).href;
  await runGit(work, ['remote', 'add', 'origin', url]);
  await runGit(work, ['push', 'origin', 'main']);
  return { base, url, emptyUrl };
}

async function shallowClone(url: string, base: string): Promise<string> {
  const target = path.join(base, 'inner');
  const result = await runGit(base, buildCloneArgs(url, 'main', target));
  expect(result.code).toBe(0);
  await runGit(target, ['config', 'user.name', 'Test']);
  await runGit(target, ['config', 'user.email', 'test@example.com']);
  return target;
}

function output(result: { stdout: string; stderr: string }): string {
  return `${result.stdout}\n${result.stderr}`;
}

afterEach(async () => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root) {
      await fs.rm(root, { recursive: true, force: true }).catch(() => undefined);
    }
  }
});

describe('shallow clone and push', { timeout: 60000 }, () => {
  it('clones only the newest commit', async () => {
    expect(buildCloneArgs('url', 'main', 'target')).toEqual([
      'clone',
      '--depth',
      '1',
      '--branch',
      'main',
      'url',
      'target'
    ]);

    const remote = await makeRemote();
    const inner = await shallowClone(remote.url, remote.base);

    expect(await isShallowRepository(inner)).toBe(true);
    expect((await runGit(inner, ['rev-list', '--count', 'HEAD'])).stdout.trim()).toBe('1');
  });

  it('proves a shallow push is rejected when the destination lacks the history', async () => {
    const remote = await makeRemote();
    const inner = await shallowClone(remote.url, remote.base);
    await runGit(inner, ['commit', '--allow-empty', '-m', 'shallow work']);

    const rejected = await runGit(inner, ['push', remote.emptyUrl, 'HEAD:main']);
    expect(rejected.code).not.toBe(0);
    expect(output(rejected)).toMatch(/shallow update not allowed/i);

    const unshallow = await unshallowRepository(inner);
    expect(unshallow.code).toBe(0);
    expect(await isShallowRepository(inner)).toBe(false);

    const retried = await runGit(inner, ['push', remote.emptyUrl, 'HEAD:main']);
    expect(retried.code).toBe(0);
  });
});
