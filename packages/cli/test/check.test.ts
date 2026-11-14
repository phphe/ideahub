import { computeFingerprintWith } from '@ideahub/core';
import { describe, expect, it } from 'vitest';
import { runCheck } from '../src/check';

const MARKER = '## 🔏 `Proof: 2026-11-01 10:00:00 (UTC+08:00) [ideahub]`';

function proofFile(block: string): string {
  return [
    '---',
    'version: "0"',
    '---',
    '',
    '> - Proofs: 1',
    '',
    '---',
    '',
    MARKER,
    '',
    block,
    ''
  ].join('\n');
}

interface ReleaseFixture {
  tag_name: string;
  published_at: string | null;
  immutable?: boolean;
}

interface Fixture {
  readme: string;
  releases: ReleaseFixture[];
  tree?: { tree: Array<{ path: string; type: string; sha: string }>; truncated?: boolean };
  gitattributes?: string | null;
  repoMissing?: boolean;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

function createFetch(fixture: Fixture): typeof fetch {
  const tree = fixture.tree ?? {
    tree: [
      { path: 'proj', type: 'tree', sha: 'tree-sha' },
      { path: 'proj/a.md', type: 'blob', sha: 'blob-a' }
    ]
  };

  return (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    if (url.hostname === 'raw.githubusercontent.com') {
      if (url.pathname.endsWith('/README.md')) {
        return new Response(fixture.readme);
      }
      if (url.pathname.endsWith('/.gitattributes')) {
        return fixture.gitattributes
          ? new Response(fixture.gitattributes)
          : new Response('', { status: 404 });
      }
      return new Response('', { status: 404 });
    }

    const path = url.pathname;
    if (path === '/repos/o/r') {
      return fixture.repoMissing
        ? json({ message: 'Not Found' }, 404)
        : json({ full_name: 'o/r', default_branch: 'main', private: false });
    }
    if (path === '/repos/o/r/branches') {
      return json([{ name: 'main' }]);
    }
    if (path === '/repos/o/r/git/ref/heads/main') {
      return json({ object: { sha: 'commit-sha' } });
    }
    if (path === '/repos/o/r/git/trees/commit-sha') {
      return json(tree);
    }
    if (path === '/repos/o/r/releases') {
      return json(fixture.releases);
    }
    return json({ message: 'unexpected request' }, 500);
  }) as unknown as typeof fetch;
}

async function tagFor(project: string, block: string): Promise<string> {
  const fingerprint = await computeFingerprintWith({
    project,
    text: block,
    resolveBlob: async () => ({ ok: true, blob: 'blob-a' })
  });
  if (!fingerprint.ok) {
    throw new Error(fingerprint.message);
  }
  return `ideahub-${fingerprint.hash}`;
}

async function check(fixture: Fixture) {
  return runCheck({
    input: 'https://github.com/o/r/tree/main/proj',
    token: null,
    fetchImpl: createFetch(fixture)
  });
}

describe('runCheck', () => {
  it('returns PASS for a valid proof file', async () => {
    const block = '\n🔏[doc](a.md)';
    const tag = await tagFor('proj', block);
    const result = await check({
      readme: proofFile(block),
      releases: [{ tag_name: tag, published_at: '2026-11-01T02:00:00Z', immutable: true }]
    });

    expect(result.status).toBe('PASS');
    expect(result.detail).toContain('o/r@main/proj');
  });

  it('accepts collapsed, shortcut, srcset and poster references', async () => {
    const block = [
      '🔏![a][]',
      '🔏![b]',
      '🔏![c][p]',
      '🔏<source srcset="./a.md 1x">',
      '🔏<video poster="./a.md"></video>',
      '',
      '[a]: ./a.md',
      '[b]: ./a.md',
      '[c]: ./a.md',
      '[p]: ./a.md'
    ].join('\n');
    const tag = await tagFor('proj', block);
    const result = await check({
      readme: proofFile(block),
      releases: [{ tag_name: tag, published_at: '2026-11-01T02:00:00Z', immutable: true }]
    });

    expect(result.status).toBe('PASS');
  });

  it('returns FAIL when an internal reference lacks the lock emoji', async () => {
    const result = await check({
      readme: proofFile('[doc](a.md)'),
      releases: []
    });

    expect(result.status).toBe('FAIL');
    expect(result.messages.join('\n')).toContain('缺少 🔏');
  });

  it('returns FAIL for a mutable release and ERROR when immutable is missing', async () => {
    const block = '\n🔏[doc](a.md)';
    const tag = await tagFor('proj', block);

    const mutable = await check({
      readme: proofFile(block),
      releases: [{ tag_name: tag, published_at: '2026-11-01T02:00:00Z', immutable: false }]
    });
    expect(mutable.status).toBe('FAIL');

    const unknown = await check({
      readme: proofFile(block),
      releases: [{ tag_name: tag, published_at: '2026-11-01T02:00:00Z' }]
    });
    expect(unknown.status).toBe('ERROR');
  });

  it('returns FAIL when the marker time is more than one hour from publication', async () => {
    const block = '\n🔏[doc](a.md)';
    const tag = await tagFor('proj', block);
    const result = await check({
      readme: proofFile(block),
      releases: [{ tag_name: tag, published_at: '2026-11-02T02:00:00Z', immutable: true }]
    });

    expect(result.status).toBe('FAIL');
    expect(result.messages.join('\n')).toContain('1 小时');
  });

  it('returns FAIL when a referenced file is missing from the published tree', async () => {
    const block = '\n🔏[doc](a.md)';
    const tag = await tagFor('proj', block);
    const result = await check({
      readme: proofFile(block),
      releases: [{ tag_name: tag, published_at: '2026-11-01T02:00:00Z', immutable: true }],
      tree: { tree: [{ path: 'proj', type: 'tree', sha: 'tree-sha' }] }
    });

    expect(result.status).toBe('FAIL');
    expect(result.messages.join('\n')).toContain('不存在');
  });

  it('returns ERROR for a truncated tree and for a missing repository', async () => {
    const truncated = await check({
      readme: proofFile('x'),
      releases: [],
      tree: { tree: [], truncated: true }
    });
    expect(truncated.status).toBe('ERROR');

    const missing = await check({ readme: '', releases: [], repoMissing: true });
    expect(missing.status).toBe('ERROR');
  });

  it('returns FAIL when the project uses Git LFS', async () => {
    const block = '\n🔏[doc](a.md)';
    const tag = await tagFor('proj', block);
    const result = await check({
      readme: proofFile(block),
      releases: [{ tag_name: tag, published_at: '2026-11-01T02:00:00Z', immutable: true }],
      gitattributes: '*.png filter=lfs diff=lfs merge=lfs -text'
    });

    expect(result.status).toBe('FAIL');
    expect(result.messages.join('\n')).toContain('Git LFS');
  });
});
