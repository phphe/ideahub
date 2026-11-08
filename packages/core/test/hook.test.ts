import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildHookBlock,
  hasHookBlock,
  isHookTargetCurrent,
  mergeHook,
  readHookTarget
} from '../src/hook';

const target = { owner: 'Owner', repo: 'MyIdeas' };

describe('mergeHook', () => {
  it('creates a hook with a shebang when the file is empty', () => {
    const merged = mergeHook('', buildHookBlock(target));
    expect(merged.startsWith('#!/bin/sh\n')).toBe(true);
    expect(hasHookBlock(merged)).toBe(true);
    expect(readHookTarget(merged)?.owner).toBe('Owner');
    expect(readHookTarget(merged)?.repo).toBe('MyIdeas');
  });

  it('preserves user content and shebang when appending', () => {
    const existing = '#!/bin/sh\n# custom logic\necho hello\n';
    const merged = mergeHook(existing, buildHookBlock(target));
    expect(merged.startsWith('#!/bin/sh\n# custom logic\necho hello\n')).toBe(true);
    expect(hasHookBlock(merged)).toBe(true);
  });

  it('replaces only the managed block and is idempotent', () => {
    const first = mergeHook('#!/bin/sh\n# custom\n', buildHookBlock(target));
    const second = mergeHook(first, buildHookBlock({ owner: 'NewOwner', repo: 'NewRepo' }));
    expect(second).toContain('# custom');
    expect(readHookTarget(second)?.owner).toBe('NewOwner');
    expect(mergeHook(second, buildHookBlock({ owner: 'NewOwner', repo: 'NewRepo' }))).toBe(second);
  });

  it('compares targets case-insensitively and accepts an empty target', () => {
    expect(isHookTargetCurrent(buildHookBlock(target), target)).toBe(true);
    expect(
      isHookTargetCurrent(buildHookBlock(target), { owner: 'owner', repo: 'myideas' })
    ).toBe(true);
    expect(isHookTargetCurrent(buildHookBlock(target), { owner: 'other', repo: 'x' })).toBe(false);
    expect(isHookTargetCurrent(buildHookBlock(null), null)).toBe(true);
    expect(hasHookBlock(buildHookBlock(null))).toBe(true);
  });
});

function bashCandidates(): string[] {
  const candidates = ['bash', 'bash.exe', 'C:\\Program Files\\Git\\bin\\bash.exe'];
  try {
    const execPath = execFileSync('git', ['--exec-path'], { encoding: 'utf8' }).trim();
    candidates.push(
      path.resolve(execPath, '..', '..', '..', 'bin', 'bash.exe'),
      path.resolve(execPath, '..', '..', '..', 'usr', 'bin', 'bash.exe')
    );
  } catch {
    // Git may not be available; other candidates are still tried.
  }
  return candidates;
}

function findBash(): string | null {
  for (const candidate of bashCandidates()) {
    try {
      execFileSync(candidate, ['-c', 'echo ok'], { stdio: 'ignore' });
      return candidate;
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

const bashPath = findBash();

function runHook(scriptPath: string, remoteUrl: string): number {
  try {
    execFileSync(bashPath!, [scriptPath, 'origin', remoteUrl], { input: '', stdio: 'pipe' });
    return 0;
  } catch (error) {
    return (error as { status?: number }).status ?? 1;
  }
}

describe.skipIf(!bashPath)('pre-push hook script', () => {
  async function writeHook(owner: string, repo: string): Promise<string> {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ideahub-hook-'));
    const scriptPath = path.join(directory, 'pre-push');
    const content = mergeHook('', buildHookBlock({ owner, repo }));
    await fs.writeFile(scriptPath, content, 'utf8');
    return scriptPath;
  }

  it('blocks pushes to the remote idea repository in https and ssh forms', async () => {
    const script = await writeHook('owner', 'repo');
    expect(runHook(script, 'https://github.com/owner/repo.git')).toBe(1);
    expect(runHook(script, 'git@github.com:owner/repo.git')).toBe(1);
    expect(runHook(script, 'https://github.com/other/repo.git')).toBe(0);
    await fs.rm(path.dirname(script), { recursive: true, force: true });
  });

  it('allows any push when no target is stored yet', async () => {
    const script = await writeHook('', '');
    expect(runHook(script, 'https://github.com/owner/repo.git')).toBe(0);
    await fs.rm(path.dirname(script), { recursive: true, force: true });
  });
});
