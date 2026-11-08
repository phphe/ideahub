import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import * as releaseConfig from '../scripts/release-config.js';
import type { DeveloperConfigResult } from '../scripts/release-config.js';

const {
  DEFAULT_RELEASE_BRANCH,
  DEFAULT_PROOF_FILE_VERSION,
  DEFAULT_PROOF_FILE_HEADER,
  DEVELOPER_CONFIG_FILE,
  RELEASE_BRANCH_ENV_KEY,
  PROOF_FILE_VERSION_ENV_KEY,
  PROOF_FILE_HEADER_ENV_KEY,
  loadDeveloperConfig,
  resolveReleaseBranch,
  resolveProofFileVersion,
  resolveProofFileHeader
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
        "  releaseBranch: 'release/empty',",
        "  proofFileVersion: '2',",
        "  proofFileHeader: 'See <project-url>.'",
        '};'
      ].join('\n')
    );

    const result = await loadDeveloperConfig(file);
    expect(result).toEqual({
      ok: true,
      value: {
        releaseBranch: 'release/empty',
        proofFileVersion: '2',
        proofFileHeader: 'See <project-url>.'
      }
    });

    await fs.rm(root, { recursive: true, force: true });
  });

  it('reports a missing default export', async () => {
    const { root, file } = await writeTempModule("export const releaseBranch = 'main';");

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
  it('falls back to main when no config is provided', () => {
    const result = resolveReleaseBranch();

    expect(result.branch).toBe(DEFAULT_RELEASE_BRANCH);
    expect(result.source).toBe('default');
    expect(result.warnings.join('\n')).toContain(DEVELOPER_CONFIG_FILE);
  });

  it('reads releaseBranch from the loaded config', () => {
    const result = resolveReleaseBranch({
      config: configOf({ releaseBranch: 'release/empty' })
    });

    expect(result).toEqual({ branch: 'release/empty', source: 'file', warnings: [] });
  });

  it('prefers .env content over the config module', () => {
    const result = resolveReleaseBranch({
      envText: `${RELEASE_BRANCH_ENV_KEY}=from-env\n`,
      config: configOf({ releaseBranch: 'from-file' })
    });

    expect(result.branch).toBe('from-env');
    expect(result.source).toBe('env');
  });

  it('ignores an empty or invalid .env value and falls through to the config', () => {
    const emptyEnv = resolveReleaseBranch({
      envText: `${RELEASE_BRANCH_ENV_KEY}=\n`,
      config: configOf({ releaseBranch: 'from-file' })
    });
    expect(emptyEnv.branch).toBe('from-file');
    expect(emptyEnv.warnings.join('\n')).toContain('为空');

    const invalidEnv = resolveReleaseBranch({
      envText: `${RELEASE_BRANCH_ENV_KEY}=bad branch\n`,
      config: configOf({ releaseBranch: 'from-file' })
    });
    expect(invalidEnv.branch).toBe('from-file');
    expect(invalidEnv.warnings.join('\n')).toContain('无效');
  });

  it('warns and falls back for module load failures', () => {
    const loadFailed = resolveReleaseBranch({ config: configFailure('load-failed', 'boom') });
    expect(loadFailed.branch).toBe(DEFAULT_RELEASE_BRANCH);
    expect(loadFailed.warnings.join('\n')).toContain('加载 config.mjs 失败');
    expect(loadFailed.warnings.join('\n')).toContain('boom');

    const noDefault = resolveReleaseBranch({ config: configFailure('default-missing') });
    expect(noDefault.branch).toBe(DEFAULT_RELEASE_BRANCH);
    expect(noDefault.warnings.join('\n')).toContain('缺少 default 导出');
  });

  it('warns and falls back for empty or illegal branches', () => {
    const empty = resolveReleaseBranch({ config: configOf({ releaseBranch: '  ' }) });
    expect(empty.branch).toBe(DEFAULT_RELEASE_BRANCH);
    expect(empty.warnings.join('\n')).toContain('无效');

    const wrongType = resolveReleaseBranch({ config: configOf({ releaseBranch: 42 }) });
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
