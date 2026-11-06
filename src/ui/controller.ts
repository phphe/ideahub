import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  detectWorkspace,
  summarizeProject,
  type ProjectSummary,
  type ProjectRemoteStatus,
  type RemoteStatus,
  type WorkspaceState
} from '../core/status';
import {
  hasGitDirectory,
  hasReadmeFile,
  initializeLocalRepository,
  ensureLocalGitRepository
} from '../core/init';
import { installPrePushHook } from '../core/hook';
import { configPath, remoteRepoPath, writeConfig } from '../core/config';
import { GitHubApiError, GitHubClient } from '../core/github';
import { RELEASE_BRANCH } from '../core/release-config';
import {
  buildReleaseTag,
  ensureReleaseTarget,
  lookupRemoteBranch,
  validateTagName
} from '../core/release-target';
import { ensureReleaseBranchExists } from '../core/release-branch';
import { validateRemoteRepository } from '../core/remote-setup';
import { parseRemoteUrl } from '../core/remote-url';
import { decideRemoteSetup, describeImmutabilityCheck, describeReleaseImmutability } from '../core/immutability';
import type { RemoteSettingsInfo } from './html';
import { cloneRemoteRepository, inspectRemoteTarget, removeLocalClone } from '../core/clone';
import {
  runRemoteSetupFlow,
  type RemoteSetupFlowResult,
  type RemoteSetupStep
} from '../core/remote-setup-flow';
import {
  appendMarkerLine,
  computeProofHash,
  formatMarkerLine,
  parseIdeas
} from '../core/ideas';
import { parseTagInput, parseTags, updateTags } from '../core/front-matter';
import { ProjectOperationGuard } from '../core/operation-guard';
import { ProjectParseCache } from '../core/project-cache';
import {
  commitMarkerLine,
  commitSingleFile,
  CONFIG_REMOTE_COMMIT_MESSAGE,
  DEFAULT_PROOF_COMMIT_MESSAGE,
  DEFAULT_PUBLISH_COMMIT_MESSAGE,
  resolveCommitMessage,
  type MarkerCommitResult
} from '../core/marker-commit';
import { formatMarkerTime } from '../core/proof-time';
import { createProject as createProjectOnDisk, validateProjectName } from '../core/projects';
import {
  checkInnerRepositoryHead,
  commitAndPushInnerRepository,
  copyProjectIntoInnerRepository,
  readInnerRepositoryHead,
  remoteProjectUrl,
  restoreInnerRepository,
  scanProjectDirectory,
  syncInnerRepository
} from '../core/publish';
import { getGitHubToken } from './auth';

export interface OpResult {
  ok: boolean;
  message: string;
  /** Duplicate requests are ignored without notice or refresh. */
  silent?: boolean;
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.lstat(target);
    return true;
  } catch {
    return false;
  }
}

const REMOTE_SETUP_STEP_MESSAGES: Record<RemoteSetupStep, string> = {
  validate: '步骤 1/2：正在校验远程创意仓库…',
  persist: '步骤 1/2：校验通过，正在保存配置与 hook…',
  clone: '步骤 2/2：正在克隆远程创意仓库…'
};

function formatRemoteSetupResult(result: RemoteSetupFlowResult): OpResult {
  if (result.ok) {
    const target = `${result.remote.owner}/${result.remote.repo}（分支 ${result.branch}）`;
    const cloneStep =
      result.clone === 'cloned'
        ? `步骤 2/2：远程创意仓库已克隆（分支 ${result.branch}）。`
        : '步骤 2/2：检测到 .ideahub/remote/ 已是有效 Git 仓库，已跳过克隆；若与新地址不一致，请使用“重新克隆”。';
    return {
      ok: true,
      message: `步骤 1/2：远程地址校验通过，配置与 hook 已保存。\n${cloneStep}\n远程创意仓库：${target}\n${result.immutabilityMessage}`
    };
  }

  const stageLabels = {
    validation: '步骤 1/2（校验）',
    config: '步骤 1/2（保存配置）',
    clone: '步骤 2/2（克隆）'
  } as const;
  const retry = result.retryClone
    ? '\n克隆入口已保留，可点击“克隆远程仓库”重试；如需清空并重来，请使用“重新克隆”。'
    : '';
  return {
    ok: false,
    message: `${stageLabels[result.stage]}失败：${result.message}${retry}`
  };
}

export class IdeahubController {
  public currentState: WorkspaceState = { kind: 'no-folder' };
  private readonly operationGuard = new ProjectOperationGuard();
  /** Last fully resolved settings snapshot, reused for instant rendering. */
  private remoteSettingsCache: RemoteSettingsInfo | null = null;
  /** Section 8.7: parsed `ideas.md` summaries, scoped to the current repo root. */
  private projectCache: ProjectParseCache | null = null;
  private projectCacheRoot: string | null = null;

  constructor(private readonly output: vscode.OutputChannel) {}

  private log(message: string): void {
    this.output.appendLine(`[${new Date().toISOString()}] ${message}`);
  }

  public workspaceRoot(): string | null {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null;
  }

  /**
   * Parsing cache is bound to the current repository root, so switching
   * workspaces never reuses summaries keyed to another root.
   */
  private cacheFor(root: string): ProjectParseCache {
    if (!this.projectCache || this.projectCacheRoot !== root) {
      this.projectCache = new ProjectParseCache(summarizeProject);
      this.projectCacheRoot = root;
    }
    return this.projectCache;
  }

  /** Section 8.7: watcher change/delete drops the cached summary. */
  public invalidateProject(project: string): void {
    const root = this.workspaceRoot();
    if (root) {
      this.cacheFor(root).invalidate(root, project);
    }
  }

  public async refresh(): Promise<WorkspaceState> {
    const root = this.workspaceRoot();
    const cache = root ? this.cacheFor(root) : undefined;
    const state = await detectWorkspace(root, cache);
    if (state.kind === 'local' && state.remote) {
      state.remoteStatus = await this.loadRemoteStatus(state);
    }
    this.currentState = state;
    return state;
  }

  /**
   * Recomputes the badges of a single project after its ideas.md changed on
   * disk, without rescanning the whole workspace. Returns null when the project
   * is not part of the current state (the list structure must be refreshed).
   */
  public async summarizeProjectByName(name: string): Promise<ProjectSummary | null> {
    const state = this.currentState;
    if (state.kind !== 'local') {
      return null;
    }
    const index = state.projects.findIndex((project) => project.name === name);
    if (index < 0) {
      return null;
    }
    try {
      const summary = await this.cacheFor(state.root).summarize(state.root, name);
      state.projects[index] = summary;
      return summary;
    } catch {
      return null;
    }
  }

  private async loadRemoteStatus(
    state: Extract<WorkspaceState, { kind: 'local' }>
  ): Promise<RemoteStatus> {
    if (!state.remote) {
      return { available: false, projects: {} };
    }
    const remote = state.remote;
    const token = await getGitHubToken(false);
    const client = new GitHubClient(async () => token);

    try {
      const releases = await client.listReleases(remote.owner, remote.repo);
      const byTag = new Map(
        releases.filter((release) => release.tagName).map((release) => [release.tagName, release])
      );
      const projects: Record<string, ProjectRemoteStatus> = {};

      await Promise.all(
        state.projects.map(async (project) => {
          let latestProofAt: string | null = null;
          for (const tagName of project.proofTags) {
            const release = byTag.get(tagName);
            if (release?.publishedAt && (!latestProofAt || release.publishedAt > latestProofAt)) {
              latestProofAt = release.publishedAt;
            }
          }
          let published = false;
          try {
            published = await client.hasContent(remote.owner, remote.repo, project.name);
          } catch {
            published = false;
          }
          projects[project.name] = { published, latestProofAt };
        })
      );

      return { available: true, projects };
    } catch (error) {
      return {
        available: false,
        error: error instanceof Error ? error.message : String(error),
        projects: {}
      };
    }
  }

  private requireLocalRoot(): string | null {
    return this.currentState.kind === 'local' ? this.currentState.root : null;
  }

  public async initialize(allowNonEmpty = false): Promise<OpResult> {
    const state = this.currentState;
    if (allowNonEmpty) {
      if (state.kind !== 'not-ideahub') {
        return { ok: false, message: '当前状态不允许初始化。' };
      }
      const hasGit = await hasGitDirectory(state.root);
      const hasReadme = await hasReadmeFile(state.root);
      const readmeLine = hasReadme
        ? 'README.md 已存在，将保留现有 README.md。'
        : '将创建 README.md。';
      const common = `.ideahub/ 已有内容会被复用；${readmeLine} 不会覆盖任何已有文件，也不会自动推送或公开；仅本次新建的 .ideahub/config.json 会自动提交到本地仓库。\n仍要在此文件夹初始化创意仓库吗？`;
      const confirmation = hasGit
        ? `检测到现有 .git/，初始化将沿用该仓库，不会重新初始化或覆盖它。\n${common}`
        : `将在此文件夹创建 .git/，并创建 .ideahub/。\n${common}`;
      const choice = await vscode.window.showWarningMessage(
        confirmation,
        { modal: true },
        '仍要初始化'
      );
      if (choice !== '仍要初始化') {
        return { ok: false, message: '', silent: true };
      }
    } else if (state.kind !== 'empty-folder') {
      return { ok: false, message: '当前状态不允许初始化。' };
    }
    const result = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: '正在初始化本地创意仓库…' },
      () => initializeLocalRepository(state.root, { allowNonEmpty })
    );
    if (result.ok) {
      return {
        ok: true,
        message: ['本地创意仓库已初始化。', ...result.notes].join('\n')
      };
    }
    const steps = result.completedSteps.length
      ? `\n已完成的步骤：${result.completedSteps.join('、')}`
      : '';
    return { ok: false, message: `${result.error}${steps}` };
  }

  public async initGit(): Promise<OpResult> {
    const root = this.requireLocalRoot();
    if (!root) {
      return { ok: false, message: '当前状态不允许执行该操作。' };
    }
    const result = await ensureLocalGitRepository(root);
    if (!result.ok) {
      return { ok: false, message: result.error };
    }
    return { ok: true, message: '已初始化本地 Git 仓库。' };
  }

  public async installHook(): Promise<OpResult> {
    const root = this.requireLocalRoot();
    if (!root) {
      return { ok: false, message: '当前状态不允许执行该操作。' };
    }
    const state = this.currentState;
    const remote = state.kind === 'local' ? state.remote : null;
    const result = await installPrePushHook(root, remote);
    if (!result.ok) {
      return { ok: false, message: result.error };
    }
    return { ok: true, message: 'pre-push hook 已安装 / 更新。' };
  }

  public async setRemote(
    url: string,
    immutabilityConfirmed: boolean,
    branch: string = ''
  ): Promise<OpResult> {
    const root = this.requireLocalRoot();
    if (!root) {
      return { ok: false, message: '当前状态不允许执行该操作。' };
    }

    const parsed = parseRemoteUrl(url);
    if (!parsed.ok) {
      return { ok: false, message: parsed.error };
    }

    const token = await getGitHubToken(true);
    if (!token) {
      return { ok: false, message: '需要登录 GitHub 才能校验远程创意仓库。' };
    }

    const client = new GitHubClient(async () => token);
    const settingsUrl = `https://${parsed.value.host}/${parsed.value.owner}/${parsed.value.repo}/settings`;
    const state = this.currentState;
    const previous = state.kind === 'local' ? state.remote : null;
    let configCommitNote = '';

    const result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: '配置远程创意仓库（1/2 校验 → 2/2 克隆）',
        cancellable: false
      },
      (progress) =>
        runRemoteSetupFlow({
          validate: () => validateRemoteRepository(url, client, branch),
          decideImmutability: (check) =>
            decideRemoteSetup(check, immutabilityConfirmed, settingsUrl),
          confirmChange: async (next) => {
            const sameRepo =
              previous !== null &&
              previous.owner.toLowerCase() === next.owner.toLowerCase() &&
              previous.repo.toLowerCase() === next.repo.toLowerCase();
            if (!previous || sameRepo) {
              return true;
            }
            const choice = await vscode.window.showWarningMessage(
              '更换远程创意仓库地址会影响已有证明的可验证性；已有证明仍然保留在原远程仓库中。确认更换吗？',
              { modal: true },
              '确认更换'
            );
            return choice === '确认更换';
          },
          persist: async (remote) => {
            await writeConfig(root, { version: 1, remote });
            const hookResult = await installPrePushHook(root, {
              owner: remote.owner,
              repo: remote.repo
            });
            if (!hookResult.ok) {
              return { ok: false, error: hookResult.error };
            }
            const commit = await commitSingleFile({
              root,
              filePath: configPath(root),
              message: CONFIG_REMOTE_COMMIT_MESSAGE
            });
            if (commit.status === 'committed') {
              configCommitNote = '已自动提交 .ideahub/config.json 到本地仓库（未推送）。';
            } else if (commit.status === 'failed') {
              configCommitNote = `.ideahub/config.json 已保存，但自动提交失败：${commit.reason}`;
            }
            return { ok: true };
          },
          inspect: () => inspectRemoteTarget(root),
          clone: (remote) => cloneRemoteRepository(root, remote),
          onStep: (step) => progress.report({ message: REMOTE_SETUP_STEP_MESSAGES[step] })
        })
    );

    const formatted = formatRemoteSetupResult(result);
    if (formatted.ok && configCommitNote) {
      return { ok: true, message: `${formatted.message}\n${configCommitNote}` };
    }
    return formatted;
  }

  public async cloneRemote(reclone: boolean): Promise<OpResult> {
    const root = this.requireLocalRoot();
    const state = this.currentState;
    if (!root || state.kind !== 'local' || !state.remote) {
      return { ok: false, message: '请先填写并保存远程仓库地址。' };
    }

    if (reclone) {
      const choice = await vscode.window.showWarningMessage(
        '将删除 .ideahub/remote/ 并从远程创意仓库重新克隆。该目录内未提交的变更会丢失，确认继续吗？',
        { modal: true },
        '删除并重新克隆'
      );
      if (choice !== '删除并重新克隆') {
        return { ok: false, message: '已取消重新克隆。' };
      }
      const removed = await removeLocalClone(root);
      if (!removed.ok) {
        return { ok: false, message: removed.error };
      }
    } else if (state.remoteDirExists) {
      return {
        ok: false,
        message: '.ideahub/remote/ 已存在；如需重新克隆，请使用“重新克隆”操作。'
      };
    }

    const result = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: '正在克隆远程创意仓库…' },
      () => cloneRemoteRepository(root, state.remote!)
    );
    if (!result.ok) {
      this.log(
        `clone: failed: ${result.error}${result.detail ? `\n${result.detail}` : ''}`
      );
      return { ok: false, message: result.error };
    }
    return { ok: true, message: `远程创意仓库已克隆（分支 ${result.branch}）。` };
  }

  private rememberSettings(info: RemoteSettingsInfo): RemoteSettingsInfo {
    this.remoteSettingsCache = info;
    return info;
  }

  /**
   * Synchronous snapshot for instant rendering when the settings view opens.
   * Uses the last resolved result when it still matches the current remote;
   * otherwise only state-derived fields are filled and the API-derived fields
   * are left as placeholders to be patched asynchronously.
   */
  public currentRemoteSettingsInfo(): RemoteSettingsInfo {
    const state = this.currentState;
    if (state.kind !== 'local') {
      return this.rememberSettings({
        url: '',
        owner: null,
        repo: null,
        host: null,
        branch: null,
        visibility: '未知',
        immutability: '未知',
        error: '当前没有打开的本地创意仓库。'
      });
    }
    if (!state.remote) {
      return this.rememberSettings({
        url: '',
        owner: null,
        repo: null,
        host: null,
        branch: null,
        visibility: '未知',
        immutability: '未知',
        error: '尚未配置远程创意仓库。'
      });
    }

    const remote = state.remote;
    const cached = this.remoteSettingsCache;
    if (cached && cached.url === remote.url) {
      return cached;
    }
    const parsed = parseRemoteUrl(remote.url);
    return {
      url: remote.url,
      owner: remote.owner,
      repo: remote.repo,
      host: parsed.ok ? parsed.value.host : null,
      branch: remote.branch,
      visibility: '读取中…',
      immutability: '读取中…',
      error: null
    };
  }

  public async getRemoteSettingsInfo(): Promise<RemoteSettingsInfo> {
    const state = this.currentState;
    if (state.kind !== 'local') {
      return this.rememberSettings({
        url: '',
        owner: null,
        repo: null,
        host: null,
        branch: null,
        visibility: '未知',
        immutability: '未知',
        error: '当前没有打开的本地创意仓库。'
      });
    }
    if (!state.remote) {
      return this.rememberSettings({
        url: '',
        owner: null,
        repo: null,
        host: null,
        branch: null,
        visibility: '未知',
        immutability: '未知',
        error: '尚未配置远程创意仓库。'
      });
    }

    const remote = state.remote;
    const parsed = parseRemoteUrl(remote.url);
    const base: RemoteSettingsInfo = {
      url: remote.url,
      owner: remote.owner,
      repo: remote.repo,
      host: parsed.ok ? parsed.value.host : null,
      branch: remote.branch,
      visibility: '未知',
      immutability: '未知',
      error: null
    };

    const token = await getGitHubToken(false);
    if (!token) {
      return this.rememberSettings({
        ...base,
        immutability: '未知（未登录 GitHub，无法通过 API 检查）'
      });
    }

    const client = new GitHubClient(async () => token);
    try {
      const repository = await client.getRepository(remote.owner, remote.repo);
      if (!repository) {
        return this.rememberSettings({
          ...base,
          error: '无法读取远程仓库信息（仓库不存在或没有访问权限）。'
        });
      }
      const immutability = await client.getImmutableReleasesStatus(
        remote.owner,
        remote.repo,
        parsed.ok ? parsed.value.host : undefined
      );
      return this.rememberSettings({
        ...base,
        branch: repository.defaultBranch || remote.branch,
        visibility: repository.isPrivate ? '私有（不符合要求，必须为公开仓库）' : '公开',
        immutability: describeImmutabilityCheck(immutability)
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return this.rememberSettings({ ...base, error: `无法读取远程仓库信息：${reason}` });
    }
  }

  public async createProject(): Promise<OpResult> {
    const root = this.requireLocalRoot();
    if (!root) {
      return { ok: false, message: '当前状态不允许执行该操作。' };
    }

    const state = this.currentState;
    const existingProjects = state.kind === 'local' ? state.projects.map((project) => project.name) : [];
    const remoteProjects =
      state.kind === 'local' && state.remoteStatus?.available
        ? Object.keys(state.remoteStatus.projects)
        : [];

    const name = await vscode.window.showInputBox({
      title: '新建项目',
      prompt: '输入项目名称，将创建 <项目名>/ideas.md',
      placeHolder: '例如 MyGame',
      validateInput: (value) => validateProjectName(value, existingProjects, remoteProjects) ?? ''
    });
    if (name === undefined) {
      return { ok: false, message: '已取消新建项目。' };
    }

    const result = await createProjectOnDisk(root, name, remoteProjects);
    if (!result.ok) {
      return { ok: false, message: result.error };
    }

    let openNote: string;
    try {
      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(result.ideasPath));
      await vscode.window.showTextDocument(document);
      openNote = '\n已打开 ideas.md。';
    } catch (error) {
      openNote = `\n项目已创建，但自动打开 ideas.md 失败：${
        error instanceof Error ? error.message : String(error)
      }`;
    }

    return {
      ok: true,
      message: `已创建项目“${name}”（${name}/ideas.md）。\n使用最小模板（文档未定义 ideas.md 模板）：${result.content.trim()}${openNote}`
    };
  }

  public async openProject(project: string): Promise<OpResult> {
    const root = this.requireLocalRoot();
    if (!root) {
      return { ok: false, message: '当前状态不允许执行该操作。' };
    }
    const uri = vscode.Uri.file(path.join(root, project, 'ideas.md'));
    try {
      const document = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(document);
      return { ok: true, message: `已打开 ${project}/ideas.md。` };
    } catch (error) {
      return {
        ok: false,
        message: `无法打开项目 ideas.md：${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  /**
   * Section 6.9: edits the `tags` section only. Front matter is metadata, so
   * this never touches markers, never commits and never pushes.
   */
  public async editProjectTags(project: string): Promise<OpResult> {
    const root = this.requireLocalRoot();
    if (!root) {
      return { ok: false, message: '当前状态不允许执行该操作。' };
    }
    const uri = vscode.Uri.file(path.join(root, project, 'ideas.md'));
    let document;
    try {
      document = await vscode.workspace.openTextDocument(uri);
    } catch (error) {
      return {
        ok: false,
        message: `无法读取项目 ideas.md：${error instanceof Error ? error.message : String(error)}`
      };
    }

    const text = document.getText();
    const current = parseTags(text);
    const input = await vscode.window.showInputBox({
      title: '编辑标签',
      prompt: '用逗号分隔多个标签（支持中文逗号和顿号）；留空表示清除全部标签。',
      value: current.join(', '),
      placeHolder: '例如 游戏, 写作'
    });
    if (input === undefined) {
      return { ok: false, message: '', silent: true };
    }

    const next = parseTagInput(input);
    const updated = updateTags(text, next);
    if (updated === text) {
      return { ok: true, message: '标签未变化。' };
    }

    const edit = new vscode.WorkspaceEdit();
    edit.replace(
      uri,
      new vscode.Range(new vscode.Position(0, 0), document.positionAt(text.length)),
      updated
    );
    const applied = await vscode.workspace.applyEdit(edit);
    if (!applied) {
      return { ok: false, message: '写入标签失败，请检查文件是否可编辑。' };
    }
    const saved = await document.save();
    if (!saved) {
      return { ok: false, message: '标签已写入编辑器，但文件保存失败。' };
    }

    this.invalidateProject(project);
    return {
      ok: true,
      message: next.length > 0 ? `已更新标签：${next.join(', ')}` : '已清除全部标签。'
    };
  }

  private logReleaseFailure(
    error: unknown,
    context: {
      owner: string;
      repo: string;
      tag: string;
      targetCommitish: string;
      branch: string;
    }
  ): void {
    const fallbackUrl = `https://api.github.com/repos/${context.owner}/${context.repo}/releases`;
    if (!(error instanceof GitHubApiError)) {
      this.log(
        [
          'mark: createRelease failed (no local marker was written)',
          `POST ${fallbackUrl}`,
          `tag_name=${context.tag}`,
          `target_commitish=${context.targetCommitish}`,
          `target_branch=${context.branch}`,
          `error=${error instanceof Error ? error.message : String(error)}`
        ].join('\n')
      );
      return;
    }
    const errors = error.payload?.errors;
    this.log(
      [
        'mark: createRelease failed (no local marker was written)',
        `POST ${error.url ?? fallbackUrl}`,
        `tag_name=${context.tag}`,
        `target_commitish=${context.targetCommitish}`,
        `target_branch=${context.branch}`,
        `status=${error.status}`,
        `response.message=${error.payload?.message ?? '(none)'}`,
        `errors=${errors ? JSON.stringify(errors) : '(none)'}`,
        `response.body=${error.rawBody ?? '(empty)'}`
      ].join('\n')
    );
  }

  public async markProject(project: string): Promise<OpResult> {
    const outcome = await this.operationGuard.run(project, () =>
      this.markProjectUnlocked(project)
    );
    if (outcome.ignored) {
      this.log(`mark: ignored duplicate request for ${project}`);
      return { ok: true, message: '操作进行中，已忽略重复请求。', silent: true };
    }
    return outcome.value!;
  }

  private async markProjectUnlocked(project: string): Promise<OpResult> {
    const state = this.currentState;
    if (state.kind !== 'local' || !state.remote) {
      return { ok: false, message: '请先完成本地仓库与远程仓库配置。' };
    }
    if (state.issues.length > 0) {
      return { ok: false, message: '请先完成界面列出的配置，再生成证明。' };
    }
    const remote = state.remote;

    const uri = vscode.Uri.file(path.join(state.root, project, 'ideas.md'));
    let document;
    try {
      document = await vscode.workspace.openTextDocument(uri);
    } catch (error) {
      return {
        ok: false,
        message: `无法读取项目 ideas.md：${error instanceof Error ? error.message : String(error)}`
      };
    }

    const text = document.getText();
    const parsed = parseIdeas(text);
    if (!parsed.hasUnsealedContent) {
      return { ok: true, message: '没有需要生成证明的新内容。' };
    }

    this.log(`mark: release branch config: release_branch=${RELEASE_BRANCH} source=build`);

    // Section 7.3 / 7.4: the tag is the SHA-256 of the project name and the
    // content sealed by this proof marker.
    const contentHash = computeProofHash(project, parsed.tailAfterLastMarker);
    const proofTime = new Date();
    const proofTimeText = formatMarkerTime(proofTime);
    const markerLine = formatMarkerLine('proof', proofTimeText);
    const tag = buildReleaseTag(contentHash).tag;
    const tagError = validateTagName(tag);
    if (tagError) {
      this.log(
        [
          'mark: release preflight failed (no request sent)',
          `tag_name=${tag}`,
          `target_commitish=${RELEASE_BRANCH}`
        ].join('\n')
      );
      return {
        ok: false,
        message: `无法创建 Release（tag_name=${tag}，target_commitish=${RELEASE_BRANCH}）：${tagError}`
      };
    }

    const token = await getGitHubToken(true);
    if (!token) {
      return { ok: false, message: '需要登录 GitHub 才能创建证明 Release。' };
    }

    const client = new GitHubClient(async () => token);
    const innerPath = remoteRepoPath(state.root);
    const targetResult = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: '正在检查远程 release 分支…' },
      () =>
        ensureReleaseTarget(
          {
            getRepository: (owner, repo) => client.getRepository(owner, repo),
            lookupBranch: (branch) => lookupRemoteBranch(state.root, remote.url, branch),
            createBranch: async (branch) => {
              const created = await ensureReleaseBranchExists(
                innerPath,
                remote.url,
                branch,
                token
              );
              if (!created.ok) {
                return created;
              }
              this.log(
                [
                  'mark: release branch created automatically',
                  `release_branch=${branch}`,
                  `commit=${created.commit}`,
                  'pushed_file=empty'
                ].join('\n')
              );
              return { ok: true };
            }
          },
          remote.owner,
          remote.repo,
          RELEASE_BRANCH
        )
    );
    if (!targetResult.ok) {
      this.log(
        [
          'mark: release preflight failed (no request sent)',
          `POST https://api.github.com/repos/${remote.owner}/${remote.repo}/releases`,
          `tag_name=${tag}`,
          `target_commitish=${RELEASE_BRANCH}`,
          `error=${targetResult.error}`
        ].join('\n')
      );
      return {
        ok: false,
        message: `无法创建 Release（tag_name=${tag}，target_commitish=${RELEASE_BRANCH}）：${targetResult.error}`
      };
    }
    const target = targetResult.target;
    const defaultBranch = target.defaultBranch ?? '(unknown)';
    this.log(
      [
        'mark: release target resolved',
        `release_branch=${target.branch}`,
        `default_branch=${defaultBranch}`,
        `target_commitish=${target.sha}`
      ].join('\n')
    );
    if (target.defaultBranch !== null && target.defaultBranch !== target.branch) {
      this.log(
        `mark: release branch differs from remote default branch: release_branch=${target.branch} default_branch=${target.defaultBranch}`
      );
    }
    this.log(
      [
        'mark: createRelease request',
        `POST https://api.github.com/repos/${remote.owner}/${remote.repo}/releases`,
        `tag_name=${tag}`,
        `target_commitish=${target.sha}`,
        `release_branch=${target.branch}`,
        `default_branch=${defaultBranch}`
      ].join('\n')
    );

    let release;
    try {
      release = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: '正在创建证明 Release…' },
        async () => {
          // Section 7.4: idempotency is decided by querying the tag first.
          const existing = await client.getReleaseByTag(remote.owner, remote.repo, tag);
          if (existing) {
            return { created: false, release: existing };
          }
          return client.createRelease(remote.owner, remote.repo, tag, proofTimeText, target.sha);
        }
      );
    } catch (error) {
      this.logReleaseFailure(error, {
        owner: remote.owner,
        repo: remote.repo,
        tag,
        targetCommitish: target.sha,
        branch: target.branch
      });
      return {
        ok: false,
        message: `创建 Release 失败（tag_name=${tag}，target_commitish=${target.sha}（分支 ${target.branch}）），未写入任何标记：${
          error instanceof Error ? error.message : String(error)
        }`
      };
    }

    const updated = appendMarkerLine(text, markerLine);
    const edit = new vscode.WorkspaceEdit();
    edit.replace(uri, new vscode.Range(new vscode.Position(0, 0), document.positionAt(text.length)), updated);
    const applied = await vscode.workspace.applyEdit(edit);
    if (!applied) {
      return { ok: false, message: 'Release 已创建，但写入 ideas.md 标记失败，请手动添加标记。' };
    }
    const saved = await document.save();
    if (!saved) {
      return { ok: false, message: '标记已写入编辑器，但文件保存失败。' };
    }

    const commitNote = await this.autoCommitMarker(
      state.root,
      project,
      markerLine,
      proofTimeText,
      'proof'
    );

    const time = release.release?.publishedAt ? `，发布时间 ${release.release.publishedAt}` : '';
    const immutability = describeReleaseImmutability(release.release?.immutable);
    return {
      ok: true,
      message: `${release.created ? '证明已生成' : '证明已存在，已补写本地标记'}：\n${tag}${time}\n${immutability}${commitNote}`
    };
  }

  /**
   * Sections 8.9 / 8.10: optional local-only commit of the marker line.
   * Result is appended to the UI message; failures never affect the marker.
   */
  private async autoCommitMarker(
    root: string,
    project: string,
    markerLine: string,
    timeText: string,
    kind: 'proof' | 'publish'
  ): Promise<string> {
    const proofConfig = vscode.workspace.getConfiguration('ideahub.proof');
    const enabled = proofConfig.get<boolean>('autoCommit', true);
    const template =
      kind === 'proof'
        ? proofConfig.get<string>('commitMessage', DEFAULT_PROOF_COMMIT_MESSAGE)
        : vscode.workspace
            .getConfiguration('ideahub.publish')
            .get<string>('commitMessage', DEFAULT_PUBLISH_COMMIT_MESSAGE);
    const message = resolveCommitMessage(
      template,
      { project, time: timeText },
      kind === 'proof' ? DEFAULT_PROOF_COMMIT_MESSAGE : DEFAULT_PUBLISH_COMMIT_MESSAGE
    );

    const result = await commitMarkerLine({
      root,
      project,
      markerLine,
      message,
      enabled
    });

    const label = kind === 'proof' ? '标记' : '发布标记';
    return this.describeCommitResult(result, label, message);
  }

  private describeCommitResult(
    result: MarkerCommitResult,
    label: string,
    message: string
  ): string {
    if (result.status === 'committed') {
      this.log(
        `mark: auto commit succeeded: ${result.commit ?? '(unknown)'} message=${message}`
      );
      const short = result.commit ? result.commit.slice(0, 7) : '(unknown)';
      return `\n已自动提交${label}行（仅本地，未推送）：${short}`;
    }
    if (result.status === 'skipped') {
      this.log(`mark: auto commit skipped: ${result.reason}`);
      return result.silent ? '' : `\n自动提交已跳过：${result.reason}`;
    }
    this.log(`mark: auto commit failed: ${result.reason}`);
    return `\n${label}已写入，但自动提交失败：${result.reason}`;
  }

  public async publishProject(project: string): Promise<OpResult> {
    const outcome = await this.operationGuard.run(project, () =>
      this.publishProjectUnlocked(project)
    );
    if (outcome.ignored) {
      this.log(`publish: ignored duplicate request for ${project}`);
      return { ok: true, message: '操作进行中，已忽略重复请求。', silent: true };
    }
    return outcome.value!;
  }

  private async publishProjectUnlocked(project: string): Promise<OpResult> {
    const state = this.currentState;
    if (state.kind !== 'local' || !state.remote) {
      return { ok: false, message: '请先完成本地仓库与远程仓库配置。' };
    }
    if (state.issues.length > 0) {
      return { ok: false, message: '请先完成界面列出的配置，再发布项目。' };
    }

    // Section 8.10: block before any write, commit, copy or push.
    let currentText: string;
    try {
      currentText = await fs.readFile(
        path.join(state.root, project, 'ideas.md'),
        'utf8'
      );
    } catch (error) {
      return {
        ok: false,
        message: `无法读取项目 ideas.md：${
          error instanceof Error ? error.message : String(error)
        }`
      };
    }
    if (parseIdeas(currentText).hasUnsealedContent) {
      return { ok: false, message: '存在未证明的新内容，请先证明' };
    }

    // Section 8.10 preflight: avoid offering "publish" when the inner clone
    // has no usable HEAD (empty or interrupted clone).
    const innerPath = remoteRepoPath(state.root);
    const innerHead = await checkInnerRepositoryHead(innerPath);
    if (!innerHead.ok) {
      this.log(
        `publish: inner repository preflight failed: ${innerHead.error}\n${innerHead.detail}`
      );
      return { ok: false, message: innerHead.error };
    }

    const projectDir = path.join(state.root, project);
    const scan = await scanProjectDirectory(projectDir);
    if (scan.blocked.length > 0) {
      return {
        ok: false,
        message: `检测到无法安全发布的文件，已停止发布：\n${scan.blocked.join('\n')}`
      };
    }

    const target = path.join(remoteRepoPath(state.root), project);
    const targetExists = await exists(target);

    const fileList =
      scan.files.length === 0
        ? '（项目目录中没有文件）'
        : scan.files.join('\n');
    const detail = `将公开的文件夹：${project}\n文件清单：\n${fileList}${
      targetExists ? '\n\n远程创意仓库已存在同名目录，本次发布将覆盖该目录。' : ''
    }`;

    const first = await vscode.window.showWarningMessage(
      `您的创意“${project}”将发布到您的远程创意仓库并公开，确认吗？`,
      { modal: true, detail },
      targetExists ? '覆盖并继续' : '确认发布',
      '取消'
    );
    if (first === undefined || first === '取消') {
      return { ok: false, message: '已取消发布。' };
    }

    const second = await vscode.window.showWarningMessage(
      '为防止项目正式发布前误操作公开创意，请再确认一次！',
      { modal: true, detail: `项目：${project}` },
      '确认发布',
      '取消'
    );
    if (second === undefined || second === '取消') {
      return { ok: false, message: '已取消发布。' };
    }

    const token = await getGitHubToken(true);
    if (!token) {
      return { ok: false, message: '需要登录 GitHub 才能发布到远程创意仓库。' };
    }

    return vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: '正在发布项目…' },
      async (progress) => {
        const remote = state.remote!;

        progress.report({ message: '同步远程创意仓库…' });
        const sync = await syncInnerRepository(innerPath, remote.branch);
        if (!sync.ok) {
          this.log(
            `publish: inner repository sync failed: ${sync.error}${
              sync.detail ? `\n${sync.detail}` : ''
            }`
          );
          return { ok: false, message: sync.error };
        }

        const beforeHead = await readInnerRepositoryHead(innerPath);
        if (!beforeHead.ok) {
          this.log(
            `publish: inner repository HEAD read failed: ${beforeHead.error}\n${beforeHead.detail}`
          );
          return { ok: false, message: beforeHead.error };
        }

        progress.report({ message: '写入发布标记…' });
        const publishedTime = formatMarkerTime(new Date());
        const publishedMarker = formatMarkerLine('published', publishedTime);
        const markerWrite = await this.appendLocalMarker(
          state.root,
          project,
          publishedMarker
        );
        if (!markerWrite.ok) {
          return { ok: false, message: markerWrite.message };
        }
        const commitNote = await this.autoCommitMarker(
          state.root,
          project,
          publishedMarker,
          publishedTime,
          'publish'
        );
        const localMarkerNote = `\n本地 Published 标记已写入。${commitNote}`;

        progress.report({ message: '复制项目文件…' });
        const copy = await copyProjectIntoInnerRepository(innerPath, project, projectDir);
        if (!copy.ok) {
          return { ok: false, message: `${copy.error}${localMarkerNote}` };
        }

        progress.report({ message: '提交并推送内层仓库…' });
        const push = await commitAndPushInnerRepository(innerPath, {
          url: remote.url,
          branch: remote.branch,
          projectName: project,
          token
        });
        if (!push.ok) {
          const rollback = await restoreInnerRepository(innerPath, beforeHead.head, project);
          this.log(
            `publish: ${push.stage} failed: ${push.error}\nrollback: ${
              rollback.ok ? 'ok' : rollback.error
            }`
          );
          const rollbackNote = rollback.ok
            ? '\n已复原本地 remote，远端未变更。'
            : `\n回滚本地 remote 失败：${rollback.error}`;
          return { ok: false, message: `${push.error}${rollbackNote}${localMarkerNote}` };
        }

        const url = remoteProjectUrl(remote.owner, remote.repo, remote.branch, project);
        return {
          ok: true,
          message: `${push.pushed ? '发布成功' : '项目已是最新状态，无需推送'}。\n远程项目地址：${url}${localMarkerNote}`
        };
      }
    );
  }

  private async appendLocalMarker(
    root: string,
    project: string,
    markerLine: string
  ): Promise<OpResult> {
    const uri = vscode.Uri.file(path.join(root, project, 'ideas.md'));
    let document;
    try {
      document = await vscode.workspace.openTextDocument(uri);
    } catch (error) {
      return {
        ok: false,
        message: `发布已停止：无法读取项目 ideas.md（${
          error instanceof Error ? error.message : String(error)
        }）。`
      };
    }

    const text = document.getText();
    const updated = appendMarkerLine(text, markerLine);
    const edit = new vscode.WorkspaceEdit();
    edit.replace(
      uri,
      new vscode.Range(new vscode.Position(0, 0), document.positionAt(text.length)),
      updated
    );
    const applied = await vscode.workspace.applyEdit(edit);
    if (!applied) {
      return { ok: false, message: '发布已停止：写入 Published 标记失败。' };
    }
    const saved = await document.save();
    if (!saved) {
      return { ok: false, message: '发布已停止：Published 标记已写入编辑器，但文件保存失败。' };
    }
    return { ok: true, message: '' };
  }
}
