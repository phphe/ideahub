import { describe, expect, it } from 'vitest';
import { canonicalRemoteIdentity, parseRemoteUrl } from '../src/remote-url';

describe('parseRemoteUrl', () => {
  const valid = [
    'https://github.com/owner/repo',
    'https://github.com/owner/repo.git',
    'https://github.com/owner/repo/',
    'https://www.github.com/owner/repo',
    'git@github.com:owner/repo.git',
    'git@github.com:owner/repo',
    'ssh://git@github.com/owner/repo.git'
  ];

  it.each(valid)('accepts %s', (input) => {
    const result = parseRemoteUrl(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.owner).toBe('owner');
      expect(result.value.repo).toBe('repo');
      expect(result.value.canonicalUrl).toBe('https://github.com/owner/repo');
      expect(result.value.cloneUrl).toBe('https://github.com/owner/repo.git');
    }
  });

  const invalid = [
    '',
    '   ',
    'github.com/owner/repo',
    'https://gitlab.com/owner/repo',
    'https://github.com/owner',
    'https://github.com/owner/repo/tree/main',
    'git@github.com:owner/repo/extra',
    'https://github.com/owner/repo?tab=readme'
  ];

  it.each(invalid)('rejects %s', (input) => {
    expect(parseRemoteUrl(input).ok).toBe(false);
  });

  it('normalizes identity ignoring case', () => {
    expect(canonicalRemoteIdentity('Owner', 'Repo')).toBe('owner/repo');
  });
});
