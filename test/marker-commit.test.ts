import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runGit } from '../src/core/git';
import {
  commitMarkerLine,
  DEFAULT_MARKER_COMMIT_MESSAGE,
  resolveCommitMessage
} from '../src/core/marker-commit';
import { appendMarker } from '../src/core/ideas';

const HASH = 'a'.repeat(64);
const DATE = '2026-11-05';
const BASE = '第一行\n\n第二行\n';
const roots: string[] = [];

async function createRepo(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ideahub-commit-'));
  roots.push(root);
  await runGit(root, ['init']);
  await runGit(root, ['config', 'user.name', 'Test']);
  await runGit(root, ['config', 'user.email', 'test@example.com']);
  await fs.mkdir(path.join(root, 'MyGame'));
  await fs.writeFile(path.join(root, 'MyGame', 'ideas.md'), BASE);
  await runGit(root, ['add', '.']);
  await runGit(root, ['commit', '-m', 'base']);
  return root;
}

async function headSha(root: string): Promise<string> {
  return (await runGit(root, ['rev-parse', 'HEAD'])).stdout.trim();
}

function options(root: string, enabled = true) {
  return {
    root,
    project: 'MyGame',
    hash: HASH,
    date: DATE,
    message: 'feat(ideas): record proof for MyGame',
    enabled
  };
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))
  );
});

describe('resolveCommitMessage', () => {
  it('replaces known placeholders', () => {
    expect(
      resolveCommitMessage('{project} {hash} {date}', {
        project: 'MyGame',
        hash: HASH,
        date: DATE
      })
    ).toBe(`MyGame ${HASH} ${DATE}`);
  });

  it('keeps unknown placeholders verbatim', () => {
    expect(
      resolveCommitMessage('proof {project} {unknown}', {
        project: 'MyGame',
        hash: HASH,
        date: DATE
      })
    ).toBe('proof MyGame {unknown}');
  });

  it('falls back to the default for empty or whitespace templates', () => {
    expect(resolveCommitMessage('', { project: 'MyGame', hash: HASH, date: DATE })).toBe(
      DEFAULT_MARKER_COMMIT_MESSAGE.replace('{project}', 'MyGame')
    );
    expect(resolveCommitMessage('   ', { project: 'MyGame', hash: HASH, date: DATE })).toBe(
      'feat(ideas): record proof for MyGame'
    );
  });
});

describe('commitMarkerLine', () => {
  it('commits only the marker line even when ideas.md has uncommitted content', async () => {
    const root = await createRepo();
    const ideasPath = path.join(root, 'MyGame', 'ideas.md');
    const working = `${BASE}新增内容\n`;
    await fs.writeFile(ideasPath, working);
    await fs.writeFile(path.join(root, 'other.txt'), 'user work\n');
    await runGit(root, ['add', 'other.txt']);

    const result = await commitMarkerLine(options(root));

    expect(result.status).toBe('committed');
    const nameOnly = (await runGit(root, ['show', '--name-only', '--format=', 'HEAD'])).stdout
      .trim()
      .split(/\r?\n/);
    expect(nameOnly).toEqual(['MyGame/ideas.md']);

    const stat = (await runGit(root, ['show', '--stat', '--format=', 'HEAD'])).stdout;
    expect(stat).toContain('1 file changed, 1 insertion(+)');

    const committed = (await runGit(root, ['show', 'HEAD:MyGame/ideas.md'])).stdout;
    expect(committed).toBe(appendMarker(BASE, HASH, DATE));
    expect(committed).not.toContain('新增内容');

    // The user's working copy and staged files are untouched.
    expect(await fs.readFile(ideasPath, 'utf8')).toBe(working);
    const staged = (await runGit(root, ['diff', '--cached', '--name-only'])).stdout;
    expect(staged.trim()).toBe('other.txt');
  });

  it('does not commit when auto commit is disabled', async () => {
    const root = await createRepo();
    const before = await headSha(root);

    const result = await commitMarkerLine(options(root, false));

    expect(result).toEqual({
      status: 'skipped',
      reason: '自动提交已关闭（ideahub.mark.autoCommit=false）',
      silent: true
    });
    expect(await headSha(root)).toBe(before);
  });

  it('skips when ideas.md already has staged changes', async () => {
    const root = await createRepo();
    const ideasPath = path.join(root, 'MyGame', 'ideas.md');
    await fs.writeFile(ideasPath, `${BASE}用户暂存内容\n`);
    await runGit(root, ['add', 'MyGame/ideas.md']);
    const before = await headSha(root);

    const result = await commitMarkerLine(options(root));

    expect(result.status).toBe('skipped');
    expect(result.silent).toBe(false);
    expect(result.reason).toContain('暂存区');
    expect(await headSha(root)).toBe(before);
    expect((await runGit(root, ['diff', '--cached', '--name-only'])).stdout.trim()).toBe(
      'MyGame/ideas.md'
    );
  });

  it('skips when ideas.md is not tracked yet', async () => {
    const root = await createRepo();
    await fs.mkdir(path.join(root, 'NewGame'));
    await fs.writeFile(path.join(root, 'NewGame', 'ideas.md'), BASE);
    const before = await headSha(root);

    const result = await commitMarkerLine({ ...options(root), project: 'NewGame' });

    expect(result.status).toBe('skipped');
    expect(result.reason).toContain('尚未纳入');
    expect(await headSha(root)).toBe(before);
  });
});
