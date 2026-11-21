import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GitHubClient, runGit } from '@ideahub/core';
import type { WorkspaceState } from '@ideahub/core';
import { IdeahubController } from '../src/ui/controller';

const { applyEditMock, saveMock } = vi.hoisted(() => ({
  applyEditMock: vi.fn(async () => true),
  saveMock: vi.fn(async () => true)
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
      showWarningMessage: vi.fn(),
      showErrorMessage: vi.fn(),
      showInformationMessage: vi.fn(),
      withProgress: vi.fn((_options: unknown, task: () => unknown) => task())
    },
    workspace: {
      openTextDocument: vi.fn(),
      applyEdit: applyEditMock,
      getConfiguration: vi.fn()
    },
    Uri: { file: (fsPath: string) => ({ fsPath }) },
    Range,
    Position,
    WorkspaceEdit,
    ProgressLocation: { Notification: 1 },
    l10n: {
      t: (message: string, ...args: unknown[]) =>
        message.replace(/\{(\d+)\}/g, (match, index) => {
          const value = args[Number(index)];
          return value === undefined ? match : String(value);
        })
    },
    env: { language: 'en' }
  };
});

vi.mock('../src/ui/auth', () => ({
  getGitHubToken: vi.fn(async () => 'token')
}));

const REMOTE = {
  provider: 'github' as const,
  owner: 'owner',
  repo: 'repo',
  url: 'https://github.com/owner/repo.git',
  branch: 'release'
};
const roots: string[] = [];
const BASE = 'My idea\n';

async function createProject(): Promise<{ root: string; controller: IdeahubController }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ideahub-mark-immutable-'));
  roots.push(root);
  await runGit(root, ['init']);
  await runGit(root, ['config', 'user.name', 'Test']);
  await runGit(root, ['config', 'user.email', 'test@example.com']);
  await fs.mkdir(path.join(root, 'MyGame'));
  await fs.writeFile(path.join(root, 'MyGame', 'ideas.md'), BASE);
  await runGit(root, ['add', '.']);
  await runGit(root, ['commit', '-m', 'base']);

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

async function mockDocument(text: string): Promise<void> {
  const vscode = await import('vscode');
  const open = vscode.workspace.openTextDocument as unknown as {
    mockResolvedValue: (value: unknown) => void;
  };
  open.mockResolvedValue({
    getText: () => text,
    positionAt: () => new vscode.Position(0, text.length),
    save: saveMock
  });
}

beforeEach(() => {
  applyEditMock.mockClear();
  saveMock.mockClear();
  vi.spyOn(GitHubClient.prototype, 'getRepository').mockResolvedValue({
    fullName: 'owner/repo',
    isPrivate: false,
    defaultBranch: 'main',
    canPush: false
  });
  vi.spyOn(GitHubClient.prototype, 'getCommit').mockResolvedValue(null);
  vi.spyOn(GitHubClient.prototype, 'getEarliestCommit').mockResolvedValue({
    sha: 'a'.repeat(40)
  });
  vi.spyOn(GitHubClient.prototype, 'createRelease').mockResolvedValue({
    created: true,
    release: {
      id: 1,
      tagName: 'ideahub-test',
      immutable: false,
      publishedAt: null
    }
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    roots.splice(0).map((root) =>
      fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    )
  );
});

describe('markProject immutable Release check', () => {
  it('fails with an error and leaves ideas.md untouched when immutability is disabled', async () => {
    const { root, controller } = await createProject();
    await mockDocument(BASE);
    const before = (await runGit(root, ['rev-parse', 'HEAD'])).stdout.trim();

    const result = await controller.markProject('MyGame');

    expect(result.ok).toBe(false);
    expect(result.message.startsWith('Proof failed: the Release is not immutable.')).toBe(true);
    expect(result.message).toContain('The remote proof repository has immutable Releases disabled.');
    expect(result.message).toContain('No marker was written to ideas.md.');
    expect(applyEditMock).not.toHaveBeenCalled();
    expect(saveMock).not.toHaveBeenCalled();
    expect(await fs.readFile(path.join(root, 'MyGame', 'ideas.md'), 'utf8')).toBe(BASE);
    expect((await runGit(root, ['rev-parse', 'HEAD'])).stdout.trim()).toBe(before);
  });
});
