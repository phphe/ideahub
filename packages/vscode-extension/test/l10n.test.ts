import { describe, expect, it } from 'vitest';
import type { WorkspaceState } from '@ideahub/core';
import { renderMainHtml, renderSettingsHtml } from '../src/ui/html';
import { loadZhBundle, zhL10n } from './helpers/l10n';

function placeholders(text: string): string {
  return [...text.matchAll(/\{(\d+)\}/g)]
    .map((match) => match[1])
    .sort()
    .join(',');
}

const STATE: WorkspaceState = {
  kind: 'local',
  root: 'C:/repo',
  remote: null,
  configError: null,
  remoteDirExists: false,
  issues: [],
  projects: [
    {
      name: 'Game',
      proofCount: 2,
      proofTags: [],
      publishedCount: 3,
      hasNewContent: true,
      canPublish: true,
      tags: []
    }
  ]
};

describe('zh-cn l10n bundle', () => {
  it('has a non-empty translation with the same placeholders as each English key', () => {
    const bundle = loadZhBundle();
    const keys = Object.keys(bundle);
    expect(keys.length).toBeGreaterThan(100);
    for (const key of keys) {
      expect(bundle[key].trim().length).toBeGreaterThan(0);
      expect(placeholders(bundle[key])).toBe(placeholders(key));
    }
  });

  it('renders English by default and Chinese when the bundle is injected', () => {
    const english = renderMainHtml(STATE);
    expect(english).toContain('<html lang="en">');
    expect(english).toContain('Unproven');
    expect(english).toContain('Published 3 times');
    expect(english).not.toContain('未证明');

    const chinese = renderMainHtml(STATE, undefined, zhL10n(), 'zh-cn');
    expect(chinese).toContain('<html lang="zh-cn">');
    expect(chinese).toContain('未证明');
    expect(chinese).toContain('发布 3 次');
    expect(chinese).toContain('<h1>创意项目</h1>');
  });

  it('translates the settings labels through the same translator', () => {
    const html = renderSettingsHtml(
      {
        url: 'https://github.com/phphe/demo',
        owner: 'phphe',
        repo: 'demo',
        host: 'github.com',
        branch: 'main',
        visibility: '公开',
        error: null,
        display: {
          url: 'https://github.com/phphe/demo',
          ownerRepo: 'phphe/demo',
          host: 'github.com',
          branch: 'main'
        }
      },
      undefined,
      zhL10n(),
      'zh-cn'
    );
    expect(html).toContain('远程创意仓库');
    expect(html).toContain('地址: </span>');
    expect(html).toContain('修改远程仓库地址');
    expect(html).toContain('<title>创意仓库 - 设置</title>');
  });
});
