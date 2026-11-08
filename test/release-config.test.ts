import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import * as releaseConfig from '../scripts/release-config.js';

const {
  DEFAULT_RELEASE_BRANCH,
  DEFAULT_PROOF_FILE_VERSION,
  DEFAULT_PROOF_FILE_HEADER,
  RELEASE_BRANCH_ENV_KEY,
  PROOF_FILE_VERSION_ENV_KEY,
  PROOF_FILE_HEADER_ENV_KEY,
  RELEASE_CONFIG_FILE,
  resolveReleaseBranch,
  resolveProofFileVersion,
  resolveProofFileHeader
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

    const { RELEASE_BRANCH, PROOF_FILE_VERSION, PROOF_FILE_HEADER } = await import(
      '../src/core/release-config'
    );
    expect(typeof RELEASE_BRANCH).toBe('string');
    expect(RELEASE_BRANCH.length).toBeGreaterThan(0);
    expect(typeof PROOF_FILE_VERSION).toBe('string');
    expect(PROOF_FILE_VERSION.length).toBeGreaterThan(0);
    expect(typeof PROOF_FILE_HEADER).toBe('string');
  });
});

describe('build-time proofFileVersion resolution', () => {
  it('falls back to the default when no config text is provided', () => {
    const result = resolveProofFileVersion();

    expect(result.version).toBe(DEFAULT_PROOF_FILE_VERSION);
    expect(result.source).toBe('default');
    expect(result.warnings.join('\n')).toContain(RELEASE_CONFIG_FILE);
  });

  it('reads proofFileVersion from ideahub.config.json', () => {
    const result = resolveProofFileVersion({
      configText: JSON.stringify({ proofFileVersion: '2' })
    });

    expect(result).toEqual({ version: '2', source: 'file', warnings: [] });
  });

  it('prefers .env over the config file', () => {
    const result = resolveProofFileVersion({
      envText: `${PROOF_FILE_VERSION_ENV_KEY}=9\n`,
      configText: JSON.stringify({ proofFileVersion: '2' })
    });

    expect(result.version).toBe('9');
    expect(result.source).toBe('env');
  });

  it('ignores an empty .env value and falls through to the file', () => {
    const result = resolveProofFileVersion({
      envText: `${PROOF_FILE_VERSION_ENV_KEY}=\n`,
      configText: JSON.stringify({ proofFileVersion: '2' })
    });

    expect(result.version).toBe('2');
    expect(result.source).toBe('file');
    expect(result.warnings.join('\n')).toContain('为空');
  });

  it('warns and falls back for missing, non-string or empty values', () => {
    const missing = resolveProofFileVersion({ configText: '{}' });
    expect(missing.version).toBe(DEFAULT_PROOF_FILE_VERSION);
    expect(missing.warnings.join('\n')).toContain('缺少 proofFileVersion');

    const wrongType = resolveProofFileVersion({
      configText: JSON.stringify({ proofFileVersion: 42 })
    });
    expect(wrongType.version).toBe(DEFAULT_PROOF_FILE_VERSION);
    expect(wrongType.warnings.join('\n')).toContain('必须是字符串');

    const empty = resolveProofFileVersion({
      configText: JSON.stringify({ proofFileVersion: '  ' })
    });
    expect(empty.version).toBe(DEFAULT_PROOF_FILE_VERSION);
    expect(empty.warnings.join('\n')).toContain('为空');

    const invalidJson = resolveProofFileVersion({ configText: '{invalid' });
    expect(invalidJson.version).toBe(DEFAULT_PROOF_FILE_VERSION);
    expect(invalidJson.warnings.join('\n')).toContain('不是有效的 JSON');
  });
});

describe('build-time proofFileHeader resolution', () => {
  it('falls back to an empty header when no config text is provided', () => {
    const result = resolveProofFileHeader();

    expect(result.header).toBe(DEFAULT_PROOF_FILE_HEADER);
    expect(result.source).toBe('default');
    expect(result.warnings.join('\n')).toContain(RELEASE_CONFIG_FILE);
  });

  it('reads proofFileHeader from ideahub.config.json', () => {
    const result = resolveProofFileHeader({
      configText: JSON.stringify({ proofFileHeader: 'See <project-url>.' })
    });

    expect(result).toEqual({ header: 'See <project-url>.', source: 'file', warnings: [] });
  });

  it('prefers .env over the config file', () => {
    const result = resolveProofFileHeader({
      envText: `${PROOF_FILE_HEADER_ENV_KEY}=from-env <project-url>\n`,
      configText: JSON.stringify({ proofFileHeader: 'from-file' })
    });

    expect(result.header).toBe('from-env <project-url>');
    expect(result.source).toBe('env');
  });

  it('warns and omits the header for missing, non-string or empty values', () => {
    const missing = resolveProofFileHeader({ configText: '{}' });
    expect(missing.header).toBe(DEFAULT_PROOF_FILE_HEADER);
    expect(missing.warnings.join('\n')).toContain('缺少 proofFileHeader');

    const wrongType = resolveProofFileHeader({
      configText: JSON.stringify({ proofFileHeader: ['a'] })
    });
    expect(wrongType.header).toBe(DEFAULT_PROOF_FILE_HEADER);
    expect(wrongType.warnings.join('\n')).toContain('必须是字符串');

    const empty = resolveProofFileHeader({
      configText: JSON.stringify({ proofFileHeader: '   ' })
    });
    expect(empty.header).toBe(DEFAULT_PROOF_FILE_HEADER);
    expect(empty.warnings.join('\n')).toContain('为空');
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
