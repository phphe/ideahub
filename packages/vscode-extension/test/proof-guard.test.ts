import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runGit } from '@ideahub/core';
import { appendMarkerLine, computeProofHash } from '@ideahub/core';
import type { WorkspaceState } from '@ideahub/core';
import { IdeahubController } from '../src/ui/controller';

const { createReleaseMock, existingReleaseMock } = vi.hoisted(() => ({
  createReleaseMock: vi.fn(),
  existingReleaseMock: vi.fn()
}));

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

vi.mock('../src/ui/auth', () => ({
  getGitHubToken: vi.fn(async () => 'token')
}));

vi.mock('@ideahub/core', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@ideahub/core')>();
  class GitHubApiError extends Error {}
  class GitHubClient {
    async getRepository() {
      return { defaultBranch: 'release' };
    }
    async getReleaseByTag() {
      return existingReleaseMock();
    }
    async createRelease(...args: unknown[]) {
      return createReleaseMock(...args);
    }
  }
  return {
    ...actual,
    GitHubClient,
    GitHubApiError,
    ensureReleaseTarget: vi.fn(async () => ({
      ok: true,
      target: { branch: 'release', sha: 'abc123def456', defaultBranch: 'release' }
    }))
  };
});

const ORIGINAL = '创意原文\n';
const REMOTE = {
  provider: 'github' as const,
  owner: 'owner',
  repo: 'repo',
  url: 'https://github.com/owner/repo.git',
  branch: 'release'
};
const roots: string[] = [];

async function createProject(content = ORIGINAL): Promise<{ root: string; controller: unknown }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ideahub-proof-guard-'));
  roots.push(root);
  await runGit(root, ['init']);
  await runGit(root, ['config', 'user.name', 'Test']);
  await runGit(root, ['config', 'user.email', 'test@example.com']);
  await fs.mkdir(path.join(root, 'MyGame'));
  await fs.writeFile(path.join(root, 'MyGame', 'ideas.md'), content);
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

type MarkResult = { ok: boolean; message: string; silent?: boolean };
type ControllerLike = { markProject: (project: string) => Promise<MarkResult> };

afterEach(async () => {
  createReleaseMock.mockReset();
  existingReleaseMock.mockReset();
  await Promise.all(
    roots.splice(0).map((root) =>
      fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    )
  );
});

describe('markProject guard and release payload', { timeout: 20000 }, () => {
  it('ignores a second proof request and creates only one release and marker', async () => {
    const { root, controller } = await createProject();
    let resolveRelease!: (value: unknown) => void;
    createReleaseMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRelease = resolve;
        })
    );
    existingReleaseMock.mockReturnValue(Promise.resolve(null));
    const typed = controller as ControllerLike;

    const first = typed.markProject('MyGame');
    await vi.waitFor(() => expect(createReleaseMock).toHaveBeenCalledTimes(1));
    const second = await typed.markProject('MyGame');

    expect(second).toMatchObject({ ok: true, silent: true });
    expect(createReleaseMock).toHaveBeenCalledTimes(1);

    resolveRelease({ created: true, release: { publishedAt: '2026-11-06T10:33:28Z', immutable: true } });
    await first;

    const args = createReleaseMock.mock.calls[0] as string[];
    expect(args[2]).toMatch(
      new RegExp(`^ideahub-${computeProofHash('MyGame', '创意原文')}$`)
    );
    expect(args[3]).toMatch(/^2026-\d{2}-\d{2} \d{2}:\d{2}:\d{2} \(UTC[+-]\d{2}:\d{2}\)$/);
    expect(args[3]).not.toContain('sha256=');

    const current = await fs.readFile(path.join(root, 'MyGame', 'ideas.md'), 'utf8');
    expect(current.match(/Proof:/g)).toHaveLength(1);
    const markerLine = current.trimEnd().split(/\r?\n/).pop() as string;
    expect(markerLine).toMatch(/^###### `Proof: .+ \[ideahub\]`$/);
    expect(current).toBe(appendMarkerLine(ORIGINAL, markerLine));

    const subject = (await runGit(root, ['log', '-1', '--format=%s'])).stdout.trim();
    expect(subject).toBe('ideahub: record proof');
    const stat = (await runGit(root, ['show', '--stat', '--format=', 'HEAD'])).stdout;
    expect(stat).toContain('1 file changed, 2 insertions(+)');
  });

  it('treats an existing release for the same hash as idempotent and does not create a new one', async () => {
    const { root, controller } = await createProject(`旧内容\n###### \`Proof: 2026-11-01 10:00:00 (UTC+08:00) [ideahub]\`\n新内容\n`);
    existingReleaseMock.mockReturnValue(
      Promise.resolve({ publishedAt: '2026-11-06T10:33:28Z', immutable: true })
    );

    const result = await (controller as ControllerLike).markProject('MyGame');

    expect(result.ok).toBe(true);
    expect(result.message).toContain('证明已存在');
    expect(createReleaseMock).not.toHaveBeenCalled();
    const current = await fs.readFile(path.join(root, 'MyGame', 'ideas.md'), 'utf8');
    expect(current.match(/Proof:/g)).toHaveLength(2);
  });
});
