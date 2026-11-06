import { describe, expect, it, vi } from 'vitest';
import {
  buildReleaseTag,
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

  it('rejects a release branch that does not exist on the remote', async () => {
    const target = deps({
      lookup: {
        ok: false,
        missing: true,
        error: 'release 分支不存在，请先推送：release。扩展不会自动推送。'
      }
    });
    const result = await resolveReleaseTarget(target, 'owner', 'repo', 'release');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('release 分支不存在，请先推送');
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
