import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();

interface ConfigurationProperty {
  type?: string;
  default?: unknown;
  description?: string;
}

interface PackageJson {
  contributes: {
    configuration: {
      properties: Record<string, ConfigurationProperty>;
    };
  };
}

async function readSettings(): Promise<Record<string, ConfigurationProperty>> {
  const raw = await fs.readFile(path.join(ROOT, 'package.json'), 'utf8');
  return (JSON.parse(raw) as PackageJson).contributes.configuration.properties;
}

describe('package.json contributes.configuration', () => {
  it('exposes exactly the proof and publish settings', async () => {
    const properties = await readSettings();
    expect(Object.keys(properties).sort()).toEqual([
      'ideahub.proof.autoCommit',
      'ideahub.proof.commitMessage',
      'ideahub.publish.commitMessage'
    ]);
    expect(Object.keys(properties).some((key) => key.startsWith('ideahub.mark.'))).toBe(false);
  });

  it('keeps the expected defaults and placeholders', async () => {
    const properties = await readSettings();
    expect(properties['ideahub.proof.autoCommit']).toMatchObject({
      type: 'boolean',
      default: true
    });
    expect(properties['ideahub.proof.commitMessage']).toMatchObject({
      type: 'string',
      default: 'feat(ideas): record proof for {project}'
    });
    expect(properties['ideahub.publish.commitMessage']).toMatchObject({
      type: 'string',
      default: 'feat(ideas): mark {project} as published'
    });
    for (const key of ['ideahub.proof.commitMessage', 'ideahub.publish.commitMessage']) {
      expect(properties[key].description).toContain('{project}');
      expect(properties[key].description).toContain('{time}');
    }
  });
});

describe('controller settings lookup', () => {
  it('reads the new namespaces and never the legacy ideahub.mark keys', async () => {
    const source = await fs.readFile(path.join(ROOT, 'src', 'ui', 'controller.ts'), 'utf8');
    expect(source).toContain("getConfiguration('ideahub.proof')");
    expect(source).toContain("getConfiguration('ideahub.publish')");
    expect(source).not.toContain('ideahub.mark.');
  });
});
