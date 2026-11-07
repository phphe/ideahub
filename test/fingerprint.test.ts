import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildFingerprint,
  canonicalFingerprintJson,
  normalizeProofText,
  sha256Hex
} from '../src/core/fingerprint';
import { runGit } from '../src/core/git';

const roots: string[] = [];

async function tempDir(prefix: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

interface Fixture {
  root: string;
  projectDir: string;
}

async function createRepository(files: Record<string, string> = {}): Promise<Fixture> {
  const root = await tempDir('ideahub-fingerprint-');
  expect((await runGit(root, ['init'])).code).toBe(0);
  const projectDir = path.join(root, 'MyGame');
  await fs.mkdir(projectDir, { recursive: true });
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(root, relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, 'utf8');
  }
  return { root, projectDir };
}

describe('normalizeProofText', () => {
  it('removes blank lines, trims ends, normalises CRLF and drops Published markers', () => {
    const published = '###### `Published: 2026-11-07 09:54:51 (UTC+08:00) [ideahub]`';
    const text = `\r\n  第一行  \r\n\r\n${published}\r\n\r\n第三行\r\n\r\n`;
    expect(normalizeProofText(text)).toBe('第一行  \n第三行');
  });

  it('keeps the proof marker out of the hash but leaves ordinary text alone', () => {
    const proof = '###### `Proof: 2026-11-07 10:00:00 (UTC+08:00) [ideahub]`';
    // Proof markers are block boundaries, so callers never pass them here.
    expect(normalizeProofText(`正文\n${proof}`)).toContain('Proof:');
  });
});

describe('canonicalFingerprintJson', () => {
  it('uses fixed key order, sorted file keys and compact serialisation', () => {
    const json = canonicalFingerprintJson('MyGame', 'text', { b: '2', a: '1' });
    expect(json).toBe('{"project":"MyGame","text":"text","files":{"a":"1","b":"2"}}');
  });

  it('produces the same hash for the same content regardless of input order', () => {
    const first = sha256Hex(
      canonicalFingerprintJson('MyGame', 'text', { b: '2', a: '1' })
    );
    const second = sha256Hex(
      canonicalFingerprintJson('MyGame', 'text', { a: '1', b: '2' })
    );
    expect(first).toBe(second);
  });
});

describe('buildFingerprint references', () => {
  it('inserts the reserved character before project images and links but not definitions', async () => {
    const { root, projectDir } = await createRepository({
      'MyGame/a.png': 'image',
      'MyGame/sub/doc.md': 'doc'
    });
    const text = [
      '![图片](./a.png)',
      '[文档](sub/doc.md)',
      '[引用][doc]',
      '',
      '[doc]: ./sub/doc.md'
    ].join('\n');

    const result = await buildFingerprint({
      project: 'MyGame',
      text,
      projectDir,
      repoRoot: root
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.message);
    }
    expect(result.text).toContain('🔏![图片](./a.png)');
    expect(result.text).toContain('🔏[文档](sub/doc.md)');
    expect(result.text).toContain('🔏[引用][doc]');
    expect(result.text).toContain('\n[doc]: ./sub/doc.md');
    expect(Object.keys(result.files).sort()).toEqual(['a.png', 'sub/doc.md']);
    expect(result.files['a.png']).toMatch(/^[0-9a-f]{40}$/);
  });

  it('recognises HTML img and a tags', async () => {
    const { root, projectDir } = await createRepository({
      'MyGame/pic.png': 'image',
      'MyGame/note.md': 'note'
    });
    const text = '<img src="./pic.png">\n<a href="./note.md">note</a>';

    const result = await buildFingerprint({
      project: 'MyGame',
      text,
      projectDir,
      repoRoot: root
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.message);
    }
    expect(result.text).toContain('🔏<img src="./pic.png">');
    expect(result.text).toContain('🔏<a href="./note.md">');
    expect(Object.keys(result.files).sort()).toEqual(['note.md', 'pic.png']);
  });

  it('matches git hash-object for referenced files', async () => {
    const { root, projectDir } = await createRepository({ 'MyGame/a.png': 'image' });
    const blob = (await runGit(root, ['hash-object', 'MyGame/a.png'])).stdout.trim();

    const result = await buildFingerprint({
      project: 'MyGame',
      text: '![a](a.png)',
      projectDir,
      repoRoot: root
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.message);
    }
    expect(result.files['a.png']).toBe(blob);
  });

  it('rejects text containing the reserved character', async () => {
    const { root, projectDir } = await createRepository();
    const result = await buildFingerprint({
      project: 'MyGame',
      text: '用户写了 🔏',
      projectDir,
      repoRoot: root
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('expected failure');
    }
    expect(result.code).toBe('reserved-char');
  });
});

describe('buildFingerprint external resources', () => {
  it('aborts on external images', async () => {
    const { root, projectDir } = await createRepository();
    const result = await buildFingerprint({
      project: 'MyGame',
      text: '![x](https://example.com/a.png)',
      projectDir,
      repoRoot: root
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('expected failure');
    }
    expect(result.code).toBe('external-image');
  });

  it('warns for external links and counts de-duplicated links', async () => {
    const { root, projectDir } = await createRepository();
    const result = await buildFingerprint({
      project: 'MyGame',
      text: [
        '[一](https://example.com/a)',
        '[二](https://example.com/a)',
        '<a href="https://example.com/b">三</a>'
      ].join('\n'),
      projectDir,
      repoRoot: root
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.message);
    }
    expect(result.externalLinks).toEqual([
      'https://example.com/a',
      'https://example.com/b'
    ]);
    expect(result.text).not.toContain('🔏[');
  });
});

describe('buildFingerprint path rules', () => {
  it('aborts for files inside the repository but outside the project', async () => {
    const { root, projectDir } = await createRepository({ 'other/a.png': 'x' });
    const result = await buildFingerprint({
      project: 'MyGame',
      text: '![a](../other/a.png)',
      projectDir,
      repoRoot: root
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('expected failure');
    }
    expect(result.code).toBe('outside-project');
  });

  it('aborts for paths escaping the repository', async () => {
    const { root, projectDir } = await createRepository();
    const result = await buildFingerprint({
      project: 'MyGame',
      text: '![a](../../outside.png)',
      projectDir,
      repoRoot: root
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('expected failure');
    }
    expect(result.code).toBe('outside-repo');
  });

  it('aborts for a missing file', async () => {
    const { root, projectDir } = await createRepository();
    const result = await buildFingerprint({
      project: 'MyGame',
      text: '![a](./nope.png)',
      projectDir,
      repoRoot: root
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('expected failure');
    }
    expect(result.code).toBe('missing-file');
  });

  it('aborts when the reference points to a directory', async () => {
    const { root, projectDir } = await createRepository();
    await fs.mkdir(path.join(projectDir, 'assets'), { recursive: true });
    const result = await buildFingerprint({
      project: 'MyGame',
      text: '![a](./assets)',
      projectDir,
      repoRoot: root
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('expected failure');
    }
    expect(result.code).toBe('directory');
  });
});
