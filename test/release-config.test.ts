import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RELEASE_BRANCH,
  RELEASE_BRANCH_ENV_KEY,
  RELEASE_CONFIG_FILE,
  loadReleaseBranch,
  releaseConfigPath
} from '../src/core/release-config';

async function tempRoot(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'ideahub-release-config-'));
}

async function cleanup(root: string): Promise<void> {
  await fs.rm(root, { recursive: true, force: true });
}

describe('loadReleaseBranch', () => {
  it('falls back to main when the config file is missing', async () => {
    const root = await tempRoot();
    const result = await loadReleaseBranch(root);

    expect(result.branch).toBe(DEFAULT_RELEASE_BRANCH);
    expect(result.source).toBe('default');
    expect(result.warnings.join('\n')).toContain(RELEASE_CONFIG_FILE);
    await cleanup(root);
  });

  it('reads releaseBranch from ideahub.config.json', async () => {
    const root = await tempRoot();
    await fs.writeFile(
      releaseConfigPath(root),
      JSON.stringify({ releaseBranch: 'release/empty' }),
      'utf8'
    );

    const result = await loadReleaseBranch(root);

    expect(result).toEqual({ branch: 'release/empty', source: 'file', warnings: [] });
    await cleanup(root);
  });

  it('warns and falls back for invalid JSON or an empty branch', async () => {
    const root = await tempRoot();

    await fs.writeFile(releaseConfigPath(root), '{invalid', 'utf8');
    const invalidJson = await loadReleaseBranch(root);
    expect(invalidJson.branch).toBe(DEFAULT_RELEASE_BRANCH);
    expect(invalidJson.warnings.join('\n')).toContain('不是有效的 JSON');

    await fs.writeFile(releaseConfigPath(root), JSON.stringify({ releaseBranch: '  ' }), 'utf8');
    const empty = await loadReleaseBranch(root);
    expect(empty.branch).toBe(DEFAULT_RELEASE_BRANCH);
    expect(empty.warnings.join('\n')).toContain('无效');

    await fs.writeFile(releaseConfigPath(root), JSON.stringify({ releaseBranch: 42 }), 'utf8');
    const wrongType = await loadReleaseBranch(root);
    expect(wrongType.branch).toBe(DEFAULT_RELEASE_BRANCH);
    expect(wrongType.warnings.join('\n')).toContain('必须是字符串');

    await cleanup(root);
  });

  it('prefers .env over ideahub.config.json', async () => {
    const root = await tempRoot();
    await fs.writeFile(
      releaseConfigPath(root),
      JSON.stringify({ releaseBranch: 'from-file' }),
      'utf8'
    );
    await fs.writeFile(path.join(root, '.env'), `${RELEASE_BRANCH_ENV_KEY}=from-env\n`, 'utf8');

    const result = await loadReleaseBranch(root);

    expect(result.branch).toBe('from-env');
    expect(result.source).toBe('env');
    await cleanup(root);
  });

  it('ignores an empty or invalid .env value and falls through to the file', async () => {
    const root = await tempRoot();
    await fs.writeFile(
      releaseConfigPath(root),
      JSON.stringify({ releaseBranch: 'from-file' }),
      'utf8'
    );

    await fs.writeFile(path.join(root, '.env'), `${RELEASE_BRANCH_ENV_KEY}=\n`, 'utf8');
    const emptyEnv = await loadReleaseBranch(root);
    expect(emptyEnv.branch).toBe('from-file');
    expect(emptyEnv.warnings.join('\n')).toContain('为空');

    await fs.writeFile(path.join(root, '.env'), `${RELEASE_BRANCH_ENV_KEY}=bad branch\n`, 'utf8');
    const invalidEnv = await loadReleaseBranch(root);
    expect(invalidEnv.branch).toBe('from-file');
    expect(invalidEnv.warnings.join('\n')).toContain('无效');

    await cleanup(root);
  });
});
