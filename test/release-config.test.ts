import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import * as releaseConfig from '../scripts/release-config.js';

const {
  DEFAULT_RELEASE_BRANCH,
  RELEASE_BRANCH_ENV_KEY,
  RELEASE_CONFIG_FILE,
  resolveReleaseBranch
} = releaseConfig;

describe('build-time release config resolution', () => {
  it('falls back to main when no config text is provided', () => {
    const result = resolveReleaseBranch();

    expect(result.branch).toBe(DEFAULT_RELEASE_BRANCH);
    expect(result.source).toBe('default');
    expect(result.warnings.join('\n')).toContain(RELEASE_CONFIG_FILE);
  });

  it('reads releaseBranch from ideahub.config.json text', () => {
    const result = resolveReleaseBranch({
      configText: JSON.stringify({ releaseBranch: 'release/empty' })
    });

    expect(result).toEqual({ branch: 'release/empty', source: 'file', warnings: [] });
  });

  it('prefers .env content over the config file', () => {
    const result = resolveReleaseBranch({
      envText: `${RELEASE_BRANCH_ENV_KEY}=from-env\n`,
      configText: JSON.stringify({ releaseBranch: 'from-file' })
    });

    expect(result.branch).toBe('from-env');
    expect(result.source).toBe('env');
  });

  it('ignores an empty or invalid .env value and falls through to the file', () => {
    const emptyEnv = resolveReleaseBranch({
      envText: `${RELEASE_BRANCH_ENV_KEY}=\n`,
      configText: JSON.stringify({ releaseBranch: 'from-file' })
    });
    expect(emptyEnv.branch).toBe('from-file');
    expect(emptyEnv.warnings.join('\n')).toContain('为空');

    const invalidEnv = resolveReleaseBranch({
      envText: `${RELEASE_BRANCH_ENV_KEY}=bad branch\n`,
      configText: JSON.stringify({ releaseBranch: 'from-file' })
    });
    expect(invalidEnv.branch).toBe('from-file');
    expect(invalidEnv.warnings.join('\n')).toContain('无效');
  });

  it('warns and falls back for invalid JSON, empty or illegal branches', () => {
    const invalidJson = resolveReleaseBranch({ configText: '{invalid' });
    expect(invalidJson.branch).toBe(DEFAULT_RELEASE_BRANCH);
    expect(invalidJson.warnings.join('\n')).toContain('不是有效的 JSON');

    const empty = resolveReleaseBranch({ configText: JSON.stringify({ releaseBranch: '  ' }) });
    expect(empty.branch).toBe(DEFAULT_RELEASE_BRANCH);
    expect(empty.warnings.join('\n')).toContain('无效');

    const wrongType = resolveReleaseBranch({ configText: JSON.stringify({ releaseBranch: 42 }) });
    expect(wrongType.branch).toBe(DEFAULT_RELEASE_BRANCH);
    expect(wrongType.warnings.join('\n')).toContain('必须是字符串');
  });
});

describe('runtime release config', () => {
  it('uses a build-injected constant and reads no user files', async () => {
    const source = await fs.readFile(
      path.join(process.cwd(), 'src/core/release-config.ts'),
      'utf8'
    );

    expect(source).not.toContain("'node:fs'");
    expect(source).not.toContain('readFile');

    const { RELEASE_BRANCH } = await import('../src/core/release-config');
    expect(typeof RELEASE_BRANCH).toBe('string');
    expect(RELEASE_BRANCH.length).toBeGreaterThan(0);
  });
});

describe('vsix exclusions', () => {
  it('does not package .env or the developer config file', async () => {
    const ignore = await fs.readFile(path.join(process.cwd(), '.vscodeignore'), 'utf8');
    const lines = ignore.split(/\r?\n/).map((line) => line.trim());

    expect(lines).toContain('.env');
    expect(lines).toContain('.env.*');
    expect(lines).toContain('ideahub.config.json');
  });
});
