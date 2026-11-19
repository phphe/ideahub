import { describe, expect, it, vi } from 'vitest';
import {
  buildReleaseTag,
  resolveReleaseTarget,
  validateBranchName,
  validateTagName
} from '../src/release-target';

const CONFIGURED = 'a'.repeat(40);
const EARLIEST = 'b'.repeat(40);

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

describe('resolveReleaseTarget', () => {
  function deps(options: {
    defaultBranch?: string | null;
    commit?: { sha: string } | null;
    earliest?: { sha: string } | null;
    repositoryError?: Error;
    commitError?: Error;
    earliestError?: Error;
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
    const getEarliestCommit = vi.fn(async () => {
      if (options.earliestError) {
        throw options.earliestError;
      }
      return options.earliest === undefined ? { sha: EARLIEST } : options.earliest;
    });
    return { getRepository, getCommit, getEarliestCommit };
  }

  it('uses the configured commit when it exists on the remote', async () => {
    const target = deps({ commit: { sha: CONFIGURED } });

    const result = await resolveReleaseTarget(target, 'owner', 'repo', CONFIGURED);

    expect(result).toEqual({
      ok: true,
      target: { branch: 'trunk', sha: CONFIGURED, commitSource: 'config' }
    });
    expect(target.getCommit).toHaveBeenCalledWith('owner', 'repo', CONFIGURED);
    expect(target.getEarliestCommit).not.toHaveBeenCalled();
  });

  it('falls back to the earliest commit when the configured commit is missing', async () => {
    const target = deps({ commit: null });

    const result = await resolveReleaseTarget(target, 'owner', 'repo', CONFIGURED);

    expect(result).toEqual({
      ok: true,
      target: {
        branch: 'trunk',
        sha: EARLIEST,
        commitSource: 'branch-earliest',
        releaseCommitFallback: 'missing'
      }
    });
    expect(target.getEarliestCommit).toHaveBeenCalledWith('owner', 'repo', 'trunk');
  });

  it('uses the earliest commit when no commit is configured', async () => {
    const target = deps({});

    const result = await resolveReleaseTarget(target, 'owner', 'repo', '');

    expect(result).toEqual({
      ok: true,
      target: { branch: 'trunk', sha: EARLIEST, commitSource: 'branch-earliest' }
    });
    expect(target.getCommit).not.toHaveBeenCalled();
    expect(target.getEarliestCommit).toHaveBeenCalledWith('owner', 'repo', 'trunk');
  });

  it('treats an invalid commit id as unset and uses the earliest commit', async () => {
    const target = deps({});

    const result = await resolveReleaseTarget(target, 'owner', 'repo', 'not-a-commit');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.target.sha).toBe(EARLIEST);
      expect(result.target.commitSource).toBe('branch-earliest');
      expect(result.target.releaseCommitFallback).toBe('invalid');
    }
    expect(target.getCommit).not.toHaveBeenCalled();
  });

  it('reads the default branch through the API instead of assuming main', async () => {
    const target = deps({ defaultBranch: 'stable' });

    const result = await resolveReleaseTarget(target, 'owner', 'repo', '');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.target.branch).toBe('stable');
    }
    expect(target.getEarliestCommit).toHaveBeenCalledWith('owner', 'repo', 'stable');
  });

  it('reuses the same commit for repeated resolutions without consulting Releases', async () => {
    const target = deps({ commit: { sha: CONFIGURED } });

    const first = await resolveReleaseTarget(target, 'owner', 'repo', CONFIGURED);
    const second = await resolveReleaseTarget(target, 'owner', 'repo', CONFIGURED);

    expect(first).toEqual(second);
    expect(target.getCommit).toHaveBeenCalledTimes(2);
  });

  it('aborts when the repository API cannot be read', async () => {
    const target = deps({ repositoryError: new Error('network down') });

    const result = await resolveReleaseTarget(target, 'owner', 'repo', '');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('default branch');
      expect(result.error).toContain('network down');
    }
    expect(target.getEarliestCommit).not.toHaveBeenCalled();
  });

  it('aborts when the repository API returns no default branch', async () => {
    const target = deps({ defaultBranch: null });

    const result = await resolveReleaseTarget(target, 'owner', 'repo', '');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('default branch');
    }
  });

  it('aborts when the default branch has no commits', async () => {
    const target = deps({ earliest: null });

    const result = await resolveReleaseTarget(target, 'owner', 'repo', '');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('has no commits');
    }
  });

  it('aborts when reading the earliest commit fails', async () => {
    const target = deps({ earliestError: new Error('connection reset') });

    const result = await resolveReleaseTarget(target, 'owner', 'repo', '');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('earliest commit');
      expect(result.error).toContain('connection reset');
    }
  });

  it('aborts when checking the configured commit fails', async () => {
    const target = deps({ commitError: new Error('boom') });

    const result = await resolveReleaseTarget(target, 'owner', 'repo', CONFIGURED);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('configured release commit');
      expect(result.error).toContain('boom');
    }
    expect(target.getEarliestCommit).not.toHaveBeenCalled();
  });
});
