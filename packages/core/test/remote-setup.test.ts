import { describe, expect, it, vi } from 'vitest';
import type { GitHubClient } from '../src/github';
import { validateRemoteRepository } from '../src/remote-setup';

function client(options: {
  defaultBranch?: string;
  branchHeads?: Record<string, string | null>;
}) {
  return {
    getRepository: vi.fn(async () => ({
      isPrivate: false,
      canPush: true,
      defaultBranch: options.defaultBranch ?? 'main'
    })),
    getBranchHead: vi.fn(async (_owner: string, _repo: string, branch: string) =>
      options.branchHeads?.[branch] ?? null
    )
  } as unknown as GitHubClient;
}

describe('validateRemoteRepository branch resolution', () => {
  it('uses the remote default branch when the branch field is empty', async () => {
    const github = client({ defaultBranch: 'trunk' });

    const result = await validateRemoteRepository('https://github.com/owner/repo', github, '  ');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.remote.branch).toBe('trunk');
    }
  });

  it('uses an explicitly filled branch after verifying it exists', async () => {
    const github = client({ defaultBranch: 'main', branchHeads: { dev: 'sha-dev' } });

    const result = await validateRemoteRepository('https://github.com/owner/repo', github, ' dev ');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.remote.branch).toBe('dev');
    }
    expect(github.getBranchHead).toHaveBeenCalledWith('owner', 'repo', 'dev');
  });

  it('does not silently fall back when the explicit branch is missing', async () => {
    const github = client({ defaultBranch: 'main', branchHeads: { dev: null } });

    const result = await validateRemoteRepository('https://github.com/owner/repo', github, 'dev');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('does not exist in the remote proof repository');
      expect(result.error).toContain('Check the branch name');
    }
  });

  it('rejects an illegal branch name before any remote lookup', async () => {
    const github = client({});

    const result = await validateRemoteRepository('https://github.com/owner/repo', github, 'bad name');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('Invalid branch name');
    }
    expect(github.getBranchHead).not.toHaveBeenCalled();
  });

  it('rejects an empty default branch when the field is left empty', async () => {
    const github = client({ defaultBranch: '' });

    const result = await validateRemoteRepository('https://github.com/owner/repo', github, '');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('Unable to read the remote proof repository default branch');
    }
  });
});
