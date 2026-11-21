import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runGit } from '@ideahub/core';
import type { WorkspaceState } from '@ideahub/core';
import { IdeahubController } from '../src/ui/controller';
import { zhL10n } from './helpers/l10n';

const vscodeMocks = vi.hoisted(() => ({
  showWarningMessage: vi.fn(),
  showInformationMessage: vi.fn()
}));

vi.mock('vscode', () => ({
  window: {
    showWarningMessage: vscodeMocks.showWarningMessage,
    showInformationMessage: vscodeMocks.showInformationMessage,
    showErrorMessage: vi.fn(),
    withProgress: vi.fn((_options: unknown, task: () => Promise<unknown>) => task())
  },
  workspace: { getConfiguration: vi.fn() },
  Uri: { file: (fsPath: string) => ({ fsPath }) },
  ProgressLocation: { Notification: 1 },
  l10n: {
    t: (message: string, ...args: unknown[]) =>
      message.replace(/\{(\d+)\}/g, (match, index) => {
        const value = args[Number(index)];
        return value === undefined ? match : String(value);
      })
  },
  env: { language: 'zh-cn' }
}));

const roots: string[] = [];

async function tempRoot(prefix: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  roots.push(root);
  return root;
}

afterEach(async () => {
  vi.clearAllMocks();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

function controllerFor(root: string): IdeahubController {
  const controller = new IdeahubController(
    { appendLine: vi.fn() } as unknown as import('vscode').OutputChannel
  );
  (controller as unknown as { currentState: WorkspaceState }).currentState = {
    kind: 'not-ideahub',
    root
  };
  return controller;
}

describe('explicit init in a non-empty folder', () => {
  it('does nothing when the modal confirmation is cancelled', async () => {
    const root = await tempRoot('ideahub-nonempty-cancel-');
    await fs.writeFile(path.join(root, 'keep.txt'), 'user content', 'utf8');
    vscodeMocks.showWarningMessage.mockResolvedValue(undefined);

    const result = await controllerFor(root).initialize(true);

    expect(result).toMatchObject({ ok: false, silent: true });
    expect(vscodeMocks.showWarningMessage).toHaveBeenCalledTimes(1);
    const confirmation = vscodeMocks.showWarningMessage.mock.calls[0][0] as string;
    expect(confirmation).toContain('A .git/ will be created in this folder');
    expect(confirmation).toContain('.ideahub/');
    expect(confirmation).toContain('README.md will be created');
    expect(confirmation).toContain('No existing files will be overwritten');
    expect(confirmation).toContain('nothing will be pushed or published automatically');
    expect(confirmation).not.toContain('Detected an existing');

    await expect(fs.access(path.join(root, '.git'))).rejects.toThrow();
    await expect(fs.access(path.join(root, '.ideahub'))).rejects.toThrow();
    await expect(fs.access(path.join(root, 'README.md'))).rejects.toThrow();
    expect(await fs.readFile(path.join(root, 'keep.txt'), 'utf8')).toBe('user content');
  });

  it('mentions reusing an existing .git instead of creating one', async () => {
    const root = await tempRoot('ideahub-nonempty-git-copy-');
    expect((await runGit(root, ['init'])).code).toBe(0);
    await fs.writeFile(path.join(root, 'keep.txt'), 'user content', 'utf8');
    vscodeMocks.showWarningMessage.mockResolvedValue(undefined);

    const result = await controllerFor(root).initialize(true);

    expect(result).toMatchObject({ ok: false, silent: true });
    const confirmation = vscodeMocks.showWarningMessage.mock.calls[0][0] as string;
    expect(confirmation).toContain('Detected an existing .git/');
    expect(confirmation).toContain('will not reinitialize or overwrite it');
    expect(confirmation).toContain('.ideahub/');
    expect(confirmation).toContain('README.md will be created');
    expect(confirmation).toContain('No existing files will be overwritten');
    expect(confirmation).toContain('nothing will be pushed or published automatically');
    expect(confirmation).not.toContain('A .git/ will be created in this folder');
  });

  it('creates the structure and skips an existing README.md', async () => {
    const root = await tempRoot('ideahub-nonempty-readme-');
    await fs.writeFile(path.join(root, 'README.md'), '# my own readme', 'utf8');
    await fs.writeFile(path.join(root, 'keep.txt'), 'user content', 'utf8');
    vscodeMocks.showWarningMessage.mockResolvedValue('Initialize anyway');

    const result = await controllerFor(root).initialize(true);

    expect(result.ok).toBe(true);
    expect(result.message.startsWith('Initialization succeeded:')).toBe(true);
    expect(result.message).toContain(
      'README.md already exists, so the existing README.md was kept (not overwritten).'
    );
    expect(result.message).not.toContain('overwrite README.md');
    const confirmation = vscodeMocks.showWarningMessage.mock.calls[0][0] as string;
    expect(confirmation).toContain('will be kept');
    expect(confirmation).not.toContain('overwrite README.md');
    expect(await fs.readFile(path.join(root, 'README.md'), 'utf8')).toBe('# my own readme');
    expect(await fs.readFile(path.join(root, 'keep.txt'), 'utf8')).toBe('user content');
    await expect(fs.access(path.join(root, '.git'))).resolves.toBeUndefined();
    await expect(fs.access(path.join(root, '.ideahub', 'config.json'))).resolves.toBeUndefined();
  });

  it('reuses an existing .git and .ideahub without overwriting them', async () => {
    const root = await tempRoot('ideahub-nonempty-git-');
    expect((await runGit(root, ['init'])).code).toBe(0);
    await runGit(root, ['config', 'user.name', 'Test']);
    await runGit(root, ['config', 'user.email', 'test@example.com']);
    await fs.writeFile(path.join(root, 'notes.md'), 'base', 'utf8');
    await runGit(root, ['add', '-A']);
    expect((await runGit(root, ['commit', '-m', 'base'])).code).toBe(0);
    const beforeHead = (await runGit(root, ['rev-parse', 'HEAD'])).stdout.trim();

    await fs.mkdir(path.join(root, '.ideahub'), { recursive: true });
    await fs.writeFile(path.join(root, '.ideahub', 'config.json'), '{"version":99}', 'utf8');
    await fs.writeFile(path.join(root, '.ideahub', '.gitignore'), 'custom-ignore\n', 'utf8');
    vscodeMocks.showWarningMessage.mockResolvedValue('Initialize anyway');

    const result = await controllerFor(root).initialize(true);

    expect(result.ok).toBe(true);
    expect(result.message).toContain('reused it as the Git repository');
    await expect(fs.access(path.join(root, 'README.md'))).resolves.toBeUndefined();
    expect((await runGit(root, ['rev-parse', 'HEAD'])).stdout.trim()).not.toBe(beforeHead);
    expect((await runGit(root, ['log', '-1', '--format=%s'])).stdout.trim()).toBe(
      'ideahub: initialize repository'
    );
    const committed = (await runGit(root, ['show', '--name-only', '--format=', 'HEAD'])).stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    expect(committed).toEqual(['README.md']);
    expect(await fs.readFile(path.join(root, '.ideahub', 'config.json'), 'utf8')).toBe(
      '{"version":99}'
    );
    expect(await fs.readFile(path.join(root, '.ideahub', '.gitignore'), 'utf8')).toBe(
      'custom-ignore\n'
    );
  });

  it('keeps the empty-folder-only guard for the default button', async () => {
    const root = await tempRoot('ideahub-nonempty-guard-');
    await fs.writeFile(path.join(root, 'keep.txt'), 'user content', 'utf8');
    const controller = controllerFor(root);

    const result = await controller.initialize();

    expect(result).toEqual({
      ok: false,
      message: 'Initialization is not allowed in the current state.'
    });
    expect(vscodeMocks.showWarningMessage).not.toHaveBeenCalled();
    await expect(fs.access(path.join(root, 'README.md'))).rejects.toThrow();
  });

  it('returns Chinese controller messages when the zh translator is injected', async () => {
    const controller = new IdeahubController(
      { appendLine: vi.fn() } as unknown as import('vscode').OutputChannel,
      zhL10n()
    );

    const result = await controller.initialize();

    expect(result).toEqual({
      ok: false,
      message: '当前状态不允许初始化。'
    });
  });
});
