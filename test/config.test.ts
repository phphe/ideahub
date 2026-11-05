import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { configPath, readConfig, writeConfig } from '../src/core/config';
import { validateProjectName } from '../src/core/projects';

async function tempRoot(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'ideahub-config-'));
}

describe('config persistence', () => {
  it('round-trips a remote configuration', async () => {
    const root = await tempRoot();
    await writeConfig(root, {
      version: 1,
      remote: {
        provider: 'github',
        owner: 'owner',
        repo: 'repo',
        url: 'https://github.com/owner/repo',
        branch: 'main'
      }
    });
    const result = await readConfig(root);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.remote?.owner).toBe('owner');
      expect(result.config.remote?.branch).toBe('main');
    }
    await fs.rm(root, { recursive: true, force: true });
  });

  it('reports a missing config file', async () => {
    const root = await tempRoot();
    const result = await readConfig(root);
    expect(result.ok).toBe(false);
    await fs.rm(root, { recursive: true, force: true });
  });

  it('rejects invalid JSON, versions and inconsistent owner/repo', async () => {
    const root = await tempRoot();
    await fs.mkdir(path.dirname(configPath(root)), { recursive: true });

    await fs.writeFile(configPath(root), '{invalid', 'utf8');
    expect((await readConfig(root)).ok).toBe(false);

    await fs.writeFile(configPath(root), '{"version":2}', 'utf8');
    expect((await readConfig(root)).ok).toBe(false);

    await fs.writeFile(
      configPath(root),
      JSON.stringify({
        version: 1,
        remote: {
          provider: 'github',
          owner: 'other',
          repo: 'repo',
          url: 'https://github.com/owner/repo',
          branch: 'main'
        }
      }),
      'utf8'
    );
    expect((await readConfig(root)).ok).toBe(false);
    await fs.rm(root, { recursive: true, force: true });
  });

  it('accepts a version-1 config without a remote', async () => {
    const root = await tempRoot();
    await writeConfig(root, { version: 1 });
    const result = await readConfig(root);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.remote).toBeUndefined();
    }
    await fs.rm(root, { recursive: true, force: true });
  });
});

describe('validateProjectName', () => {
  it('accepts normal names and rejects forbidden ones', () => {
    expect(validateProjectName('My Game')).toBeNull();
    expect(validateProjectName('')).not.toBeNull();
    expect(validateProjectName('.hidden')).not.toBeNull();
    expect(validateProjectName('a/b')).not.toBeNull();
    expect(validateProjectName('a:b')).not.toBeNull();
    expect(validateProjectName('My Game', ['my game'])).not.toBeNull();
    expect(validateProjectName('My Game', [], ['my game'])).not.toBeNull();
  });
});
