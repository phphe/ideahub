import * as crypto from 'node:crypto';
import type { ProjectSummary, WorkspaceState } from '../core/status';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderScript(nonce: string): string {
  return `<script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const statusEl = document.getElementById('status');

    function setBusy(text) {
      if (statusEl) {
        statusEl.textContent = text;
        statusEl.hidden = false;
      }
      document.querySelectorAll('button').forEach(function (button) {
        button.disabled = true;
      });
    }

    window.addEventListener('error', function (event) {
      vscode.postMessage({
        type: 'uiError',
        message: String((event && event.message) || '未知的前端错误')
      });
    });

    document.addEventListener('click', function (event) {
      const target = event.target.closest('[data-action]');
      if (!target || !target.dataset.action) { return; }
      const action = target.dataset.action;
      if (action === 'setRemote') {
        const urlInput = document.getElementById('remote-url');
        const confirmInput = document.getElementById('immutability-confirm');
        setBusy('步骤 1/2：正在校验远程创意仓库…');
        vscode.postMessage({
          type: 'setRemote',
          url: urlInput ? urlInput.value : '',
          immutabilityConfirmed: !!(confirmInput && confirmInput.checked)
        });
        return;
      }
      if (action === 'open') {
        vscode.postMessage({ type: 'open', project: target.dataset.project });
        return;
      }
      if (action === 'createProject') {
        vscode.postMessage({ type: 'createProject' });
        return;
      }
      setBusy('正在处理…');
      vscode.postMessage({ type: action, project: target.dataset.project });
    });
  </script>`;
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
  .header {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 4px;
  }
  .header h1 { margin: 0; flex: 0 0 auto; }
  .header > button { margin-left: auto; }
  .status { margin: 0 0 8px; opacity: 0.85; font-style: italic; }
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
  button:disabled { opacity: 0.6; cursor: default; }
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
    flex-direction: column;
    gap: 6px;
    padding: 8px 0;
    margin-bottom: 6px;
    border: none;
  }
  .project-head { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
  .project-actions { display: flex; gap: 6px; flex-wrap: wrap; }
  .project-name { font-weight: 600; word-break: break-all; cursor: pointer; }
  .project-name:hover { text-decoration: underline; }
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
        <span>我已确认仓库启用了 <code>Enable release immutability</code>。扩展会先通过 GitHub API 检测；只有无法读取（需要仓库 admin 读权限）时才以此手动确认为准。</span></label>
        <p class="muted">远程创意仓库必须由你手动创建，且为公开仓库。校验通过后会自动克隆到 .ideahub/remote/；不会自动提交、推送或公开任何内容。</p>
        <div class="actions"><button data-action="setRemote">保存、校验并克隆</button></div>`;
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

function renderMain(state: WorkspaceState): string {
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
      return renderLocal(state);
  }
}

interface Badge {
  text: string;
  title?: string;
}

function renderBadges(project: ProjectSummary): string {
  const badges: Badge[] = [
    { text: `${project.proofCount}个证明`, title: '已生成的证明数量' }
  ];
  if (project.hasNewContent) {
    badges.push({ text: '有新内容', title: '存在尚未证明的新内容' });
  }
  if (project.publishedCount > 0) {
    badges.push({ text: `发布${project.publishedCount}次`, title: '已发布的次数' });
  }
  if (project.canPublish) {
    badges.push({ text: '可发布', title: '已证明的内容可以发布' });
  }
  return badges
    .map((badge) =>
      `<span class="badge"${
        badge.title ? ` title="${escapeHtml(badge.title)}"` : ''
      }>${escapeHtml(badge.text)}</span>`
    )
    .join('');
}

function refreshTooltip(
  state: Extract<WorkspaceState, { kind: 'local' }>
): string {
  const parts = [`工作区：${state.root}`];
  if (state.remote) {
    parts.push(
      `远程创意仓库：${state.remote.owner}/${state.remote.repo}（分支 ${state.remote.branch}）`
    );
  } else {
    parts.push('远程创意仓库：未配置');
  }
  if (state.remoteStatus && !state.remoteStatus.available && state.remoteStatus.error) {
    parts.push(`远程状态暂不可用：${state.remoteStatus.error}`);
  }
  return parts.join(' | ');
}

function renderLocal(
  state: Extract<WorkspaceState, { kind: 'local' }>
): string {
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

  const projects = hasIssues
    ? ''
    : state.projects.length === 0
      ? `<div class="card">
          <div class="title">还没有项目</div>
          <p>点击上方「新建项目」按钮，在仓库根目录创建 <code>&lt;项目名&gt;/ideas.md</code>。</p>
          <p class="muted">也可以手动新建文件夹并放入 ideas.md；只有包含 ideas.md 的根目录一级文件夹会被识别为项目。</p>
        </div>`
      : `<ul class="projects">${state.projects
          .map(
            (project) => `<li class="project">
              <div class="project-head">
                <div class="project-name" data-action="open" data-project="${escapeHtml(project.name)}">${escapeHtml(
                  project.name
                )}</div>
                ${renderBadges(project)}
              </div>
              <div class="project-actions">
                <button class="secondary" data-action="mark" data-project="${escapeHtml(
                  project.name
                )}" title="发布新增内容的时间证明">证明</button>
                <button class="secondary" data-action="publish" data-project="${escapeHtml(
                  project.name
                )}" title="发布创意原文">发布</button>
              </div>
            </li>`
          )
          .join('')}</ul>`;

  return `
    <div class="header">
      <h1>创意仓库</h1>
      <button class="secondary" data-action="refresh" title="${escapeHtml(
        refreshTooltip(state)
      )}">刷新状态</button>
    </div>
    ${hasIssues ? `<h2>需要完成的配置</h2>${issues}` : `<h2>项目</h2>
      <div class="actions"><button data-action="createProject">新建项目</button></div>
      ${projects}`}`;
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
<body>
<div id="status" class="status" role="status" aria-live="polite" hidden></div>
${renderMain(state)}
${renderScript(nonce)}
</body>
</html>`;
}
