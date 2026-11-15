import { describe, expect, it } from 'vitest';
import type { WorkspaceState, ProjectSummary } from '@ideahub/core';
import {
  PROJECT_FILTER_THRESHOLD,
  renderMainHtml,
  renderSettingsHtml,
  sortProjects,
  type RemoteSettingsInfo
} from '../src/ui/html';

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
    expect(nonEmpty).toContain('<h1>IdeaHub</h1>');
    expect(nonEmpty).toContain('<div class="title">No idea repository detected</div>');
    expect(nonEmpty).toContain('data-action="initNonEmpty"');
    expect(nonEmpty).toContain('>Initialize anyway</button>');
    expect(nonEmpty).toContain('existing files are never overwritten');
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
        canPublish: true,
        tags: []
      }
    ],
    remoteStatus: {
      available: true,
      projects: { MyGame: { published: false, latestProofAt: null } }
    }
  };

  it('marks each project item and its badge row for in-place watcher updates', () => {
    const html = renderMainHtml(state);
    expect(html).toContain('<li class="project" data-project-item="MyGame" data-has-new="');
    expect(html).toContain('<span class="project-badges" data-project-badges>');
    expect(html).toContain('.project-badges { display: contents; }');
    expect(html).toContain('data-project-item]');
    expect(html).toContain("data.type === 'projectBadges'");
  });

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
    expect(html).toContain('title="Number of generated proofs">2 proofs</span>');
    expect(html).toContain(
      'class="badge badge-warning" title="There is new content that has not been proven yet">Unproven</span>'
    );
    expect(html).toContain('title="Number of publishes">Published 3 times</span>');
    expect(html).toContain('title="The proven content can be published">Publishable</span>');
    expect(html).not.toContain('最近证明');
    expect(html).not.toContain('Unpublished</span>');
    expect(html).not.toContain('Remote status is temporarily unavailable');
  });

  it('hides 未证明, 发布N次 and 可发布 when they do not apply', () => {
    const emptyState: WorkspaceState = {
      ...state,
      projects: [
        {
          name: 'EmptyGame',
          proofCount: 0,
          proofTags: [],
          publishedCount: 0,
          hasNewContent: false,
          canPublish: false,
          tags: []
        }
      ]
    };
    const html = renderMainHtml(emptyState);
    expect(html).toContain('>0 proofs</span>');
    expect(html).not.toContain('>Unproven</span>');
    expect(html).not.toContain('>Published 0 times</span>');
    expect(html).not.toContain('>Publishable</span>');
  });

  it('renders the proof and publish buttons with secondary styling and tooltips', () => {
    const html = renderMainHtml(state);
    expect(html).toContain('class="secondary" data-action="mark"');
    expect(html).toContain('class="secondary" data-action="publish"');
    expect(html).toContain('title="Publish a time proof for the new content"');
    expect(html).toContain('>Prove</button>');
    expect(html).toContain('title="Publish the original idea text"');
    expect(html).toContain('>Publish</button>');
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
    expect(html).toContain('<h1>Idea projects</h1>');
    expect(html).toContain('.header-actions { margin-left: auto;');
    expect(html).toContain('class="icon" data-action="refresh"');
    expect(html).toContain('class="icon" data-action="openSettings"');
    expect(html).toContain('class="icon" data-action="createProject" title="New project"');
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
      'title="Workspace: C:/repo | Remote idea repository: phphe/test_1027e9ad9a (branch main)"'
    );
    expect(html).toContain('Remote idea repository: phphe/test_1027e9ad9a (branch main)');

    // The old info line under the title is gone.
    expect(html).not.toContain('<p class="muted">C:/repo</p>');
    expect(html).not.toContain('<p class="muted">Remote idea repository');
  });
});

describe('project ordering, filter and status chips', () => {
  function project(
    name: string,
    options: Partial<ProjectSummary> = {}
  ): ProjectSummary {
    return {
      name,
      proofCount: 1,
      proofTags: [],
      publishedCount: 0,
      hasNewContent: false,
      canPublish: false,
      tags: [],
      ...options
    };
  }

  function localState(projects: ProjectSummary[]): WorkspaceState {
    return {
      kind: 'local',
      root: 'C:/repo',
      remote: null,
      configError: null,
      remoteDirExists: false,
      issues: [],
      projects
    };
  }

  it('orders projects by ideas.md mtime descending, then by name', () => {
    const projects = [
      project('zeta', { updatedAt: 500, hasNewContent: true }),
      project('alpha', { updatedAt: 100 }),
      project('beta', { updatedAt: 300, canPublish: true }),
      project('publishable', { canPublish: true, updatedAt: 1 }),
      project('pending', { hasNewContent: true, updatedAt: 2 }),
      project('tagged', { tags: ['游戏'], updatedAt: 400 })
    ];

    const sorted = sortProjects(projects).map((entry) => entry.name);
    expect(sorted).toEqual(['zeta', 'tagged', 'beta', 'alpha', 'pending', 'publishable']);
    // The input array is never mutated, and the order is deterministic.
    expect(projects.map((entry) => entry.name)).toEqual([
      'zeta',
      'alpha',
      'beta',
      'publishable',
      'pending',
      'tagged'
    ]);
    expect(sortProjects(projects).map((entry) => entry.name)).toEqual(sorted);
  });

  it('ignores status badges and tags when ordering', () => {
    const projects = [
      project('fresh', { hasNewContent: true, updatedAt: 100, tags: ['游戏'] }),
      project('stale', { updatedAt: 200, tags: ['写作'] })
    ];
    expect(sortProjects(projects).map((entry) => entry.name)).toEqual(['stale', 'fresh']);
  });

  it('breaks the recency tie with a case-insensitive name order', () => {
    const sorted = sortProjects([
      project('Bravo', { updatedAt: 100 }),
      project('alpha', { updatedAt: 100 })
    ]).map((entry) => entry.name);
    expect(sorted).toEqual(['alpha', 'Bravo']);
  });

  it('does not render the filter input for 10 or fewer projects', () => {
    const projects = Array.from({ length: PROJECT_FILTER_THRESHOLD }, (_value, index) =>
      project(`Game${index}`)
    );
    const html = renderMainHtml(localState(projects));

    expect(html).not.toContain('id="project-filter"');
    expect(html).not.toContain('No matching projects');
    expect(html).toContain('data-chip="all"');
  });

  it('renders the filter input above the list for more than 10 projects', () => {
    const projects = Array.from({ length: PROJECT_FILTER_THRESHOLD + 1 }, (_value, index) =>
      project(`Game${index}`)
    );
    const html = renderMainHtml(localState(projects));

    expect(html).toContain('id="project-filter"');
    expect(html).toContain('No matching projects');
    expect(html.indexOf('id="project-filter"')).toBeLessThan(
      html.indexOf('<ul class="projects">')
    );
  });

  it('shows chip counts from the in-memory state and dims zero counts', () => {
    const html = renderMainHtml(
      localState([
        project('fresh', { hasNewContent: true }),
        project('ready', { canPublish: true }),
        project('published', { publishedCount: 2 })
      ])
    );

    expect(html).toContain('data-chip="all" aria-pressed="true">All 3</button>');
    expect(html).toContain('data-chip="new" aria-pressed="false">Unproven 1</button>');
    expect(html).toContain('data-chip="publishable" aria-pressed="false">Publishable 1</button>');
    expect(html).toContain('data-chip="unpublished" aria-pressed="false">Unpublished 2</button>');
  });

  it('keeps zero-count chips visible but dims them', () => {
    const html = renderMainHtml(
      localState([project('published', { publishedCount: 2 })])
    );

    expect(html).toContain('class="chip is-empty chip-warning" data-chip="new" aria-pressed="false">Unproven 0</button>');
    expect(html).toContain(
      'class="chip is-empty" data-chip="publishable" aria-pressed="false">Publishable 0</button>'
    );
    expect(html).toContain(
      'class="chip is-empty" data-chip="unpublished" aria-pressed="false">Unpublished 0</button>'
    );
  });

  it('exposes the status flags used by the chip filter on each project item', () => {
    const html = renderMainHtml(
      localState([
        project('fresh', { hasNewContent: true }),
        project('published', { publishedCount: 4 })
      ])
    );

    expect(html).toContain(
      'data-project-item="fresh" data-has-new="true" data-can-publish="false" data-published="false"'
    );
    expect(html).toContain(
      'data-project-item="published" data-has-new="false" data-can-publish="false" data-published="true"'
    );
  });

  it('renders projects by mtime descending regardless of status', () => {
    const html = renderMainHtml(
      localState([
        project('old', { updatedAt: 100 }),
        project('pending', { hasNewContent: true }),
        project('new', { updatedAt: 900 })
      ])
    );

    expect(html.indexOf('data-project-item="new"')).toBeLessThan(
      html.indexOf('data-project-item="old"')
    );
    expect(html.indexOf('data-project-item="old"')).toBeLessThan(
      html.indexOf('data-project-item="pending"')
    );
  });
});

describe('renderSettingsHtml', () => {
  const info: RemoteSettingsInfo = {
    url: 'https://github.com/phphe/test_1027e9ad9a',
    owner: 'phphe',
    repo: 'test_1027e9ad9a',
    host: 'github.com',
    branch: 'main',
    visibility: 'Public',
    immutability: 'Release immutability is enabled',
    error: null,
    display: {
      url: 'https://github.com/phphe/test_1027e9ad9a',
      ownerRepo: 'phphe/test_1027e9ad9a',
      host: 'github.com',
      branch: 'main'
    }
  };

  it('shows the current remote repository details', () => {
    const html = renderSettingsHtml(info);
    expect(html).toContain('Remote idea repository');
    expect(html).toContain(
      'URL: </span><span id="settings-url">https://github.com/phphe/test_1027e9ad9a'
    );
    expect(html).toContain('owner/repo: </span><span id="settings-owner-repo">phphe/test_1027e9ad9a');
    expect(html).toContain('host: </span><span id="settings-host">github.com');
    expect(html).toContain('Branch: </span><span id="settings-branch">main');
    expect(html).toContain('Public: </span><span id="settings-visibility">Public');
    expect(html).toContain(
      'Immutability: </span><span id="settings-immutability">Release immutability is enabled'
    );
    expect(html).toContain('codicon codicon-arrow-left');
    expect(html).toContain('title="Back to IdeaHub"');
    expect(html).toContain('<title>IdeaHub - Settings</title>');
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
    expect(html).toContain('id="remote-branch"');
    expect(html).toContain('only committed to the local repository');
  });

  it('renders unconfigured values and API errors without crashing', () => {
    const html = renderSettingsHtml({
      ...info,
      url: '',
      owner: null,
      repo: null,
      host: null,
      branch: null,
      visibility: 'Unknown',
      immutability: 'Unknown (not signed in to GitHub, so the API check is unavailable)',
      error: 'No remote idea repository is configured yet.',
      display: {
        url: 'Not configured',
        ownerRepo: 'Not configured',
        host: 'Unknown',
        branch: 'Unknown'
      }
    });
    expect(html).toContain('URL: </span><span id="settings-url">Not configured');
    expect(html).toContain('owner/repo: </span><span id="settings-owner-repo">Not configured');
    expect(html).toContain(
      'Immutability: </span><span id="settings-immutability">Unknown (not signed in to GitHub, so the API check is unavailable)'
    );
    expect(html).toContain('No remote idea repository is configured yet.');
  });
});
