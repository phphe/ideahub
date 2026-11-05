import { describe, expect, it, vi } from 'vitest';
import {
  buildReleaseTag,
  resolveReleaseTarget,
  validateTagName
} from '../src/core/release-target';

function repository(defaultBranch: string) {
  return {
    fullName: 'owner/repo',
    isPrivate: false,
    defaultBranch,
    canPush: true
  };
}

describe('buildReleaseTag / validateTagName', () => {
  it('keeps a hex hash unchanged and accepts it', () => {
    const result = buildReleaseTag('a'.repeat(64));
    expect(result.sanitized).toBe(false);
    expect(result.tag).toBe(`ideahub-${'a'.repeat(64)}`);
    expect(validateTagName(result.tag)).toBeNull();
  });

  it('removes characters that Git refs do not allow', () => {
    const result = buildReleaseTag('sha256:abc/def ghi');
    expect(result.tag).toBe('ideahub-sha256abcdefghi');
    expect(result.sanitized).toBe(true);
    expect(validateTagName(result.tag)).toBeNull();
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

describe('resolveReleaseTarget', () => {
  it('uses the remote default branch and its commit SHA', async () => {
    const client = {
      getRepository: vi.fn(async () => repository('main')),
      getBranchHead: vi.fn(async (_owner: string, _repo: string, branch: string) =>
        branch === 'main' ? { sha: 'abc123' } : null
      )
    };

    const result = await resolveReleaseTarget(client, 'owner', 'repo', 'main');

    expect(result).toEqual({ ok: true, target: { branch: 'main', sha: 'abc123' } });
    expect(client.getBranchHead).toHaveBeenCalledWith('owner', 'repo', 'main');
  });

  it('prefers the remote default branch when the local branch differs', async () => {
    const client = {
      getRepository: vi.fn(async () => repository('trunk')),
      getBranchHead: vi.fn(async (_owner: string, _repo: string, branch: string) =>
        branch === 'trunk' ? { sha: 'trunk-sha' } : null
      )
    };

    const result = await resolveReleaseTarget(client, 'owner', 'repo', 'main');

    expect(result).toEqual({
      ok: true,
      target: { branch: 'trunk', sha: 'trunk-sha' }
    });
    expect(client.getBranchHead).toHaveBeenCalledWith('owner', 'repo', 'trunk');
    expect(client.getBranchHead).not.toHaveBeenCalledWith('owner', 'repo', 'main');
  });

  it('falls back to the configured branch only when the default is absent', async () => {
    const client = {
      getRepository: vi.fn(async () => repository('trunk')),
      getBranchHead: vi.fn(async (_owner: string, _repo: string, branch: string) =>
        branch === 'main' ? { sha: 'main-sha' } : null
      )
    };

    const result = await resolveReleaseTarget(client, 'owner', 'repo', 'main');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.target).toEqual({ branch: 'main', sha: 'main-sha' });
    }
  });

  it('rejects an empty target when neither branch exists', async () => {
    const client = {
      getRepository: vi.fn(async () => repository('main')),
      getBranchHead: vi.fn(async () => null)
    };

    const result = await resolveReleaseTarget(client, 'owner', 'repo', '');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('远端分支不存在');
      expect(result.error).toContain('main');
      expect(result.error).toContain('扩展不会自动推送');
    }
  });

  it('rejects when the repository has no usable branch names at all', async () => {
    const client = {
      getRepository: vi.fn(async () => repository('')),
      getBranchHead: vi.fn(async () => null)
    };

    const result = await resolveReleaseTarget(client, 'owner', 'repo', '');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('没有可用的分支名');
    }
  });

  it('reports repository lookup failures without attempting a release', async () => {
    const client = {
      getRepository: vi.fn(async () => {
        throw new Error('network down');
      }),
      getBranchHead: vi.fn(async () => null)
    };

    const result = await resolveReleaseTarget(client, 'owner', 'repo', 'main');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('无法读取远程仓库信息');
      expect(result.error).toContain('network down');
    }
    expect(client.getBranchHead).not.toHaveBeenCalled();
  });
});
