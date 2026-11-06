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

  it('does not render any notice container or banner', () => {
    const states: WorkspaceState[] = [
      { kind: 'no-folder' },
      { kind: 'empty-folder', root: 'C:/empty' },
      { kind: 'error', message: '<bad> & error' }
    ];

    for (const state of states) {
      const html = renderMainHtml(state);
      expect(html).not.toContain('id="notice"');
      expect(html).not.toContain('class="notice');
      expect(html).not.toContain('role="alert"');
    }
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
        proofTags: ['ideahub-' + 'a'.repeat(64)],
        publishedCount: 3,
        hasNewContent: true,
        canPublish: true
      }
    ],
    remoteStatus: {
      available: true,
      projects: { MyGame: { published: false, latestProofAt: null } }
    }
  };

  it('renders a borderless project with name and badges on a wrapping row', () => {
    const html = renderMainHtml(state);
    expect(html).toContain('li.project {');
    expect(html).toContain('border: none;');
    expect(html).toContain('.project-head { display: flex; flex-wrap: wrap;');
    expect(html.match(/<div class="project-head">/g)).toHaveLength(1);
    expect(html).not.toContain('class="project-line');
  });

  it('renders exactly the four supported badges with titles', () => {
    const html = renderMainHtml(state);
    expect(html).toContain('title="已生成的证明数量">2个证明</span>');
    expect(html).toContain('title="存在尚未证明的新内容">有新内容</span>');
    expect(html).toContain('title="已发布的次数">发布3次</span>');
    expect(html).toContain('title="已证明的内容可以发布">可发布</span>');
    expect(html).not.toContain('最近证明');
    expect(html).not.toContain('未发布');
    expect(html).not.toContain('远程状态不可用');
  });

  it('hides 有新内容, 发布N次 and 可发布 when they do not apply', () => {
    const emptyState: WorkspaceState = {
      ...state,
      projects: [
        {
          name: 'EmptyGame',
          proofCount: 0,
          proofTags: [],
          publishedCount: 0,
          hasNewContent: false,
          canPublish: false
        }
      ]
    };
    const html = renderMainHtml(emptyState);
    expect(html).toContain('>0个证明</span>');
    expect(html).not.toContain('>有新内容</span>');
    expect(html).not.toContain('>发布0次</span>');
    expect(html).not.toContain('>可发布</span>');
  });

  it('renders the proof and publish buttons with secondary styling and tooltips', () => {
    const html = renderMainHtml(state);
    expect(html).toContain('class="secondary" data-action="mark"');
    expect(html).toContain('class="secondary" data-action="publish"');
    expect(html).toContain('title="发布新增内容的时间证明"');
    expect(html).toContain('>证明</button>');
    expect(html).toContain('title="发布创意原文"');
    expect(html).toContain('>发布</button>');
  });

  it('does not mention the old rename warning', () => {
    const html = renderMainHtml(state);
    expect(html).not.toContain('已有证明，不建议重命名项目文件夹');
  });

  it('puts the refresh button on the title row and moves info into its tooltip', () => {
    const html = renderMainHtml({
      ...state,
      remote: {
        provider: 'github',
        owner: 'phphe',
        repo: 'test_1027e9ad9a',
        url: 'https://github.com/phphe/test_1027e9ad9a',
        branch: 'main'
      }
    });

    expect(html).toContain('<div class="header">');
    expect(html).toContain('<h1>创意仓库</h1>');
    expect(html).toContain('.header > button { margin-left: auto; }');
    expect(html).toMatch(
      /<button class="secondary" data-action="refresh" title="[^"]*工作区：C:\/repo[^"]*">刷新状态<\/button>/
    );
    expect(html).toContain('远程创意仓库：phphe/test_1027e9ad9a（分支 main）');

    // The old info line under the title is gone.
    expect(html).not.toContain('<p class="muted">C:/repo</p>');
    expect(html).not.toContain('<p class="muted">远程创意仓库');
  });
});
