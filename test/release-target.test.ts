import { describe, expect, it, vi } from 'vitest';
import {
  buildReleaseTag,
  ensureReleaseTarget,
  parseLsRemoteRef,
  resolveReleaseTarget,
  validateBranchName,
  validateTagName,
  type BranchLookup
} from '../src/core/release-target';

describe('buildReleaseTag / validateTagName', () => {
  it('derives ideahub-<64hex> from the content hash', () => {
    const hash = 'a'.repeat(64);
    const result = buildReleaseTag(hash);
    expect(result.tag).toBe(`ideahub-${hash}`);
    expect(result.tag).toMatch(/^[A-Za-z0-9-]+$/);
    expect(validateTagName(result.tag)).toBeNull();
  });

  it('normalises upper-case hashes to lower-case', () => {
    expect(buildReleaseTag('ABCDEF').tag).toBe('ideahub-abcdef');
  });

  it('rejects tags with spaces, "..", trailing dots and .lock segments', () => {
    expect(validateTagName('ideahub-bad tag')).toContain('不允许的字符');
    expect(validateTagName('ideahub-a..b')).toContain('..');
    expect(validateTagName('ideahub-.')).toContain('结尾');
    expect(validateTagName('ideahub-.lock')).toContain('.lock');
    expect(validateTagName('/ideahub')).toContain('开头');
  });

  it('rejects empty and overly long tags', () => {
    expect(validateTagName('')).toContain('为空');
    expect(validateTagName('a'.repeat(121))).toContain('120');
  });
});

describe('validateBranchName', () => {
  it('accepts normal branch names and rejects illegal ones', () => {
    expect(validateBranchName('main')).toBeNull();
    expect(validateBranchName('release/empty')).toBeNull();
    expect(validateBranchName('')).toContain('为空');
    expect(validateBranchName('main branch')).toContain('不允许的字符');
    expect(validateBranchName('feature..x')).toContain('..');
    expect(validateBranchName('-main')).toContain('-');
    expect(validateBranchName('HEAD')).toContain('HEAD');
    expect(validateBranchName('main/')).toContain('结尾');
  });
});

describe('parseLsRemoteRef', () => {
  it('returns the SHA only for the exact ref', () => {
    const stdout = [
      'abc123abc123abc123abc123abc123abc123abcd\trefs/heads/main',
      'def456def456def456def456def456def456def4\trefs/heads/release'
    ].join('\n');
    expect(parseLsRemoteRef(stdout, 'refs/heads/main')).toBe(
      'abc123abc123abc123abc123abc123abc123abcd'
    );
    expect(parseLsRemoteRef(stdout, 'refs/heads/missing')).toBeNull();
    expect(parseLsRemoteRef('', 'refs/heads/main')).toBeNull();
  });
});

describe('resolveReleaseTarget', () => {
  function deps(options: { defaultBranch?: string | null; lookup: BranchLookup }) {
    const getRepository = vi.fn(async () =>
      options.defaultBranch === null
        ? null
        : { defaultBranch: options.defaultBranch ?? 'main' }
    );
    const lookupBranch = vi.fn(async () => options.lookup);
    return { getRepository, lookupBranch };
  }

  it('uses the release branch SHA from ls-remote', async () => {
    const target = deps({ lookup: { ok: true, sha: 'abc123' } });
    const result = await resolveReleaseTarget(target, 'owner', 'repo', 'release');

    expect(result).toEqual({
      ok: true,
      target: { branch: 'release', sha: 'abc123', defaultBranch: 'main' }
    });
    expect(target.lookupBranch).toHaveBeenCalledWith('release');
  });

  it('reports both branches when releaseBranch differs from the default branch', async () => {
    const target = deps({ defaultBranch: 'main', lookup: { ok: true, sha: 'release-sha' } });
    const result = await resolveReleaseTarget(target, 'owner', 'repo', 'release');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.target.branch).toBe('release');
      expect(result.target.defaultBranch).toBe('main');
    }
  });

  it('rejects an empty release branch before any remote lookup', async () => {
    const target = deps({ lookup: { ok: true, sha: 'abc123' } });
    const result = await resolveReleaseTarget(target, 'owner', 'repo', '');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('release 分支名为空');
    }
    expect(target.getRepository).not.toHaveBeenCalled();
    expect(target.lookupBranch).not.toHaveBeenCalled();
  });

  it('reports a missing release branch so the caller can create it', async () => {
    const target = deps({
      lookup: {
        ok: false,
        missing: true,
        error: 'release 分支不存在：release。'
      }
    });
    const result = await resolveReleaseTarget(target, 'owner', 'repo', 'release');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('release 分支不存在');
    }
  });

  it('rejects when git ls-remote fails', async () => {
    const target = deps({
      lookup: {
        ok: false,
        missing: false,
        error: '无法读取远程 release 分支（git ls-remote 失败）：connection reset'
      }
    });
    const result = await resolveReleaseTarget(target, 'owner', 'repo', 'main');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('ls-remote 失败');
      expect(result.error).toContain('connection reset');
    }
  });

  it('still resolves via ls-remote when the repository API lookup fails', async () => {
    const target = deps({ lookup: { ok: true, sha: 'abc123' } });
    target.getRepository.mockRejectedValueOnce(new Error('network down'));

    const result = await resolveReleaseTarget(target, 'owner', 'repo', 'main');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.target.sha).toBe('abc123');
      expect(result.target.defaultBranch).toBeNull();
    }
  });
});

describe('ensureReleaseTarget', () => {
  function deps(options: {
    lookups: BranchLookup[];
    create?: { ok: true } | { ok: false; error: string };
    defaultBranch?: string | null;
  }) {
    let index = 0;
    const getRepository = vi.fn(async () =>
      options.defaultBranch === null
        ? null
        : { defaultBranch: options.defaultBranch ?? 'main' }
    );
    const lookupBranch = vi.fn(async () => options.lookups[Math.min(index++, options.lookups.length - 1)]);
    const createBranch = vi.fn(
      async (): Promise<{ ok: true } | { ok: false; error: string }> =>
        options.create ?? { ok: true }
    );
    return { getRepository, lookupBranch, createBranch };
  }

  it('creates the missing branch, then reads its newest commit', async () => {
    const target = deps({
      lookups: [
        { ok: false, missing: true, error: 'release 分支不存在：release。' },
        { ok: true, sha: 'created-sha' }
      ]
    });

    const result = await ensureReleaseTarget(target, 'owner', 'repo', 'release');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.target).toEqual({
        branch: 'release',
        sha: 'created-sha',
        defaultBranch: 'main'
      });
    }
    expect(target.createBranch).toHaveBeenCalledWith('release');
    expect(target.lookupBranch).toHaveBeenCalledTimes(2);
  });

  it('does not create a branch when it already exists', async () => {
    const target = deps({ lookups: [{ ok: true, sha: 'existing-sha' }] });

    const result = await ensureReleaseTarget(target, 'owner', 'repo', 'release');

    expect(result.ok).toBe(true);
    expect(target.createBranch).not.toHaveBeenCalled();
  });

  it('aborts with a clear message when branch creation fails', async () => {
    const target = deps({
      lookups: [{ ok: false, missing: true, error: 'release 分支不存在：release。' }],
      create: { ok: false, error: '认证失败' }
    });

    const result = await ensureReleaseTarget(target, 'owner', 'repo', 'release');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('自动创建失败');
      expect(result.error).toContain('认证失败');
    }
    expect(target.lookupBranch).toHaveBeenCalledTimes(1);
  });

  it('aborts when the created branch cannot be read back', async () => {
    const target = deps({
      lookups: [
        { ok: false, missing: true, error: 'missing' },
        { ok: false, missing: false, error: 'ls-remote 失败' }
      ]
    });

    const result = await ensureReleaseTarget(target, 'owner', 'repo', 'release');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('读取最新 commit 失败');
    }
  });

  it('does not attempt creation when ls-remote itself fails', async () => {
    const target = deps({
      lookups: [{ ok: false, missing: false, error: 'ls-remote 失败' }]
    });

    const result = await ensureReleaseTarget(target, 'owner', 'repo', 'release');

    expect(result.ok).toBe(false);
    expect(target.createBranch).not.toHaveBeenCalled();
  });
});
