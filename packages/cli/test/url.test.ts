import { describe, expect, it } from 'vitest';
import { parseProjectUrl, resolveBranch } from '../src/url';

describe('parseProjectUrl', () => {
  it('accepts a project folder URL', () => {
    const result = parseProjectUrl('https://github.com/owner/repo/tree/main/MyGame');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        owner: 'owner',
        repo: 'repo',
        segments: ['main', 'MyGame'],
        readme: false
      });
    }
  });

  it('accepts a README URL and drops the trailing README.md', () => {
    const result = parseProjectUrl(
      'https://github.com/owner/repo/tree/main/MyGame/README.md?tab=readme-ov-file#top'
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.segments).toEqual(['main', 'MyGame']);
      expect(result.value.readme).toBe(true);
    }
  });

  it('accepts a trailing slash and percent-encoded segments', () => {
    const result = parseProjectUrl(
      'https://github.com/owner/repo/tree/main/%E9%A1%B9%E7%9B%AE/'
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.segments).toEqual(['main', '项目']);
    }
  });

  it('rejects unsupported URLs instead of guessing', () => {
    const rejected = [
      'https://github.com/owner/repo',
      'https://github.com/owner/repo/blob/main/MyGame/README.md',
      'https://github.com/owner/repo/tree/main',
      'https://github.com/owner/repo/tree/main/README.md',
      'https://github.com/owner/repo/tree/main/MyGame/README.md/extra',
      'https://gitlab.com/owner/repo/tree/main/MyGame',
      'http://github.com/owner/repo/tree/main/MyGame',
      'https://github.com/owner/repo/tree/main/../MyGame',
      'https://github.com/owner/repo/tree/main/%2E%2E/MyGame',
      'not a url'
    ];
    for (const input of rejected) {
      expect(parseProjectUrl(input).ok, input).toBe(false);
    }
  });
});

describe('resolveBranch', () => {
  it('picks the longest branch that matches the path prefix', () => {
    const resolved = resolveBranch(['feature', 'x', 'MyGame'], ['main', 'feature/x']);
    expect(resolved).toEqual({ branch: 'feature/x', projectSegments: ['MyGame'] });
  });

  it('returns null when nothing matches', () => {
    expect(resolveBranch(['nope', 'MyGame'], ['main'])).toBeNull();
  });

  it('never treats the last segment as part of the branch', () => {
    expect(resolveBranch(['main'], ['main'])).toBeNull();
  });
});
