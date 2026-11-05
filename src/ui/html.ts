import * as crypto from 'node:crypto';
import type { WorkspaceState } from '../core/status';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const STYLES = `
  * { box-sizing: border-box; }
  body {
    padding: 12px;
    color: var(--vscode-foreground);
    background: transparent;
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
  }
  h1 { font-size: 15px; margin: 0 0 4px; font-weight: 600; }
  h2 { font-size: 13px; margin: 16px 0 8px; font-weight: 600; }
  p { margin: 6px 0; line-height: 1.5; }
  .muted { opacity: 0.75; }
  .card {
    border: 1px solid var(--vscode-panel-border);
    border-radius: 6px;
    padding: 10px;
    margin: 8px 0;
    background: var(--vscode-editorWidget-background);
  }
  .card.warn { border-left: 3px solid var(--vscode-editorWarning-foreground); }
  .card.error { border-left: 3px solid var(--vscode-errorForeground); }
  .card .title { font-weight: 600; margin-bottom: 4px; }
  .actions { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; }
  button {
    border: none;
    border-radius: 3px;
    padding: 5px 10px;
    cursor: pointer;
    color: var(--vscode-button-foreground);
    background: var(--vscode-button-background);
    font-family: inherit;
    font-size: inherit;
  }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button.secondary {
    color: var(--vscode-button-secondaryForeground);
    background: var(--vscode-button-secondaryBackground);
  }
  button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
  input[type="text"] {
    width: 100%;
    padding: 5px 7px;
    border-radius: 3px;
    border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
    color: var(--vscode-input-foreground);
    background: var(--vscode-input-background);
    font-family: inherit;
  }
  label.check { display: flex; gap: 6px; align-items: flex-start; margin: 8px 0; line-height: 1.4; }
  ul.projects { list-style: none; padding: 0; margin: 0; }
  li.project {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    border: 1px solid var(--vscode-panel-border);
    border-radius: 6px;
    padding: 8px 10px;
    margin-bottom: 6px;
  }
  .project-name { font-weight: 600; word-break: break-all; cursor: pointer; }
  .project-name:hover { text-decoration: underline; }
  .badges { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 4px; }
  .badge {
    font-size: 11px;
    border-radius: 10px;
    padding: 1px 7px;
    background: var(--vscode-badge-background);
    color: var(--vscode-badge-foreground);
  }
  .row { display: flex; gap: 6px; flex-wrap: wrap; }
  code { font-family: var(--vscode-editor-font-family); font-size: 12px; }
  .link { color: var(--vscode-textLink-foreground); cursor: pointer; }
  .link:hover { text-decoration: underline; }
`;

function renderIssueActions(
  issueId: string,
  remoteDirExists: boolean
): string {
  switch (issueId) {
    case 'local-git':
      return `<div class="actions"><button data-action="initGit">初始化 Git 仓库</button></div>`;
    case 'remote-url':
      return `<input type="text" id="remote-url" placeholder="https://github.com/owner/repo" />
        <label class="check"><input type="checkbox" id="immutability-confirm" />
        <span>我已在 GitHub 仓库设置中启用 <code>Enable release immutability</code>（扩展无法通过 API 检测该设置）。</span></label>
        <p class="muted">远程创意仓库必须由你手动创建，且为公开仓库。</p>
        <div class="actions"><button data-action="setRemote">保存并校验</button></div>`;
    case 'remote-dir':
      return `<div class="actions">
        <button data-action="clone">克隆远程仓库</button>
        ${remoteDirExists ? `<button class="secondary" data-action="reclone">重新克隆（删除现有 remote/）</button>` : ''}
      </div>`;
    case 'remote-mismatch':
      return `<div class="actions"><button data-action="reclone">重新克隆（删除现有 remote/）</button></div>`;
    case 'hook':
      return `<div class="actions"><button data-action="installHook">安装 / 修复 hook</button></div>`;
    default:
      return '';
  }
}

function renderMain(state: WorkspaceState, nonce: string): string {
  switch (state.kind) {
    case 'no-folder':
      return `
        <h1>创意仓库</h1>
        <div class="card"><p>您尚未打开任何文件夹。</p>
        <p class="muted">请先在 VS Code 中打开一个文件夹，再回到这里。</p></div>`;
    case 'empty-folder':
      return `
        <h1>创意仓库</h1>
        <div class="card">
          <p>当前文件夹为空，可以初始化本地创意仓库。</p>
          <p class="muted">初始化只会创建 Git 仓库、.ideahub 配置、pre-push hook 与 README，不会提交或推送任何内容。</p>
          <div class="actions">
            <button data-action="init">初始化本地仓库</button>
            <button class="secondary" data-action="refresh">重新检测</button>
          </div>
        </div>`;
    case 'not-ideahub':
      return `
        <h1>创意仓库</h1>
        <div class="card warn">
          <div class="title">未识别到创意仓库</div>
          <p>当前文件夹不为空，但没有 .ideahub 目录，因此不会自动初始化，以免覆盖已有内容。</p>
          <p class="muted">如果你确定要从头开始，请换一个空文件夹。</p>
          <div class="actions"><button class="secondary" data-action="refresh">重新检测</button></div>
        </div>`;
    case 'error':
      return `
        <h1>创意仓库</h1>
        <div class="card error"><div class="title">检测失败</div><p>${escapeHtml(state.message)}</p>
        <div class="actions"><button class="secondary" data-action="refresh">重新检测</button></div></div>`;
    case 'local':
      return renderLocal(state, nonce);
  }
}

function renderLocal(state: Extract<WorkspaceState, { kind: 'local' }>, nonce: string): string {
  const hasIssues = state.issues.length > 0;
  const issues = state.issues
    .map((issue) => {
      return `<div class="card warn">
        <div class="title">${escapeHtml(issue.title)}</div>
        <p>${escapeHtml(issue.message)}</p>
        ${renderIssueActions(issue.id, state.remoteDirExists)}
      </div>`;
    })
    .join('');

  const remoteInfo = state.remote
    ? `<p class="muted">远程创意仓库：<code>${escapeHtml(state.remote.owner)}/${escapeHtml(
        state.remote.repo
      )}</code>（分支 <code>${escapeHtml(state.remote.branch)}</code>）</p>`
    : '';

  const projects = hasIssues
    ? ''
    : state.projects.length === 0
      ? `<div class="card">
          <div class="title">还没有项目</div>
          <p>在仓库根目录新建一个文件夹（例如 <code>MyGame</code>），并在其中创建 <code>ideas.md</code>。</p>
          <p class="muted">只有包含 ideas.md 的根目录一级文件夹会被识别为项目。</p>
        </div>`
      : `<ul class="projects">${state.projects
          .map(
            (project) => `<li class="project">
              <div>
                <div class="project-name" data-action="open" data-project="${escapeHtml(project.name)}">${escapeHtml(
                  project.name
                )}</div>
                <div class="badges"></div>
              </div>
              <div class="actions">
                <button data-action="mark" data-project="${escapeHtml(project.name)}">标记</button>
                <button class="secondary" data-action="publish" data-project="${escapeHtml(
                  project.name
                )}">发布</button>
              </div>
            </li>`
          )
          .join('')}</ul>`;

  return `
    <h1>创意仓库</h1>
    <p class="muted">${escapeHtml(state.root)}</p>
    ${remoteInfo}
    <div class="actions">
      <button class="secondary" data-action="refresh">刷新状态</button>
    </div>
    ${hasIssues ? `<h2>需要完成的配置</h2>${issues}` : `<h2>项目</h2>${projects}`}
    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      document.addEventListener('click', (event) => {
        const target = event.target.closest('[data-action]');
        if (!target || !target.dataset.action) { return; }
        const action = target.dataset.action;
        if (action === 'open') {
          vscode.postMessage({ type: 'open', project: target.dataset.project });
          return;
        }
        if (action === 'setRemote') {
          const urlInput = document.getElementById('remote-url');
          const confirmInput = document.getElementById('immutability-confirm');
          vscode.postMessage({
            type: 'setRemote',
            url: urlInput ? urlInput.value : '',
            immutabilityConfirmed: !!(confirmInput && confirmInput.checked)
          });
          return;
        }
        vscode.postMessage({ type: action });
      });
    </script>`;
}

export function renderMainHtml(state: WorkspaceState): string {
  const nonce = crypto.randomBytes(16).toString('base64');
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>创意仓库</title>
<style>${STYLES}</style>
</head>
<body>${renderMain(state, nonce)}</body>
</html>`;
}
