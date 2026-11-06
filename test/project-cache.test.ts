import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectParseCache } from '../src/core/project-cache';
import type { ProjectSummary } from '../src/core/status';

const roots: string[] = [];

async function makeRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ideahub-cache-'));
  roots.push(root);
  return root;
}

async function makeProject(root: string, name: string, text = ''): Promise<void> {
  await fs.mkdir(path.join(root, name), { recursive: true });
  await fs.writeFile(path.join(root, name, 'ideas.md'), text, 'utf8');
}

function parseSummary(name: string, text: string): ProjectSummary {
  return {
    name,
    proofCount: text.length,
    proofTags: [],
    publishedCount: 0,
    hasNewContent: false,
    canPublish: false
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe('ProjectParseCache', () => {
  it('reuses the parsed summary while mtime and size are unchanged', async () => {
    const root = await makeRoot();
    await makeProject(root, 'A', '# A\n');
    const parse = vi.fn(parseSummary);
    const cache = new ProjectParseCache(parse);

    const first = await cache.summarize(root, 'A');
    const second = await cache.summarize(root, 'A');

    expect(parse).toHaveBeenCalledTimes(1);
    expect(first).toEqual(second);
    expect(first.updatedAt).toBeTypeOf('number');
    expect(cache.has(root, 'A')).toBe(true);
  });

  it('reparses when the stat version changes', async () => {
    const root = await makeRoot();
    await makeProject(root, 'A', '# A\n');
    const parse = vi.fn(parseSummary);
    const cache = new ProjectParseCache(parse);

    await cache.summarize(root, 'A');
    await fs.writeFile(path.join(root, 'A', 'ideas.md'), '# A with more text\n', 'utf8');
    const refreshed = await cache.summarize(root, 'A');

    expect(parse).toHaveBeenCalledTimes(2);
    expect(refreshed.proofCount).toBe('# A with more text\n'.length);
  });

  it('deduplicates concurrent parses of the same file', async () => {
    const root = await makeRoot();
    await makeProject(root, 'A', '# A\n');
    const parse = vi.fn(parseSummary);
    const cache = new ProjectParseCache(parse);

    // Both calls run before the first stat/read settles, so the second must
    // reuse the in-flight promise instead of starting another parse.
    const results = await Promise.all([
      cache.summarize(root, 'A'),
      cache.summarize(root, 'A')
    ]);

    expect(parse).toHaveBeenCalledTimes(1);
    expect(results[0]).toBe(results[1]);
  });

  it('drops the entry on invalidate and reparses lazily', async () => {
    const root = await makeRoot();
    await makeProject(root, 'A', '# A\n');
    const parse = vi.fn(parseSummary);
    const cache = new ProjectParseCache(parse);

    await cache.summarize(root, 'A');
    cache.invalidate(root, 'A');
    expect(cache.has(root, 'A')).toBe(false);

    await cache.summarize(root, 'A');
    expect(parse).toHaveBeenCalledTimes(2);
  });

  it('evicts the least recently used entry once over the limit', async () => {
    const root = await makeRoot();
    await makeProject(root, 'A', '# A\n');
    await makeProject(root, 'B', '# B\n');
    await makeProject(root, 'C', '# C\n');
    const parse = vi.fn(parseSummary);
    const cache = new ProjectParseCache(parse, 2);

    await cache.summarize(root, 'A');
    await cache.summarize(root, 'B');
    await cache.summarize(root, 'C');

    expect(cache.size()).toBe(2);
    expect(cache.has(root, 'A')).toBe(false);
    expect(cache.has(root, 'B')).toBe(true);
    expect(cache.has(root, 'C')).toBe(true);

    await cache.summarize(root, 'A');
    expect(parse).toHaveBeenCalledTimes(4);
    expect(cache.size()).toBe(2);
    expect(cache.has(root, 'B')).toBe(false);
  });
});
