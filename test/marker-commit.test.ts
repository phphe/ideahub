import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runGit } from '../src/core/git';
import {
  commitMarkerLine,
  DEFAULT_PROOF_COMMIT_MESSAGE,
  DEFAULT_PUBLISH_COMMIT_MESSAGE,
  resolveCommitMessage
} from '../src/core/marker-commit';
import { appendMarkerLine } from '../src/core/ideas';

const TIME = '2026-11-06 18:33:28 (UTC+08:00)';
const PROOF_TEXT = `Proof: ${TIME} [ideahub]`;
const PUBLISHED_TEXT = `Published: ${TIME} [ideahub]`;
const PROOF_LINE = `###### \`${PROOF_TEXT}\``;
const PUBLISHED_LINE = `###### \`${PUBLISHED_TEXT}\``;
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

async function headSubject(root: string): Promise<string> {
  return (await runGit(root, ['log', '-1', '--format=%s'])).stdout.trim();
}

function options(root: string, markerLine = PROOF_LINE, enabled = true, message = 'proof commit') {
  return {
    root,
    project: 'MyGame',
    markerLine,
    message,
    enabled
  };
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) =>
      fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    )
  );
});

describe('resolveCommitMessage', () => {
  it('replaces the project and time placeholders', () => {
    expect(
      resolveCommitMessage('{project} at {time}', { project: 'MyGame', time: TIME })
    ).toBe(`MyGame at ${TIME}`);
  });

  it('keeps unknown placeholders verbatim', () => {
    expect(
      resolveCommitMessage('proof {project} {unknown}', { project: 'MyGame', time: TIME })
    ).toBe('proof MyGame {unknown}');
  });

  it('falls back to the proof or publish default for empty templates', () => {
    expect(resolveCommitMessage('', { project: 'MyGame', time: TIME })).toBe(
      'feat(ideas): record proof for MyGame'
    );
    expect(
      resolveCommitMessage('   ', { project: 'MyGame', time: TIME }, DEFAULT_PUBLISH_COMMIT_MESSAGE)
    ).toBe('feat(ideas): mark MyGame as published');
  });
});

describe('commitMarkerLine', { timeout: 20000 }, () => {
  it('commits only the proof marker line even when ideas.md has uncommitted content', async () => {
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
    expect(stat).toContain('1 file changed, 2 insertions(+)');

    const committed = (await runGit(root, ['show', 'HEAD:MyGame/ideas.md'])).stdout;
    expect(committed).toBe(appendMarkerLine(BASE, PROOF_LINE));
    expect(committed).not.toContain('新增内容');

    // The user's working copy and staged files are untouched.
    expect(await fs.readFile(ideasPath, 'utf8')).toBe(working);
    const staged = (await runGit(root, ['diff', '--cached', '--name-only'])).stdout;
    expect(staged.trim()).toBe('other.txt');
  });

  it('adds a leading newline when the committed content has none', async () => {
    const root = await createRepo();
    const ideasPath = path.join(root, 'MyGame', 'ideas.md');
    await fs.writeFile(ideasPath, '第一行\n\n第二行');
    await runGit(root, ['add', 'MyGame/ideas.md']);
    await runGit(root, ['commit', '-m', 'no trailing newline']);
    await fs.writeFile(ideasPath, '第一行\n\n第二行');

    const result = await commitMarkerLine(options(root));

    expect(result.status).toBe('committed');
    const committed = (await runGit(root, ['show', 'HEAD:MyGame/ideas.md'])).stdout;
    expect(committed).toBe(`第一行\n\n第二行\n\n${PROOF_LINE}\n`);
  });

  it('commits only the published marker line', async () => {
    const root = await createRepo();

    const result = await commitMarkerLine(options(root, PUBLISHED_LINE, true, 'publish commit'));

    expect(result.status).toBe('committed');
    const stat = (await runGit(root, ['show', '--stat', '--format=', 'HEAD'])).stdout;
    expect(stat).toContain('1 file changed, 2 insertions(+)');
    const committed = (await runGit(root, ['show', 'HEAD:MyGame/ideas.md'])).stdout;
    expect(committed).toBe(appendMarkerLine(BASE, PUBLISHED_LINE));
    expect(await headSubject(root)).toBe('publish commit');
  });

  it('does not commit either marker kind when ideahub.proof.autoCommit is disabled', async () => {
    const root = await createRepo();
    const before = await headSha(root);

    for (const markerLine of [PROOF_LINE, PUBLISHED_LINE]) {
      const result = await commitMarkerLine(options(root, markerLine, false));
      expect(result).toEqual({
        status: 'skipped',
        reason: '自动提交已关闭（ideahub.proof.autoCommit=false）',
        silent: true
      });
      expect(await headSha(root)).toBe(before);
    }
  });

  it('uses the proof and publish commit messages independently', async () => {
    const root = await createRepo();
    const proof = resolveCommitMessage(
      DEFAULT_PROOF_COMMIT_MESSAGE,
      { project: 'MyGame', time: TIME }
    );
    const publish = resolveCommitMessage(
      DEFAULT_PUBLISH_COMMIT_MESSAGE,
      { project: 'MyGame', time: TIME }
    );

    await commitMarkerLine(options(root, PROOF_LINE, true, proof));
    expect(await headSubject(root)).toBe('feat(ideas): record proof for MyGame');

    await commitMarkerLine(options(root, PUBLISHED_LINE, true, publish));
    expect(await headSubject(root)).toBe('feat(ideas): mark MyGame as published');
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
