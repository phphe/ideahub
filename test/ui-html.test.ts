import { describe, expect, it } from 'vitest';
import type { WorkspaceState } from '../src/core/status';
import { renderMainHtml } from '../src/ui/html';

describe('renderMainHtml', () => {
  it('includes the message script for every workspace state', () => {
    const states: WorkspaceState[] = [
      { kind: 'no-folder' },
      { kind: 'empty-folder', root: 'C:/empty' },
      { kind: 'not-ideahub', root: 'C:/non-empty' },
      { kind: 'error', message: 'boom' }
    ];

    for (const state of states) {
      const html = renderMainHtml(state);
      expect(html).toMatch(/<script nonce="[^"]+">/);
      expect(html).toContain('acquireVsCodeApi');
      expect(html).toContain("vscode.postMessage({ type: action");
    }
  });

  it('renders the init button and the shared script together for an empty folder', () => {
    const html = renderMainHtml({ kind: 'empty-folder', root: 'C:/empty' });
    expect(html).toContain('data-action="init"');
    expect(html).toContain('正在处理');
  });

  it('shows a notice with escaped content', () => {
    const html = renderMainHtml({ kind: 'no-folder' }, { kind: 'error', text: '<bad> & error' });
    expect(html).toContain('class="notice error"');
    expect(html).toContain('&lt;bad&gt; &amp; error');
  });
});

describe('renderMainHtml project list', () => {
  const state: WorkspaceState = {
    kind: 'local',
    root: 'C:/repo',
    remote: null,
    configError: null,
    remoteDirExists: false,
    issues: [],
    projects: [
      {
        name: 'MyGame',
        proofCount: 2,
        proofTags: ['ideahub-20261106T103328Z'],
        latestProofTime: '2026-11-06 18:33:28 (UTC+08:00)',
        hasNewContent: true
      }
    ],
    remoteStatus: {
      available: true,
      projects: { MyGame: { published: false, latestProofAt: null } }
    }
  };

  it('renders a borderless project item with three lines', () => {
    const html = renderMainHtml(state);
    expect(html).toContain('li.project {');
    expect(html).toContain('border: none;');
    expect(html.match(/<div class="project-line/g)).toHaveLength(3);
  });

  it('renders the proof and publish buttons with tooltips', () => {
    const html = renderMainHtml(state);
    expect(html).toContain('title="发布新增内容的时间证明"');
    expect(html).toContain('>证明</button>');
    expect(html).toContain('title="发布创意原文"');
    expect(html).toContain('>发布</button>');
  });

  it('does not mention the old rename warning', () => {
    const html = renderMainHtml(state);
    expect(html).not.toContain('已有证明，不建议重命名项目文件夹');
  });
});
