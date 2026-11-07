import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runGit } from '../src/core/git';
import type { WorkspaceState } from '../src/core/status';
import { IdeahubController } from '../src/ui/controller';

const { inputBoxMock } = vi.hoisted(() => ({ inputBoxMock: vi.fn() }));

vi.mock('vscode', async () => {
  const fs = await import('node:fs/promises');
  class Position {
    constructor(
      readonly line: number,
      readonly character: number
    ) {}
  }
  class Range {
    constructor(
      readonly start: Position,
      readonly end: Position
    ) {}
  }
  interface Entry {
    text: string;
  }
  const entries = new Map<string, Entry>();
  class WorkspaceEdit {
    public op?: { key: string; text: string };
    replace(uri: { fsPath: string }, _range: Range, text: string) {
      this.op = { key: uri.fsPath, text };
    }
  }
  return {
    window: {
      showInputBox: inputBoxMock,
      showWarningMessage: vi.fn(),
      showErrorMessage: vi.fn(),
      showInformationMessage: vi.fn(),
      withProgress: vi.fn(async (_options: unknown, task: () => Promise<unknown>) => task())
    },
    workspace: {
      openTextDocument: vi.fn(async (uri: { fsPath: string }) => {
        const text = await fs.readFile(uri.fsPath, 'utf8');
        const entry: Entry = { text };
        entries.set(uri.fsPath, entry);
        return {
          getText: () => entry.text,
          positionAt: (offset: number) => ({ offset }),
          save: async () => {
            await fs.writeFile(uri.fsPath, entry.text, 'utf8');
            return true;
          }
        };
      }),
      applyEdit: vi.fn(async (edit: WorkspaceEdit) => {
        if (!edit.op) {
          return false;
        }
        const entry = entries.get(edit.op.key);
        if (!entry) {
          return false;
        }
        entry.text = edit.op.text;
        await fs.writeFile(edit.op.key, entry.text, 'utf8');
        return true;
      }),
      getConfiguration: vi.fn(() => ({
        get: <T>(_key: string, fallback: T): T => fallback
      }))
    },
    Uri: { file: (fsPath: string) => ({ fsPath }) },
    Range,
    Position,
    WorkspaceEdit,
    ProgressLocation: { Notification: 1 },
    env: { language: 'zh-cn' }
  };
});

const roots: string[] = [];

type EditResult = { ok: boolean; message: string; silent?: boolean };
type ControllerLike = { editProjectTags: (project: string) => Promise<EditResult> };

async function createProject(content: string): Promise<{ root: string; controller: unknown }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ideahub-edit-tags-'));
  roots.push(root);
  await runGit(root, ['init']);
  await runGit(root, ['config', 'user.name', 'Test']);
  await runGit(root, ['config', 'user.email', 'test@example.com']);
  await fs.mkdir(path.join(root, 'Demo'));
  await fs.writeFile(path.join(root, 'Demo', 'ideas.md'), content);
  await runGit(root, ['add', '.']);
  await runGit(root, ['commit', '-m', 'base']);

  const controller = new IdeahubController({
    appendLine: vi.fn()
  } as unknown as import('vscode').OutputChannel);
  (controller as unknown as { currentState: WorkspaceState }).currentState = {
    kind: 'local',
    root,
    remote: null,
    configError: null,
    remoteDirExists: false,
    issues: [],
    projects: []
  };
  return { root, controller };
}

afterEach(async () => {
  inputBoxMock.mockReset();
  await Promise.all(
    roots.splice(0).map((root) =>
      fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    )
  );
});

const BASE = ['---', 'title: 演示', 'tags:', '  - 游戏', '  - 写作', '---', '正文'].join('\n');

describe('editProjectTags', () => {
  it('prefills the current tags with commas and writes only the tags section', async () => {
    const { root, controller } = await createProject(BASE);
    inputBoxMock.mockResolvedValue('写作，新标签、写作, 游戏');
    const invalidate = vi.spyOn(
      controller as IdeahubController,
      'invalidateProject'
    );

    const result = await (controller as ControllerLike).editProjectTags('Demo');

    expect(inputBoxMock).toHaveBeenCalledWith(
      expect.objectContaining({ value: '游戏, 写作' })
    );
    expect(result.ok).toBe(true);
    expect(result.message).toContain('已更新标签');
    expect(
      await fs.readFile(path.join(root, 'Demo', 'ideas.md'), 'utf8')
    ).toBe(
      [
        '---',
        'title: 演示',
        'tags: ["写作", "新标签", "游戏"]',
        '---',
        '正文'
      ].join('\n')
    );
    expect(invalidate).toHaveBeenCalledWith('Demo');
  });

  it('does nothing when the input box is cancelled', async () => {
    const { root, controller } = await createProject(BASE);
    inputBoxMock.mockResolvedValue(undefined);

    const result = await (controller as ControllerLike).editProjectTags('Demo');

    expect(result).toMatchObject({ ok: false, silent: true });
    expect(await fs.readFile(path.join(root, 'Demo', 'ideas.md'), 'utf8')).toBe(BASE);
  });

  it('adds front matter for a new tag and keeps tags: [] when cleared', async () => {
    const { root, controller } = await createProject('正文\n');
    inputBoxMock.mockResolvedValueOnce('游戏');
    await (controller as ControllerLike).editProjectTags('Demo');
    expect(await fs.readFile(path.join(root, 'Demo', 'ideas.md'), 'utf8')).toBe(
      '---\ntags: ["游戏"]\n---\n\n正文\n'
    );

    inputBoxMock.mockResolvedValueOnce('');
    const cleared = await (controller as ControllerLike).editProjectTags('Demo');
    expect(cleared.ok).toBe(true);
    expect(await fs.readFile(path.join(root, 'Demo', 'ideas.md'), 'utf8')).toBe(
      '---\ntags: []\n---\n\n正文\n'
    );
  });

  it('never auto-commits or invalidates existing markers', async () => {
    const proof = '###### `Proof: 2026-01-01 00:00:00 (UTC+08:00) [ideahub]`';
    const content = `正文\n${proof}\n`;
    const { root, controller } = await createProject(content);
    inputBoxMock.mockResolvedValue('游戏');

    const result = await (controller as ControllerLike).editProjectTags('Demo');

    expect(result.ok).toBe(true);
    const text = await fs.readFile(path.join(root, 'Demo', 'ideas.md'), 'utf8');
    expect(text).toContain(proof);
    expect(text.split(/\r?\n/).filter((line) => line.startsWith('###### '))).toHaveLength(1);
    const subject = (await runGit(root, ['log', '-1', '--format=%s'])).stdout.trim();
    expect(subject).toBe('base');
  });
});
