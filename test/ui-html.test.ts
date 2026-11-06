import { describe, expect, it } from 'vitest';
import type { WorkspaceState } from '../src/core/status';
import { renderMainHtml, renderSettingsHtml, type RemoteSettingsInfo } from '../src/ui/html';

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
    expect(html).not.toContain('正在处理');
    expect(html).not.toContain('id="status"');
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

  it('links the packaged codicon stylesheet and trusts only extension-local fonts', () => {
    const html = renderMainHtml(
      { kind: 'no-folder' },
      {
        cspSource: 'vscode-resource:',
        codiconCssUri: 'vscode-resource:/media/codicon.css'
      }
    );
    expect(html).toContain(
      '<link rel="stylesheet" href="vscode-resource:/media/codicon.css" />'
    );
    expect(html).toContain("font-src vscode-resource:;");
    expect(html).toContain("style-src vscode-resource: 'unsafe-inline';");
  });

  it('offers an explicit init entry only for a non-empty unrecognised folder', () => {
    const empty = renderMainHtml({ kind: 'empty-folder', root: 'C:/empty' });
    expect(empty).not.toContain('initNonEmpty');

    const nonEmpty = renderMainHtml({ kind: 'not-ideahub', root: 'C:/non-empty' });
    expect(nonEmpty).toContain('<div class="title">未识别到创意仓库</div>');
    expect(nonEmpty).toContain('data-action="initNonEmpty"');
    expect(nonEmpty).toContain('>仍要初始化</button>');
    expect(nonEmpty).toContain('已存在的文件不会被覆盖');
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

  it('renders refresh and settings icon buttons on the title row', () => {
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
    expect(html).toContain('<h1>创意项目</h1>');
    expect(html).toContain('.header-actions { margin-left: auto;');
    expect(html).toContain('class="icon" data-action="refresh"');
    expect(html).toContain('class="icon" data-action="openSettings"');
    expect(html).toContain('class="icon" data-action="createProject" title="新建项目"');
    expect(html).toContain('codicon codicon-add');
    expect(html).toContain('codicon codicon-refresh');
    expect(html).toContain('codicon codicon-settings-gear');
    expect(html.indexOf('data-action="createProject"')).toBeLessThan(
      html.indexOf('data-action="refresh"')
    );
    expect(html).not.toContain('<h2>项目</h2>');
    expect(html).not.toContain('>刷新状态</button>');
    expect(html).not.toContain('>新建项目</button>');
    expect(html).not.toContain('id="status"');
    expect(html).toContain(
      'title="工作区：C:/repo | 远程创意仓库：phphe/test_1027e9ad9a（分支 main）"'
    );
    expect(html).toContain('远程创意仓库：phphe/test_1027e9ad9a（分支 main）');

    // The old info line under the title is gone.
    expect(html).not.toContain('<p class="muted">C:/repo</p>');
    expect(html).not.toContain('<p class="muted">远程创意仓库');
  });
});

describe('renderSettingsHtml', () => {
  const info: RemoteSettingsInfo = {
    url: 'https://github.com/phphe/test_1027e9ad9a',
    owner: 'phphe',
    repo: 'test_1027e9ad9a',
    host: 'github.com',
    branch: 'main',
    visibility: '公开',
    immutability: '已启用 Release 不可变性',
    error: null
  };

  it('shows the current remote repository details', () => {
    const html = renderSettingsHtml(info);
    expect(html).toContain('远程创意仓库');
    expect(html).toContain(
      '地址：</span><span id="settings-url">https://github.com/phphe/test_1027e9ad9a'
    );
    expect(html).toContain('owner/repo：</span><span id="settings-owner-repo">phphe/test_1027e9ad9a');
    expect(html).toContain('host：</span><span id="settings-host">github.com');
    expect(html).toContain('分支：</span><span id="settings-branch">main');
    expect(html).toContain('是否公开：</span><span id="settings-visibility">公开');
    expect(html).toContain(
      '不可变性：</span><span id="settings-immutability">已启用 Release 不可变性'
    );
    expect(html).toContain('codicon codicon-arrow-left');
    expect(html).toContain('data.type === \'settingsInfo\'');
    expect(html).not.toContain('id="status"');
  });

  it('only allows changing the remote URL through the validated setRemote flow', () => {
    const html = renderSettingsHtml(info);
    expect(html).toContain('id="remote-url"');
    expect(html).toContain('value="https://github.com/phphe/test_1027e9ad9a"');
    expect(html).toContain('id="immutability-confirm"');
    expect(html).toContain('class="actions">\n        <button data-action="setRemote">');
    expect(html).toContain('data-action="closeSettings"');
    expect(html).not.toContain('data-action="clone"');
    expect(html).not.toContain('data-action="publish"');
    expect(html).toContain('不会自动提交、推送或公开任何内容');
  });

  it('renders unconfigured values and API errors without crashing', () => {
    const html = renderSettingsHtml({
      ...info,
      url: '',
      owner: null,
      repo: null,
      host: null,
      branch: null,
      visibility: '未知',
      immutability: '未知（未登录 GitHub，无法通过 API 检查）',
      error: '尚未配置远程创意仓库。'
    });
    expect(html).toContain('地址：</span><span id="settings-url">未配置');
    expect(html).toContain('owner/repo：</span><span id="settings-owner-repo">未配置');
    expect(html).toContain(
      '不可变性：</span><span id="settings-immutability">未知（未登录 GitHub，无法通过 API 检查）'
    );
    expect(html).toContain('尚未配置远程创意仓库。');
  });
});
