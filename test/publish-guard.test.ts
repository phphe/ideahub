import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runGit } from '../src/core/git';
import type { WorkspaceState } from '../src/core/status';
import { IdeahubController } from '../src/ui/controller';

const { warningMock } = vi.hoisted(() => ({
  warningMock: vi.fn()
}));

vi.mock('vscode', () => {
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
  class WorkspaceEdit {
    replace = vi.fn();
  }
  return {
    window: {
      showWarningMessage: warningMock,
      showErrorMessage: vi.fn(),
      showInformationMessage: vi.fn(),
      withProgress: vi.fn()
    },
    workspace: {
      openTextDocument: vi.fn(),
      applyEdit: vi.fn(),
      getConfiguration: vi.fn()
    },
    Uri: { file: (fsPath: string) => ({ fsPath }) },
    Range,
    Position,
    WorkspaceEdit,
    ProgressLocation: { Notification: 1 },
    env: { language: 'zh-cn' }
  };
});

const PROOF = '`Proof: 2026-11-06 18:33:28 (UTC+08:00) [ideahub]`';
const REMOTE = {
  provider: 'github' as const,
  owner: 'owner',
  repo: 'repo',
  url: 'https://github.com/owner/repo.git',
  branch: 'release'
};
const roots: string[] = [];

async function createProject(content: string): Promise<{ root: string; controller: unknown }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ideahub-publish-guard-'));
  roots.push(root);
  await runGit(root, ['init']);
  await runGit(root, ['config', 'user.name', 'Test']);
  await runGit(root, ['config', 'user.email', 'test@example.com']);
  await fs.mkdir(path.join(root, 'MyGame'));
  await fs.writeFile(path.join(root, 'MyGame', 'ideas.md'), content);
  await runGit(root, ['add', '.']);
  await runGit(root, ['commit', '-m', 'base']);

  const remotePath = path.join(root, '.ideahub', 'remote');
  await fs.mkdir(remotePath, { recursive: true });
  const initRemote = await runGit(remotePath, ['init']);
  expect(initRemote.code).toBe(0);
  const commitRemote = await runGit(remotePath, [
    '-c',
    'user.email=test@example.com',
    '-c',
    'user.name=Test',
    'commit',
    '--allow-empty',
    '-m',
    'inner head'
  ]);
  expect(commitRemote.code).toBe(0);

  const controller = new IdeahubController({
    appendLine: vi.fn()
  } as unknown as import('vscode').OutputChannel);
  (controller as unknown as { currentState: WorkspaceState }).currentState = {
    kind: 'local',
    root,
    remote: REMOTE,
    configError: null,
    remoteDirExists: false,
    issues: [],
    projects: []
  };
  return { root, controller };
}

async function head(root: string): Promise<string> {
  return (await runGit(root, ['rev-parse', 'HEAD'])).stdout.trim();
}

beforeEach(() => {
  warningMock.mockReset();
});

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) =>
      fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    )
  );
});

describe('publishProject precondition', { timeout: 30000 }, () => {
  it('blocks unproven content before writing, committing, copying or confirming', async () => {
    const { root, controller } = await createProject(`创意\n${PROOF}\n新增内容\n`);
    const before = await head(root);

    const result = await (
      controller as { publishProject: (project: string) => Promise<{ ok: boolean; message: string }> }
    ).publishProject('MyGame');

    expect(result).toEqual({ ok: false, message: '存在未证明的新内容，请先证明' });
    expect(warningMock).not.toHaveBeenCalled();
    expect(await head(root)).toBe(before);
    expect(await fs.readFile(path.join(root, 'MyGame', 'ideas.md'), 'utf8')).toBe(
      `创意\n${PROOF}\n新增内容\n`
    );
    await expect(fs.access(path.join(root, '.ideahub', 'remote', 'MyGame'))).rejects.toThrow();
  });

  it('ignores the second publish request while the first is awaiting confirmation', async () => {
    const { controller } = await createProject(`创意\n${PROOF}\n`);
    let resolveWarning!: (value: unknown) => void;
    warningMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveWarning = resolve;
        })
    );
    const typed = controller as {
      publishProject: (project: string) => Promise<{
        ok: boolean;
        message: string;
        silent?: boolean;
      }>;
    };

    const first = typed.publishProject('MyGame');
    await vi.waitFor(() => expect(warningMock).toHaveBeenCalledTimes(1));
    const second = await typed.publishProject('MyGame');

    expect(second).toMatchObject({ ok: true, silent: true });
    expect(warningMock).toHaveBeenCalledTimes(1);

    // Resolve the first confirmation so the guard can be released.
    resolveWarning('取消');
    expect(await first).toMatchObject({ ok: false, message: '已取消发布。' });
  });
});
