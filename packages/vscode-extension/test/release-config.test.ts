import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import * as releaseConfig from '../scripts/release-config.js';
import type { DeveloperConfigResult } from '../scripts/release-config.js';

const {
  DEFAULT_RELEASE_COMMIT,
  DEFAULT_PROOF_FILE_VERSION,
  DEFAULT_PROOF_FILE_HEADER,
  DEVELOPER_CONFIG_FILE,
  RELEASE_COMMIT_ENV_KEY,
  PROOF_FILE_VERSION_ENV_KEY,
  PROOF_FILE_HEADER_ENV_KEY,
  loadDeveloperConfig,
  resolveReleaseCommit,
  resolveProofFileVersion,
  resolveProofFileHeader,
  resolveOAuthClientId,
  OAUTH_CLIENT_ID_ENV_KEY,
  findStandaloneSeparatorLine
} = releaseConfig;

function configOf(value: Record<string, unknown>): DeveloperConfigResult {
  return { ok: true, value };
}

function configFailure(
  reason: Extract<DeveloperConfigResult, { ok: false }>['reason'],
  detail?: string
): DeveloperConfigResult {
  return detail ? { ok: false, reason, detail } : { ok: false, reason };
}

async function writeTempModule(source: string): Promise<{ root: string; file: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ideahub-config-'));
  const file = path.join(root, 'config.mjs');
  await fs.writeFile(file, source, 'utf8');
  return { root, file };
}

describe('developer config module loading', () => {
  it('reads the default export object from config.mjs', async () => {
    const { root, file } = await writeTempModule(
      [
        'export default {',
        "  releaseCommit: 'abcdef1',",
        "  proofFileVersion: '2',",
        "  proofFileHeader: 'See <project-url>.'",
        '};'
      ].join('\n')
    );

    const result = await loadDeveloperConfig(file);
    expect(result).toEqual({
      ok: true,
      value: {
        releaseCommit: 'abcdef1',
        proofFileVersion: '2',
        proofFileHeader: 'See <project-url>.'
      }
    });

    await fs.rm(root, { recursive: true, force: true });
  });

  it('reports a missing default export', async () => {
    const { root, file } = await writeTempModule("export const releaseCommit = 'abcdef1';");

    const result = await loadDeveloperConfig(file);
    expect(result).toEqual({ ok: false, reason: 'default-missing' });

    await fs.rm(root, { recursive: true, force: true });
  });

  it('reports a default export that is not an object', async () => {
    const { root, file } = await writeTempModule("export default ['not', 'an', 'object'];");

    const result = await loadDeveloperConfig(file);
    expect(result).toEqual({ ok: false, reason: 'default-not-object' });

    await fs.rm(root, { recursive: true, force: true });
  });

  it('reports module evaluation failures with the error detail', async () => {
    const { root, file } = await writeTempModule("throw new Error('boom');");

    const result = await loadDeveloperConfig(file);
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('expected a load failure');
    }
    expect(result.reason).toBe('load-failed');
    expect(result.detail).toContain('boom');

    await fs.rm(root, { recursive: true, force: true });
  });

  it('reports a missing config.mjs file', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ideahub-config-'));
    const result = await loadDeveloperConfig(path.join(root, 'config.mjs'));

    expect(result).toEqual({ ok: false, reason: 'missing' });

    await fs.rm(root, { recursive: true, force: true });
  });
});

describe('build-time release config resolution', () => {
  it('falls back to an empty commit when no config is provided', () => {
    const result = resolveReleaseCommit();

    expect(result.commit).toBe(DEFAULT_RELEASE_COMMIT);
    expect(result.source).toBe('default');
    expect(result.warnings.join('\n')).toContain(DEVELOPER_CONFIG_FILE);
  });

  it('reads releaseCommit from the loaded config', () => {
    const result = resolveReleaseCommit({
      config: configOf({ releaseCommit: 'abcdef1' })
    });

    expect(result).toEqual({ commit: 'abcdef1', source: 'file', warnings: [] });
  });

  it('accepts an empty commit as "not configured" without warnings', () => {
    const result = resolveReleaseCommit({ config: configOf({ releaseCommit: '  ' }) });

    expect(result).toEqual({ commit: '', source: 'file', warnings: [] });
  });

  it('prefers .env content over the config module', () => {
    const result = resolveReleaseCommit({
      envText: `${RELEASE_COMMIT_ENV_KEY}=1234567\n`,
      config: configOf({ releaseCommit: 'abcdef1' })
    });

    expect(result.commit).toBe('1234567');
    expect(result.source).toBe('env');
    expect(result.warnings).toEqual([]);
  });

  it('ignores an empty or invalid .env value and falls through to the config', () => {
    const emptyEnv = resolveReleaseCommit({
      envText: `${RELEASE_COMMIT_ENV_KEY}=\n`,
      config: configOf({ releaseCommit: 'abcdef1' })
    });
    expect(emptyEnv.commit).toBe('abcdef1');

    const invalidEnv = resolveReleaseCommit({
      envText: `${RELEASE_COMMIT_ENV_KEY}=not-hex\n`,
      config: configOf({ releaseCommit: 'abcdef1' })
    });
    expect(invalidEnv.commit).toBe('abcdef1');
    expect(invalidEnv.warnings.join('\n')).toContain('无效');
  });

  it('warns and falls back for module load failures', () => {
    const loadFailed = resolveReleaseCommit({ config: configFailure('load-failed', 'boom') });
    expect(loadFailed.commit).toBe(DEFAULT_RELEASE_COMMIT);
    expect(loadFailed.warnings.join('\n')).toContain('加载 config.mjs 失败');
    expect(loadFailed.warnings.join('\n')).toContain('boom');

    const noDefault = resolveReleaseCommit({ config: configFailure('default-missing') });
    expect(noDefault.commit).toBe(DEFAULT_RELEASE_COMMIT);
    expect(noDefault.warnings.join('\n')).toContain('缺少 default 导出');
  });

  it('warns and falls back for illegal commits', () => {
    const invalid = resolveReleaseCommit({ config: configOf({ releaseCommit: 'xyz' }) });
    expect(invalid.commit).toBe(DEFAULT_RELEASE_COMMIT);
    expect(invalid.warnings.join('\n')).toContain('无效');

    const tooShort = resolveReleaseCommit({ config: configOf({ releaseCommit: 'abc123' }) });
    expect(tooShort.commit).toBe(DEFAULT_RELEASE_COMMIT);
    expect(tooShort.warnings.join('\n')).toContain('无效');

    const wrongType = resolveReleaseCommit({ config: configOf({ releaseCommit: 42 }) });
    expect(wrongType.commit).toBe(DEFAULT_RELEASE_COMMIT);
    expect(wrongType.warnings.join('\n')).toContain('必须是字符串');
  });
});

describe('build-time oauthClientId resolution', () => {
  it('treats an empty placeholder as legal and silent', () => {
    const result = resolveOAuthClientId({ config: configOf({ oauthClientId: '' }) });

    expect(result.clientId).toBe('');
    expect(result.source).toBe('file');
    expect(result.warnings).toEqual([]);
  });

  it('prefers the env override and ignores an empty env value', () => {
    const overridden = resolveOAuthClientId({
      envText: `${OAUTH_CLIENT_ID_ENV_KEY}=Iv1.abc\n`,
      config: configOf({ oauthClientId: '' })
    });
    expect(overridden.clientId).toBe('Iv1.abc');
    expect(overridden.source).toBe('env');

    const emptyEnv = resolveOAuthClientId({
      envText: `${OAUTH_CLIENT_ID_ENV_KEY}=\n`,
      config: configOf({ oauthClientId: '' })
    });
    expect(emptyEnv.clientId).toBe('');
    expect(emptyEnv.source).toBe('file');
    expect(emptyEnv.warnings).toEqual([]);
  });
});

describe('runtime release config', () => {
  it('uses a build-injected constant and reads no user files', async () => {
    const source = await fs.readFile(
      path.join(process.cwd(), '..', 'core', 'src', 'release-config.ts'),
      'utf8'
    );

    expect(source).not.toContain("'node:fs'");
    expect(source).not.toContain('readFile');

    const { RELEASE_COMMIT, PROOF_FILE_VERSION, PROOF_FILE_HEADER } = await import(
      '@ideahub/core'
    );
    expect(typeof RELEASE_COMMIT).toBe('string');
    expect(typeof PROOF_FILE_VERSION).toBe('string');
    expect(PROOF_FILE_VERSION.length).toBeGreaterThan(0);
    expect(typeof PROOF_FILE_HEADER).toBe('string');
  });
});

describe('build-time proofFileVersion resolution', () => {
  it('falls back to the default when no config is provided', () => {
    const result = resolveProofFileVersion();

    expect(result.version).toBe(DEFAULT_PROOF_FILE_VERSION);
    expect(result.source).toBe('default');
    expect(result.warnings.join('\n')).toContain(DEVELOPER_CONFIG_FILE);
  });

  it('reads proofFileVersion from the loaded config', () => {
    const result = resolveProofFileVersion({ config: configOf({ proofFileVersion: '2' }) });

    expect(result).toEqual({ version: '2', source: 'file', warnings: [] });
  });

  it('prefers .env over the config module', () => {
    const result = resolveProofFileVersion({
      envText: `${PROOF_FILE_VERSION_ENV_KEY}=9\n`,
      config: configOf({ proofFileVersion: '2' })
    });

    expect(result.version).toBe('9');
    expect(result.source).toBe('env');
  });

  it('ignores an empty .env value and falls through to the config', () => {
    const result = resolveProofFileVersion({
      envText: `${PROOF_FILE_VERSION_ENV_KEY}=\n`,
      config: configOf({ proofFileVersion: '2' })
    });

    expect(result.version).toBe('2');
    expect(result.source).toBe('file');
    expect(result.warnings.join('\n')).toContain('为空');
  });

  it('warns and falls back for load failures, missing, non-string or empty values', () => {
    const loadFailed = resolveProofFileVersion({ config: configFailure('load-failed', 'boom') });
    expect(loadFailed.version).toBe(DEFAULT_PROOF_FILE_VERSION);
    expect(loadFailed.warnings.join('\n')).toContain('加载 config.mjs 失败');

    const noDefault = resolveProofFileVersion({ config: configFailure('default-missing') });
    expect(noDefault.version).toBe(DEFAULT_PROOF_FILE_VERSION);
    expect(noDefault.warnings.join('\n')).toContain('缺少 default 导出');

    const missing = resolveProofFileVersion({ config: configOf({}) });
    expect(missing.version).toBe(DEFAULT_PROOF_FILE_VERSION);
    expect(missing.warnings.join('\n')).toContain('缺少 proofFileVersion');

    const wrongType = resolveProofFileVersion({ config: configOf({ proofFileVersion: 42 }) });
    expect(wrongType.version).toBe(DEFAULT_PROOF_FILE_VERSION);
    expect(wrongType.warnings.join('\n')).toContain('必须是字符串');

    const empty = resolveProofFileVersion({ config: configOf({ proofFileVersion: '  ' }) });
    expect(empty.version).toBe(DEFAULT_PROOF_FILE_VERSION);
    expect(empty.warnings.join('\n')).toContain('为空');
  });
});

describe('build-time proofFileHeader resolution', () => {
  it('falls back to an empty header when no config is provided', () => {
    const result = resolveProofFileHeader();

    expect(result.header).toBe(DEFAULT_PROOF_FILE_HEADER);
    expect(result.source).toBe('default');
    expect(result.warnings.join('\n')).toContain(DEVELOPER_CONFIG_FILE);
  });

  it('reads proofFileHeader from the loaded config', () => {
    const result = resolveProofFileHeader({
      config: configOf({ proofFileHeader: 'See <project-url>.' })
    });

    expect(result).toEqual({ header: 'See <project-url>.', source: 'file', warnings: [] });
  });

  it('prefers .env over the config module', () => {
    const result = resolveProofFileHeader({
      envText: `${PROOF_FILE_HEADER_ENV_KEY}=from-env <project-url>\n`,
      config: configOf({ proofFileHeader: 'from-file' })
    });

    expect(result.header).toBe('from-env <project-url>');
    expect(result.source).toBe('env');
  });

  it('warns and omits the header for load failures, missing, non-string or empty values', () => {
    const loadFailed = resolveProofFileHeader({ config: configFailure('load-failed', 'boom') });
    expect(loadFailed.header).toBe(DEFAULT_PROOF_FILE_HEADER);
    expect(loadFailed.warnings.join('\n')).toContain('加载 config.mjs 失败');

    const missing = resolveProofFileHeader({ config: configOf({}) });
    expect(missing.header).toBe(DEFAULT_PROOF_FILE_HEADER);
    expect(missing.warnings.join('\n')).toContain('缺少 proofFileHeader');

    const wrongType = resolveProofFileHeader({ config: configOf({ proofFileHeader: ['a'] }) });
    expect(wrongType.header).toBe(DEFAULT_PROOF_FILE_HEADER);
    expect(wrongType.warnings.join('\n')).toContain('必须是字符串');

    const empty = resolveProofFileHeader({ config: configOf({ proofFileHeader: '   ' }) });
    expect(empty.header).toBe(DEFAULT_PROOF_FILE_HEADER);
    expect(empty.warnings.join('\n')).toContain('为空');
  });
});

describe('build-time proof file separator check', () => {
  it('accepts headers without a standalone --- line', () => {
    expect(findStandaloneSeparatorLine('')).toBeNull();
    expect(findStandaloneSeparatorLine('# Title\n\n> Quote line.')).toBeNull();
    // Quoted separators stay inside the quote block, so they are allowed.
    expect(findStandaloneSeparatorLine('> ---\n> after')).toBeNull();
    expect(findStandaloneSeparatorLine('text\n- - -\n---x')).toBeNull();
  });

  it('reports the first standalone --- line', () => {
    expect(findStandaloneSeparatorLine('---\n> body')).toBe(1);
    expect(findStandaloneSeparatorLine('# Title\n\n> A\n---\n> B')).toBe(4);
    // Whitespace around the line does not make it safe.
    expect(findStandaloneSeparatorLine('> A\n   ---   \n> B')).toBe(2);
    expect(findStandaloneSeparatorLine('# Title\r\n---\r\n> B')).toBe(2);
  });
});

describe('vsix exclusions', () => {
  it('does not package .env or config.mjs and no longer excludes the old JSON config', async () => {
    const ignore = await fs.readFile(path.join(process.cwd(), '.vscodeignore'), 'utf8');
    const lines = ignore.split(/\r?\n/).map((line) => line.trim());

    expect(lines).toContain('.env');
    expect(lines).toContain('.env.*');
    expect(lines).toContain('config.mjs');
    expect(lines).not.toContain('ideahub.config.json');
  });
});
