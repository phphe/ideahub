import * as crypto from 'node:crypto';
import {
  translate,
  type ProjectSummary,
  type Translator,
  type WorkspaceState
} from '@ideahub/core';

export interface RemoteSettingsDisplay {
  url: string;
  ownerRepo: string;
  host: string;
  branch: string;
}

export interface RemoteSettingsInfo {
  url: string;
  owner: string | null;
  repo: string | null;
  host: string | null;
  branch: string | null;
  visibility: string;
  error: string | null;
  /** Pre-translated values rendered in the settings view and sent to the webview. */
  display: RemoteSettingsDisplay;
}

export interface WebviewAssets {
  cspSource: string;
  codiconCssUri: string;
}

export const DEFAULT_WEBVIEW_ASSETS: WebviewAssets = {
  cspSource: '',
  codiconCssUri: ''
};

function icon(name: string): string {
  return `<i class="codicon codicon-${name}" aria-hidden="true"></i>`;
}

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

    // Busy feedback must not change layout: only disable controls, and keep
    // icon buttons at their original size by swapping the glyph in place.
    // Each button remembers its idle icon class so a later reset can restore it.
    function lockButtons(trigger) {
      document.querySelectorAll('button').forEach(function (button) {
        button.disabled = true;
        button.dataset.busy = 'true';
        const glyph = button.querySelector('.codicon');
        if (glyph) {
          button.dataset.idleIcon = glyph.className;
          if (button === trigger && button.classList.contains('icon')) {
            glyph.className = 'codicon codicon-loading codicon-modifier-spin';
          }
        }
      });
    }

    // Cancelled operations reset the busy state in place, so the page keeps its
    // scroll position and input focus instead of being rebuilt.
    function resetBusy() {
      document.querySelectorAll('button[data-busy]').forEach(function (button) {
        button.disabled = false;
        delete button.dataset.busy;
        const glyph = button.querySelector('.codicon');
        if (glyph && button.dataset.idleIcon) {
          glyph.className = button.dataset.idleIcon;
        }
        delete button.dataset.idleIcon;
      });
    }

    // Section 8.7: project filter and status chips. Section 6.9 adds tag
    // filtering. Everything below is pure DOM work; it never posts a message,
    // rereads the disk or rewrites the page.
    const storedUi = (vscode.getState && vscode.getState()) || {};
    let filterQuery = typeof storedUi.filterQuery === 'string' ? storedUi.filterQuery : '';
    let activeChip = typeof storedUi.filterChip === 'string' ? storedUi.filterChip : 'all';
    let activeTag = typeof storedUi.filterTag === 'string' ? storedUi.filterTag : '';

    function rememberFilterState() {
      if (vscode.setState) {
        vscode.setState({
          filterQuery: filterQuery,
          filterChip: activeChip,
          filterTag: activeTag
        });
      }
    }

    // Case-insensitive substring match; whitespace splits terms and every term
    // must hit (AND).
    function matchesQuery(name, query) {
      const tokens = query.toLowerCase().split(/\\s+/).filter(function (token) {
        return token.length > 0;
      });
      if (tokens.length === 0) { return true; }
      const lower = name.toLowerCase();
      return tokens.every(function (token) { return lower.indexOf(token) !== -1; });
    }

    function matchesChip(item) {
      if (activeChip === 'new') { return item.dataset.hasNew === 'true'; }
      if (activeChip === 'publishable') { return item.dataset.canPublish === 'true'; }
      if (activeChip === 'unpublished') { return item.dataset.published !== 'true'; }
      return true;
    }

    // Tags are URL-encoded JSON so quotes never break the attribute; malformed
    // values simply mean the project has no tags.
    function projectTags(item) {
      try {
        const raw = item.dataset.tags || '';
        return raw ? JSON.parse(decodeURIComponent(raw)) : [];
      } catch (error) {
        return [];
      }
    }

    function matchesTag(item) {
      if (!activeTag) { return true; }
      const needle = activeTag.toLowerCase();
      return projectTags(item).some(function (tag) {
        return String(tag).toLowerCase() === needle;
      });
    }

    // Counts depend on the name search and the status chip only, never on the
    // tag that is currently selected.
    function updateTagCounts() {
      const row = document.getElementById('project-tags');
      if (!row) { return; }
      const input = document.getElementById('project-filter');
      const query = input ? filterQuery : '';
      const counts = {};
      const items = document.querySelectorAll('[data-project-item]');
      for (const item of items) {
        if (!matchesQuery(item.dataset.projectItem || '', query) || !matchesChip(item)) {
          continue;
        }
        for (const tag of projectTags(item)) {
          const key = String(tag).toLowerCase();
          counts[key] = (counts[key] || 0) + 1;
        }
      }
      let visible = 0;
      for (const chip of row.querySelectorAll('[data-tag]')) {
        const key = (chip.dataset.tag || '').toLowerCase();
        const count = counts[key] || 0;
        const countEl = chip.querySelector('[data-tag-count]');
        if (countEl) { countEl.textContent = String(count); }
        chip.hidden = count === 0;
        if (count > 0) { visible += 1; }
      }
      row.hidden = visible === 0;
    }

    function applyTagSelection() {
      const row = document.getElementById('project-tags');
      if (!row) {
        if (activeTag) {
          activeTag = '';
          rememberFilterState();
        }
        return;
      }
      let found = false;
      for (const chip of row.querySelectorAll('[data-tag]')) {
        const on =
          !!activeTag && (chip.dataset.tag || '').toLowerCase() === activeTag.toLowerCase();
        chip.classList.toggle('active', on);
        if (chip.setAttribute) { chip.setAttribute('aria-pressed', on ? 'true' : 'false'); }
        if (on) { found = true; }
      }
      if (activeTag && !found) {
        activeTag = '';
        rememberFilterState();
      }
    }

    function applyProjectFilters() {
      updateTagCounts();
      // The input only exists when there are more than 10 projects; without it
      // a stale query must not hide anything.
      const input = document.getElementById('project-filter');
      const query = input ? filterQuery : '';
      const items = document.querySelectorAll('[data-project-item]');
      let visible = 0;
      for (const item of items) {
        const show =
          matchesQuery(item.dataset.projectItem || '', query) &&
          matchesChip(item) &&
          matchesTag(item);
        item.hidden = !show;
        if (show) { visible += 1; }
      }
      const emptyHint = document.getElementById('project-filter-empty');
      if (emptyHint) { emptyHint.hidden = visible > 0 || items.length === 0; }
    }

    function applyChipSelection() {
      const chips = document.querySelectorAll('[data-chip]');
      for (const chip of chips) {
        const on = chip.dataset.chip === activeChip;
        chip.classList.toggle('active', on);
        if (chip.setAttribute) {
          chip.setAttribute('aria-pressed', on ? 'true' : 'false');
        }
      }
    }

    function setActiveChip(chip) {
      activeChip = chip;
      applyChipSelection();
      rememberFilterState();
      applyProjectFilters();
    }

    function setActiveTag(tag) {
      activeTag = activeTag && tag.toLowerCase() === activeTag.toLowerCase() ? '' : tag;
      applyTagSelection();
      rememberFilterState();
      applyProjectFilters();
    }

    document.addEventListener('input', function (event) {
      if (!event.target || event.target.id !== 'project-filter') { return; }
      filterQuery = event.target.value || '';
      rememberFilterState();
      applyProjectFilters();
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') { closeMenu(); }
      const input = document.getElementById('project-filter');
      if (!input) { return; }
      const target = event.target;
      const editable =
        !!target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable === true ||
          target.id === 'project-filter');
      if (event.key === '/' && !editable && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        input.focus();
        return;
      }
      if (event.key === 'Escape' && target === input) {
        input.value = '';
        filterQuery = '';
        rememberFilterState();
        applyProjectFilters();
        input.blur();
      }
    });

    let menuProject = null;

    function closeMenu() {
      const menu = document.getElementById('project-menu');
      if (menu) { menu.hidden = true; }
      menuProject = null;
    }

    // A fixed overlay replaces the native context menu, which the webview does
    // not provide. Near the viewport bottom it opens upward so it is never cut.
    function openMenu(project, x, y) {
      const menu = document.getElementById('project-menu');
      if (!menu) { return; }
      menuProject = project;
      menu.hidden = false;
      menu.style.left = x + 'px';
      menu.style.top = y + 'px';
      const rect = menu.getBoundingClientRect ? menu.getBoundingClientRect() : null;
      if (!rect) { return; }
      const viewportWidth = window.innerWidth || 0;
      const viewportHeight = window.innerHeight || 0;
      let left = x;
      let top = y;
      if (viewportWidth && left + rect.width > viewportWidth) {
        left = Math.max(4, viewportWidth - rect.width - 4);
      }
      if (viewportHeight && top + rect.height > viewportHeight) {
        top = Math.max(4, y - rect.height);
      }
      menu.style.left = left + 'px';
      menu.style.top = top + 'px';
    }

    document.addEventListener('contextmenu', function (event) {
      const anchor = event.target.closest ? event.target.closest('[data-project-menu]') : null;
      if (!anchor) { return; }
      event.preventDefault();
      openMenu(anchor.dataset.projectMenu || '', event.clientX, event.clientY);
    });

    // Section 6.9: the menu also closes on Escape and when the window loses focus.
    window.addEventListener('blur', function () { closeMenu(); });

    window.addEventListener('error', function (event) {
      vscode.postMessage({
        type: 'uiError',
        message: String((event && event.message) || '')
      });
    });

    function applySettingsInfo(info) {
      var display = info.display || {};
      const fields = [
        ['settings-url', display.url],
        ['settings-owner-repo', display.ownerRepo],
        ['settings-host', display.host],
        ['settings-branch', display.branch],
        ['settings-visibility', info.visibility]
      ];
      for (const entry of fields) {
        const el = document.getElementById(entry[0]);
        if (el && entry[1]) { el.textContent = entry[1]; }
      }
      const errorEl = document.getElementById('settings-error');
      if (errorEl) {
        errorEl.textContent = info.error || '';
        errorEl.hidden = !info.error;
      }
      const urlInput = document.getElementById('remote-url');
      if (urlInput && document.activeElement !== urlInput && info.url) {
        urlInput.value = info.url;
      }
    }

    // Patches the badge row of one project after its ideas.md changed on disk.
    // Every other DOM node, the scroll position and the focus stay untouched.
    // Status flags refresh too, so chips keep filtering correctly.
    function applyProjectBadges(project, badgesHtml, flags) {
      let item = null;
      const items = document.querySelectorAll('[data-project-item]');
      for (const entry of items) {
        if (entry.dataset.projectItem === project) { item = entry; break; }
      }
      if (!item) { return; }
      const container = item.querySelector('[data-project-badges]');
      if (container) {
        container.innerHTML = badgesHtml;
      }
      if (flags) {
        item.dataset.hasNew = flags.hasNewContent ? 'true' : 'false';
        item.dataset.canPublish = flags.canPublish ? 'true' : 'false';
        item.dataset.published = flags.publishedCount > 0 ? 'true' : 'false';
        if (flags.tags) {
          item.dataset.tags = encodeURIComponent(JSON.stringify(flags.tags));
        }
      }
      applyProjectFilters();
    }

    window.addEventListener('message', function (event) {
      const data = event.data;
      if (data && data.type === 'resetBusy') {
        resetBusy();
        return;
      }
      if (data && data.type === 'projectBadges' && data.project) {
        applyProjectBadges(data.project, data.html || '', data.flags);
        return;
      }
      if (data && data.type === 'settingsInfo' && data.info) {
        applySettingsInfo(data.info);
      }
    });

    document.addEventListener('click', function (event) {
      const menuItem = event.target.closest ? event.target.closest('[data-menu-action]') : null;
      if (menuItem && menuProject) {
        const project = menuProject;
        const action = menuItem.dataset.menuAction;
        closeMenu();
        const type = action === 'open' ? 'open' : action === 'editTags' ? 'editTags' : 'copyUrl';
        vscode.postMessage({ type: type, project: project });
        return;
      }
      // Any click outside the menu closes it before the regular handling.
      closeMenu();
      const tagChip = event.target.closest ? event.target.closest('[data-tag]') : null;
      if (tagChip && tagChip.dataset.tag) {
        setActiveTag(tagChip.dataset.tag);
        return;
      }
      const chip = event.target.closest ? event.target.closest('[data-chip]') : null;
      if (chip && chip.dataset.chip) {
        setActiveChip(chip.dataset.chip);
        return;
      }
      const target = event.target.closest('[data-action]');
      if (!target || !target.dataset.action) { return; }
      const action = target.dataset.action;
      if (action === 'setRemote') {
        const urlInput = document.getElementById('remote-url');
        lockButtons(target);
        vscode.postMessage({
          type: 'setRemote',
          url: urlInput ? urlInput.value : ''
        });
        return;
      }
      if (action === 'open') {
        vscode.postMessage({ type: 'open', project: target.dataset.project });
        return;
      }
      lockButtons(target);
      vscode.postMessage({ type: action, project: target.dataset.project });
    });

    // Restore the persisted filter/chip/tag selection after a full re-render.
    const initialFilter = document.getElementById('project-filter');
    if (initialFilter) {
      initialFilter.value = filterQuery;
    } else {
      filterQuery = '';
      rememberFilterState();
    }
    applyChipSelection();
    applyTagSelection();
    applyProjectFilters();
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
  .header-actions { margin-left: auto; display: flex; gap: 2px; }
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
  button.icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    padding: 0;
    background: transparent;
    color: var(--vscode-icon-foreground, var(--vscode-foreground));
  }
  button.icon:hover { background: var(--vscode-toolbar-hoverBackground); }
  input[type="text"] {
    width: 100%;
    padding: 5px 7px;
    border-radius: 3px;
    border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
    color: var(--vscode-input-foreground);
    background: var(--vscode-input-background);
    font-family: inherit;
  }
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
  .project-badges { display: contents; }
  .project-actions { display: flex; gap: 6px; flex-wrap: wrap; }
  .project-name { font-weight: 600; word-break: break-all; cursor: pointer; }
  .project-name:hover { text-decoration: underline; }
  li.project[hidden] { display: none !important; }
  .project-filters { display: flex; flex-direction: column; gap: 6px; margin: 4px 0 8px; }
  .project-chips { display: flex; flex-wrap: wrap; gap: 4px; }
  button.chip {
    font-size: 11px;
    padding: 2px 9px;
    border-radius: 10px;
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
  }
  button.chip:hover { background: var(--vscode-button-secondaryHoverBackground); }
  button.chip.active {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
  }
  button.chip.is-empty { opacity: 0.55; }
  button.chip.chip-warning {
    background: var(--vscode-inputValidation-warningBackground, rgba(191, 136, 3, 0.18));
    color: var(--vscode-foreground);
    border: 1px solid var(--vscode-inputValidation-warningBorder, rgba(191, 136, 3, 0.6));
  }
  button.chip.chip-warning.active {
    background: var(--vscode-inputValidation-warningBorder, #bf8803);
    color: var(--vscode-foreground);
  }
  .project-tags { display: flex; flex-wrap: wrap; gap: 4px; }
  .project-tags[hidden] { display: none !important; }
  button.tag-chip { max-width: 100%; overflow-wrap: anywhere; }
  .project-filter-empty { margin: 0; }
  .project-menu {
    position: fixed;
    z-index: 1000;
    display: flex;
    flex-direction: column;
    min-width: 110px;
    padding: 4px;
    border: 1px solid var(--vscode-menu-border, var(--vscode-panel-border));
    border-radius: 4px;
    background: var(--vscode-menu-background, var(--vscode-editorWidget-background));
    box-shadow: 0 2px 8px var(--vscode-widget-shadow, rgba(0, 0, 0, 0.3));
  }
  .project-menu[hidden] { display: none !important; }
  .project-menu button {
    text-align: left;
    padding: 4px 10px;
    border-radius: 3px;
    background: transparent;
    color: var(--vscode-menu-foreground, var(--vscode-foreground));
  }
  .project-menu button:hover {
    background: var(--vscode-menu-selectionBackground, var(--vscode-toolbar-hoverBackground));
    color: var(--vscode-menu-selectionForeground, var(--vscode-foreground));
  }
  .badge {
    font-size: 11px;
    border-radius: 10px;
    padding: 1px 7px;
    background: var(--vscode-badge-background);
    color: var(--vscode-badge-foreground);
  }
  /* Section 8.7: the "Unproven" badge uses the theme warning palette so it stays
     legible in both light and dark themes and stands out from the other badges. */
  .badge.badge-warning {
    background: var(--vscode-inputValidation-warningBackground, rgba(191, 136, 3, 0.18));
    color: var(--vscode-foreground);
    border: 1px solid var(--vscode-inputValidation-warningBorder, rgba(191, 136, 3, 0.6));
    font-weight: 600;
  }
  .row { display: flex; gap: 6px; flex-wrap: wrap; }
  code { font-family: var(--vscode-editor-font-family); font-size: 12px; }
  .link { color: var(--vscode-textLink-foreground); cursor: pointer; }
  .link:hover { text-decoration: underline; }
`;

function renderIssueActions(
  issueId: string,
  remoteDirExists: boolean,
  t: Translator
): string {
  switch (issueId) {
    case 'local-git':
      return `<div class="actions"><button data-action="initGit">${escapeHtml(
        t('Initialize Git repository')
      )}</button></div>`;
    case 'remote-url':
      return `<input type="text" id="remote-url" placeholder="https://github.com/owner/repo" />
        <p class="muted">${escapeHtml(
          t(
            'The remote idea repository must be created manually by you and must be public. The remote default branch is used automatically and shown in settings. After validation the repository is cloned into .ideahub/remote/; the configuration is only committed to the local repository and nothing is pushed or published.'
          )
        )}</p>
        <div class="actions"><button data-action="setRemote">${escapeHtml(
          t('Save, validate and clone')
        )}</button></div>`;
    case 'remote-dir':
      return `<div class="actions">
        <button data-action="clone">${escapeHtml(t('Clone remote repository'))}</button>
        ${remoteDirExists ? `<button class="secondary" data-action="reclone">${escapeHtml(
          t('Re-clone (delete the existing remote/)')
        )}</button>` : ''}
      </div>`;
    case 'remote-mismatch':
      return `<div class="actions"><button data-action="reclone">${escapeHtml(
        t('Re-clone (delete the existing remote/)')
      )}</button></div>`;
    case 'hook':
      return `<div class="actions"><button data-action="installHook">${escapeHtml(
        t('Install / fix hook')
      )}</button></div>`;
    default:
      return '';
  }
}

function renderMain(state: WorkspaceState, t: Translator): string {
  switch (state.kind) {
    case 'no-folder':
      return `
        <h1>${escapeHtml(t('IdeaHub'))}</h1>
        <div class="card"><p>${escapeHtml(t('You have not opened any folder yet.'))}</p>
        <p class="muted">${escapeHtml(
          t('Open a folder in VS Code first, then come back here.')
        )}</p></div>`;
    case 'empty-folder':
      return `
        <h1>${escapeHtml(t('IdeaHub'))}</h1>
        <div class="card">
          <p>${escapeHtml(
            t('The current folder is empty and can be initialized as a local idea repository.')
          )}</p>
          <p class="muted">${escapeHtml(
            t(
              'Initialization only creates a Git repository, the .ideahub configuration, the pre-push hook and README. It commits and pushes nothing.'
            )
          )}</p>
          <div class="actions">
            <button data-action="init">${escapeHtml(t('Initialize local repository'))}</button>
            <button class="secondary" data-action="refresh">${escapeHtml(t('Check again'))}</button>
          </div>
        </div>`;
    case 'not-ideahub':
      return `
        <h1>${escapeHtml(t('IdeaHub'))}</h1>
        <div class="card warn">
          <div class="title">${escapeHtml(t('No idea repository detected'))}</div>
          <p>${escapeHtml(
            t(
              'The current folder is not empty and has no .ideahub directory, so it is not initialized automatically to avoid overwriting existing content.'
            )
          )}</p>
          <p class="muted">${escapeHtml(
            t(
              'If you really want to start from scratch, use an empty folder. You can also click "Initialize anyway" to add the required structure to the current folder; existing files are never overwritten.'
            )
          )}</p>
          <div class="actions">
            <button class="secondary" data-action="initNonEmpty">${escapeHtml(
              t('Initialize anyway')
            )}</button>
            <button class="secondary" data-action="refresh">${escapeHtml(t('Check again'))}</button>
          </div>
        </div>`;
    case 'error':
      return `
        <h1>${escapeHtml(t('IdeaHub'))}</h1>
        <div class="card error"><div class="title">${escapeHtml(
          t('Detection failed')
        )}</div><p>${escapeHtml(state.message)}</p>
        <div class="actions"><button class="secondary" data-action="refresh">${escapeHtml(
          t('Check again')
        )}</button></div></div>`;
    case 'local':
      return renderLocal(state, t);
  }
}

interface Badge {
  text: string;
  title?: string;
  variant?: 'warning';
}

export function renderProjectBadges(
  project: ProjectSummary,
  t: Translator = translate
): string {
  const proofBadge =
    project.proofCount === 1
      ? t('1 proof')
      : t('{0} proofs', project.proofCount);
  const badges: Badge[] = [
    { text: proofBadge, title: t('Number of generated proofs') }
  ];
  if (project.hasNewContent) {
    badges.push({
      text: t('Unproven'),
      title: t('There is new content that has not been proven yet'),
      variant: 'warning'
    });
  }
  if (project.publishedCount > 0) {
    badges.push({
      text:
        project.publishedCount === 1
          ? t('Published 1 time')
          : t('Published {0} times', project.publishedCount),
      title: t('Number of publishes')
    });
  }
  if (project.canPublish) {
    badges.push({
      text: t('Publishable'),
      title: t('The proven content can be published')
    });
  }
  return badges
    .map((badge) =>
      `<span class="badge${badge.variant ? ` badge-${badge.variant}` : ''}"${
        badge.title ? ` title="${escapeHtml(badge.title)}"` : ''
      }>${escapeHtml(badge.text)}</span>`
    )
    .join('');
}

export const PROJECT_FILTER_THRESHOLD = 10;

/**
 * Section 8.7: most recently modified `ideas.md` first, then by name. Status
 * badges and tag filters never affect the order, so filtering keeps the same
 * relative order within the matched set. Computed once per render from memory.
 */
export function sortProjects(projects: ProjectSummary[]): ProjectSummary[] {
  return projects.slice().sort((a, b) => {
    const recency = (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
    if (recency !== 0) {
      return recency;
    }
    return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  });
}

function renderChip(
  id: string,
  label: string,
  count: number,
  active: boolean,
  variant?: 'warning'
): string {
  return `<button class="chip${active ? ' active' : ''}${
    count === 0 ? ' is-empty' : ''
  }${variant ? ` chip-${variant}` : ''}" data-chip="${id}" aria-pressed="${active}">${escapeHtml(label)} ${count}</button>`;
}

function collectTags(projects: ProjectSummary[]): string[] {
  const seen = new Map<string, string>();
  for (const project of projects) {
    for (const tag of project.tags) {
      const key = tag.toLowerCase();
      if (!seen.has(key)) {
        seen.set(key, tag);
      }
    }
  }
  return Array.from(seen.values()).sort((a, b) =>
    a.toLowerCase().localeCompare(b.toLowerCase())
  );
}

function countTag(projects: ProjectSummary[], tag: string): number {
  const key = tag.toLowerCase();
  return projects.filter((project) =>
    project.tags.some((entry) => entry.toLowerCase() === key)
  ).length;
}

// Section 6.9: the tag row sits on its own line after the status chips.
// Counts and visibility are refreshed in place by the webview script.
function renderTagRow(projects: ProjectSummary[]): string {
  const tags = collectTags(projects);
  if (tags.length === 0) {
    return '';
  }
  const chips = tags
    .map(
      (tag) =>
        `<button class="chip tag-chip" data-tag="${escapeHtml(
          tag
        )}" aria-pressed="false">${escapeHtml(tag)} <span data-tag-count>${countTag(
          projects,
          tag
        )}</span></button>`
    )
    .join('');
  return `<div class="project-tags" id="project-tags">${chips}</div>`;
}

function renderProjectFilters(
  projects: ProjectSummary[],
  withInput: boolean,
  t: Translator
): string {
  const total = projects.length;
  const fresh = projects.filter((project) => project.hasNewContent).length;
  const publishable = projects.filter((project) => project.canPublish).length;
  const unpublished = projects.filter((project) => project.publishedCount === 0).length;
  const searchLabel = escapeHtml(t('Search by name'));
  const input = withInput
    ? `<input id="project-filter" class="project-filter" type="text" placeholder="${searchLabel}" aria-label="${searchLabel}" />`
    : '';
  const hint = withInput
    ? `<p class="muted project-filter-empty" id="project-filter-empty" hidden>${escapeHtml(
        t('No matching projects')
      )}</p>`
    : '';
  return `<div class="project-filters">
      ${input}
      <div class="project-chips">
        ${renderChip('all', t('All'), total, true)}
        ${renderChip('new', t('Unproven'), fresh, false, 'warning')}
        ${renderChip('publishable', t('Publishable'), publishable, false)}
        ${renderChip('unpublished', t('Unpublished'), unpublished, false)}
      </div>
      ${renderTagRow(projects)}
      ${hint}
    </div>`;
}

function refreshTooltip(
  state: Extract<WorkspaceState, { kind: 'local' }>,
  t: Translator
): string {
  const parts = [t('Workspace: {0}', state.root)];
  if (state.remote) {
    parts.push(
      t(
        'Remote idea repository: {0}/{1} (branch {2})',
        state.remote.owner,
        state.remote.repo,
        state.remote.branch
      )
    );
  } else {
    parts.push(t('Remote idea repository: not configured'));
  }
  if (state.remoteStatus && !state.remoteStatus.available && state.remoteStatus.error) {
    parts.push(
      t('Remote status is temporarily unavailable: {0}', state.remoteStatus.error)
    );
  }
  return parts.join(' | ');
}

function renderLocal(
  state: Extract<WorkspaceState, { kind: 'local' }>,
  t: Translator
): string {
  const hasIssues = state.issues.length > 0;
  const issues = state.issues
    .map((issue) => {
      return `<div class="card warn">
        <div class="title">${escapeHtml(issue.title)}</div>
        <p>${escapeHtml(issue.message)}</p>
        ${renderIssueActions(issue.id, state.remoteDirExists, t)}
      </div>`;
    })
    .join('');

  const sortedProjects = sortProjects(state.projects);
  const filters =
    state.projects.length === 0
      ? ''
      : renderProjectFilters(
          sortedProjects,
          state.projects.length > PROJECT_FILTER_THRESHOLD,
          t
        );

  const projects = hasIssues
    ? ''
    : state.projects.length === 0
      ? `<div class="card">
          <div class="title">${escapeHtml(t('No projects yet'))}</div>
          <p>${t(
            'Click the + button in the title bar to create <code>&lt;project&gt;/ideas.md</code> in the repository root.'
          )}</p>
          <p class="muted">${escapeHtml(
            t(
              'You can also create a folder and add ideas.md manually; only top-level folders containing ideas.md are recognized as projects.'
            )
          )}</p>
        </div>`
      : `<ul class="projects">${sortedProjects
          .map(
            (project) => `<li class="project" data-project-item="${escapeHtml(
              project.name
            )}" data-has-new="${project.hasNewContent}" data-can-publish="${
              project.canPublish
            }" data-published="${project.publishedCount > 0}" data-tags="${escapeHtml(
              encodeURIComponent(JSON.stringify(project.tags))
            )}">
              <div class="project-head">
                <div class="project-name" data-action="open" data-project="${escapeHtml(
                  project.name
                )}" data-project-menu="${escapeHtml(project.name)}">${escapeHtml(
                  project.name
                )}</div>
                <span class="project-badges" data-project-badges>${renderProjectBadges(
                  project,
                  t
                )}</span>
              </div>
              <div class="project-actions">
                <button class="secondary" data-action="mark" data-project="${escapeHtml(
                  project.name
                )}" title="${escapeHtml(
                  t('Publish a time proof for the new content')
                )}">${escapeHtml(t('Prove'))}</button>
                <button class="secondary" data-action="publish" data-project="${escapeHtml(
                  project.name
                )}" title="${escapeHtml(
                  t('Publish the original idea text')
                )}">${escapeHtml(t('Publish'))}</button>
              </div>
            </li>`
          )
          .join('')}</ul>`;

  const createButton = hasIssues
    ? ''
    : `<button class="icon" data-action="createProject" title="${escapeHtml(
        t('New project')
      )}">${icon('add')}</button>`;

  // Section 6.9: the webview has no native context menu, so the project-name
  // right click uses this fixed overlay.
  const menu = hasIssues
    ? ''
    : `<div class="project-menu" id="project-menu" hidden>
        <button data-menu-action="open">${escapeHtml(t('Open'))}</button>
        <button data-menu-action="editTags">${escapeHtml(t('Edit tags'))}</button>
        <button data-menu-action="copyUrl">${escapeHtml(t('Copy project URL'))}</button>
      </div>`;

  return `
    <div class="header">
      <h1>${escapeHtml(t('Idea projects'))}</h1>
      <div class="header-actions">
        ${createButton}
        <button class="icon" data-action="refresh" title="${escapeHtml(
          refreshTooltip(state, t)
        )}">${icon('refresh')}</button>
        <button class="icon" data-action="openSettings" title="${escapeHtml(
          t('Settings')
        )}">${icon('settings-gear')}</button>
      </div>
    </div>
    ${hasIssues ? `<h2>${escapeHtml(t('Configuration required'))}</h2>${issues}` : `${filters}${projects}`}
    ${menu}`;
}

function renderDocument(
  title: string,
  body: string,
  assets: WebviewAssets = DEFAULT_WEBVIEW_ASSETS,
  lang = 'en'
): string {
  const nonce = crypto.randomBytes(16).toString('base64');
  const codiconLink = assets.codiconCssUri
    ? `<link rel="stylesheet" href="${escapeHtml(assets.codiconCssUri)}" />\n`
    : '';
  return `<!DOCTYPE html>
<html lang="${escapeHtml(lang)}">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${assets.cspSource} 'unsafe-inline'; font-src ${assets.cspSource}; script-src 'nonce-${nonce}';" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(title)}</title>
${codiconLink}<style>${STYLES}</style>
</head>
<body>
${body}
${renderScript(nonce)}
</body>
</html>`;
}

export function renderMainHtml(
  state: WorkspaceState,
  assets: WebviewAssets = DEFAULT_WEBVIEW_ASSETS,
  t: Translator = translate,
  lang = 'en'
): string {
  return renderDocument(t('IdeaHub'), renderMain(state, t), assets, lang);
}

function settingRow(label: string, value: string, id: string): string {
  return `<p><span class="muted">${escapeHtml(label)}: </span><span id="${id}">${escapeHtml(
    value
  )}</span></p>`;
}

export function renderSettingsHtml(
  info: RemoteSettingsInfo,
  assets: WebviewAssets = DEFAULT_WEBVIEW_ASSETS,
  t: Translator = translate,
  lang = 'en'
): string {
  const error = `<p class="muted" id="settings-error"${
    info.error ? '' : ' hidden'
  }>${escapeHtml(info.error ?? '')}</p>`;
  const body = `
    <div class="header">
      <h1>${escapeHtml(t('Settings'))}</h1>
      <div class="header-actions">
        <button class="icon" data-action="closeSettings" title="${escapeHtml(
          t('Back to IdeaHub')
        )}">${icon('arrow-left')}</button>
      </div>
    </div>
    <div class="card">
      <div class="title">${escapeHtml(t('Remote idea repository'))}</div>
      ${settingRow(t('URL'), info.display.url, 'settings-url')}
      ${settingRow('owner/repo', info.display.ownerRepo, 'settings-owner-repo')}
      ${settingRow('host', info.display.host, 'settings-host')}
      ${settingRow(t('Branch'), info.display.branch, 'settings-branch')}
      ${settingRow(t('Public'), info.visibility, 'settings-visibility')}
      ${error}
    </div>
    <div class="card">
      <div class="title">${escapeHtml(t('Change remote repository URL'))}</div>
      <input id="remote-url" type="text" value="${escapeHtml(
        info.url
      )}" placeholder="https://github.com/owner/repo" />
      <div class="actions">
        <button data-action="setRemote">${escapeHtml(t('Validate, save and clone'))}</button>
      </div>
      <p class="muted">${escapeHtml(
        t(
          'Changes go through the existing validate → save configuration → automatic clone/re-clone flow; the configuration is only committed to the local repository and nothing is pushed or published.'
        )
      )}</p>
    </div>
    <div class="actions">
      <button class="secondary" data-action="closeSettings">${escapeHtml(t('Back'))}</button>
    </div>`;
  return renderDocument(t('IdeaHub - Settings'), body, assets, lang);
}
