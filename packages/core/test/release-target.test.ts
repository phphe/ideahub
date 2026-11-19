import { describe, expect, it, vi } from 'vitest';
import {
  buildReleaseTag,
  parseLsRemoteRef,
  resolveReleaseTarget,
  validateBranchName,
  validateTagName,
  type BranchLookup
} from '../src/release-target';

const CONFIGURED = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);

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
    expect(validateTagName('ideahub-bad tag')).toContain('characters Git does not allow');
    expect(validateTagName('ideahub-a..b')).toContain('..');
    expect(validateTagName('ideahub-.')).toContain('cannot end with');
    expect(validateTagName('ideahub-.lock')).toContain('.lock');
    expect(validateTagName('/ideahub')).toContain('cannot start with');
  });

  it('rejects empty and overly long tags', () => {
    expect(validateTagName('')).toContain('is empty');
    expect(validateTagName('a'.repeat(121))).toContain('120');
  });
});

describe('validateBranchName', () => {
  it('accepts normal branch names and rejects illegal ones', () => {
    expect(validateBranchName('main')).toBeNull();
    expect(validateBranchName('release/empty')).toBeNull();
    expect(validateBranchName('')).toContain('is empty');
    expect(validateBranchName('main branch')).toContain('characters Git does not allow');
    expect(validateBranchName('feature..x')).toContain('..');
    expect(validateBranchName('-main')).toContain('-');
    expect(validateBranchName('HEAD')).toContain('HEAD');
    expect(validateBranchName('main/')).toContain('cannot end with');
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
  function deps(options: {
    defaultBranch?: string | null;
    commit?: { sha: string } | null;
    lookup: BranchLookup;
    repositoryError?: Error;
    commitError?: Error;
  }) {
    const getRepository = vi.fn(async () => {
      if (options.repositoryError) {
        throw options.repositoryError;
      }
      return options.defaultBranch === null
        ? null
        : { defaultBranch: options.defaultBranch ?? 'trunk' };
    });
    const getCommit = vi.fn(async () => {
      if (options.commitError) {
        throw options.commitError;
      }
      return options.commit ?? null;
    });
    const lookupBranch = vi.fn(async () => options.lookup);
    return { getRepository, getCommit, lookupBranch };
  }

  it('uses the configured commit when it exists on the remote', async () => {
    const target = deps({
      commit: { sha: CONFIGURED },
      lookup: { ok: true, sha: OTHER }
    });

    const result = await resolveReleaseTarget(target, 'owner', 'repo', CONFIGURED);

    expect(result).toEqual({
      ok: true,
      target: { branch: 'trunk', sha: CONFIGURED, commitSource: 'config' }
    });
    expect(target.getCommit).toHaveBeenCalledWith('owner', 'repo', CONFIGURED);
    expect(target.lookupBranch).not.toHaveBeenCalled();
  });

  it('falls back to the default branch head when the configured commit is missing', async () => {
    const target = deps({ commit: null, lookup: { ok: true, sha: OTHER } });

    const result = await resolveReleaseTarget(target, 'owner', 'repo', CONFIGURED);

    expect(result).toEqual({
      ok: true,
      target: {
        branch: 'trunk',
        sha: OTHER,
        commitSource: 'branch-head',
        releaseCommitFallback: 'missing'
      }
    });
    expect(target.lookupBranch).toHaveBeenCalledWith('trunk');
  });

  it('uses the default branch head when no commit is configured', async () => {
    const target = deps({ lookup: { ok: true, sha: OTHER } });

    const result = await resolveReleaseTarget(target, 'owner', 'repo', '');

    expect(result).toEqual({
      ok: true,
      target: { branch: 'trunk', sha: OTHER, commitSource: 'branch-head' }
    });
    expect(target.getCommit).not.toHaveBeenCalled();
    expect(target.lookupBranch).toHaveBeenCalledWith('trunk');
  });

  it('treats an invalid commit id as unset and uses the default branch head', async () => {
    const target = deps({ lookup: { ok: true, sha: OTHER } });

    const result = await resolveReleaseTarget(target, 'owner', 'repo', 'not-a-commit');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.target.sha).toBe(OTHER);
      expect(result.target.commitSource).toBe('branch-head');
      expect(result.target.releaseCommitFallback).toBe('invalid');
    }
    expect(target.getCommit).not.toHaveBeenCalled();
  });

  it('reads the default branch through the API instead of assuming main', async () => {
    const target = deps({ defaultBranch: 'stable', lookup: { ok: true, sha: OTHER } });

    const result = await resolveReleaseTarget(target, 'owner', 'repo', '');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.target.branch).toBe('stable');
    }
    expect(target.lookupBranch).toHaveBeenCalledWith('stable');
  });

  it('reuses the same commit for repeated resolutions without consulting Releases', async () => {
    const target = deps({ commit: { sha: CONFIGURED }, lookup: { ok: true, sha: OTHER } });

    const first = await resolveReleaseTarget(target, 'owner', 'repo', CONFIGURED);
    const second = await resolveReleaseTarget(target, 'owner', 'repo', CONFIGURED);

    expect(first).toEqual(second);
    expect(target.getCommit).toHaveBeenCalledTimes(2);
  });

  it('aborts when the repository API cannot be read', async () => {
    const target = deps({
      repositoryError: new Error('network down'),
      lookup: { ok: true, sha: OTHER }
    });

    const result = await resolveReleaseTarget(target, 'owner', 'repo', '');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('default branch');
      expect(result.error).toContain('network down');
    }
    expect(target.lookupBranch).not.toHaveBeenCalled();
  });

  it('aborts when the repository API returns no default branch', async () => {
    const target = deps({ defaultBranch: null, lookup: { ok: true, sha: OTHER } });

    const result = await resolveReleaseTarget(target, 'owner', 'repo', '');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('default branch');
    }
  });

  it('aborts when the default branch has no commits', async () => {
    const target = deps({
      lookup: { ok: false, missing: true, error: 'The remote branch does not exist: trunk.' }
    });

    const result = await resolveReleaseTarget(target, 'owner', 'repo', '');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('has no commits');
    }
  });

  it('rejects when git ls-remote fails', async () => {
    const target = deps({
      lookup: {
        ok: false,
        missing: false,
        error: 'Unable to read the remote branch (git ls-remote failed): connection reset'
      }
    });

    const result = await resolveReleaseTarget(target, 'owner', 'repo', '');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('ls-remote failed');
      expect(result.error).toContain('connection reset');
    }
  });

  it('aborts when checking the configured commit fails', async () => {
    const target = deps({
      commitError: new Error('boom'),
      lookup: { ok: true, sha: OTHER }
    });

    const result = await resolveReleaseTarget(target, 'owner', 'repo', CONFIGURED);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('configured release commit');
      expect(result.error).toContain('boom');
    }
    expect(target.lookupBranch).not.toHaveBeenCalled();
  });
});
