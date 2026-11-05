import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { detectWorkspace, type ProjectRemoteStatus, type RemoteStatus, type WorkspaceState } from '../core/status';
import { initializeLocalRepository, ensureLocalGitRepository } from '../core/init';
import { installPrePushHook } from '../core/hook';
import { remoteRepoPath, writeConfig } from '../core/config';
import { GitHubClient } from '../core/github';
import { validateRemoteRepository } from '../core/remote-setup';
import { parseRemoteUrl } from '../core/remote-url';
import { decideRemoteSetup, describeReleaseImmutability } from '../core/immutability';
import { cloneRemoteRepository, inspectRemoteTarget, removeLocalClone } from '../core/clone';
import {
  runRemoteSetupFlow,
  type RemoteSetupFlowResult,
  type RemoteSetupStep
} from '../core/remote-setup-flow';
import { appendMarker, computeProofHash, parseIdeas } from '../core/ideas';
import {
  commitAndPushInnerRepository,
  copyProjectIntoInnerRepository,
  remoteProjectUrl,
  scanProjectDirectory,
  syncInnerRepository
} from '../core/publish';
import { getGitHubToken } from './auth';

export interface OpResult {
  ok: boolean;
  message: string;
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

  public workspaceRoot(): string | null {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null;
  }

  public async refresh(): Promise<WorkspaceState> {
    const state = await detectWorkspace(this.workspaceRoot());
    if (state.kind === 'local' && state.remote) {
      state.remoteStatus = await this.loadRemoteStatus(state);
    }
    this.currentState = state;
    return state;
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
          for (const markerId of project.markerIds) {
            const release = byTag.get(`ideahub-${markerId}`);
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

  public async initialize(): Promise<OpResult> {
    const state = this.currentState;
    if (state.kind !== 'empty-folder') {
      return { ok: false, message: '当前状态不允许初始化。' };
    }
    const result = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: '正在初始化本地创意仓库…' },
      () => initializeLocalRepository(state.root)
    );
    if (result.ok) {
      return { ok: true, message: '本地创意仓库已初始化。' };
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

  public async setRemote(url: string, immutabilityConfirmed: boolean): Promise<OpResult> {
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

    const result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: '配置远程创意仓库（1/2 校验 → 2/2 克隆）',
        cancellable: false
      },
      (progress) =>
        runRemoteSetupFlow({
          validate: () => validateRemoteRepository(url, client),
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
            return hookResult.ok ? { ok: true } : { ok: false, error: hookResult.error };
          },
          inspect: () => inspectRemoteTarget(root),
          clone: (remote) => cloneRemoteRepository(root, remote),
          onStep: (step) => progress.report({ message: REMOTE_SETUP_STEP_MESSAGES[step] })
        })
    );

    return formatRemoteSetupResult(result);
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
      return { ok: false, message: result.error };
    }
    return { ok: true, message: `远程创意仓库已克隆（分支 ${result.branch}）。` };
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

  public async markProject(project: string): Promise<OpResult> {
    const state = this.currentState;
    if (state.kind !== 'local' || !state.remote) {
      return { ok: false, message: '请先完成本地仓库与远程仓库配置。' };
    }
    if (state.issues.length > 0) {
      return { ok: false, message: '请先完成界面列出的配置，再生成证明。' };
    }

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
    const parsed = parseIdeas(text, project);
    if (!parsed.hasUnsealedContent) {
      return { ok: true, message: '没有需要生成证明的新内容。' };
    }

    if (!parsed.integrityOk) {
      const choice = await vscode.window.showWarningMessage(
        '检测到已封存内容已被修改，原证明将失效。仍要为当前新增内容生成新证明吗？旧标记不会被自动删除或重写。',
        { modal: true },
        '仍然生成',
        '取消'
      );
      if (choice !== '仍然生成') {
        return { ok: false, message: '已取消生成证明。' };
      }
    }

    const hash = computeProofHash(project, parsed.unsealedText);
    if (parsed.markers.some((marker) => marker.id === hash)) {
      return { ok: true, message: '当前新增内容与已有证明相同，未重复创建 Release。' };
    }

    const token = await getGitHubToken(true);
    if (!token) {
      return { ok: false, message: '需要登录 GitHub 才能创建证明 Release。' };
    }

    const client = new GitHubClient(async () => token);
    const tag = `ideahub-${hash}`;
    let release;
    try {
      release = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: '正在创建证明 Release…' },
        () => client.createRelease(state.remote!.owner, state.remote!.repo, tag, hash, state.remote!.branch)
      );
    } catch (error) {
      return {
        ok: false,
        message: `创建 Release 失败，未写入任何标记：${
          error instanceof Error ? error.message : String(error)
        }`
      };
    }

    const updated = appendMarker(text, hash);
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

    const time = release.release?.publishedAt ? `，发布时间 ${release.release.publishedAt}` : '';
    const immutability = describeReleaseImmutability(release.release?.immutable);
    return {
      ok: true,
      message: `${release.created ? '证明已生成' : '证明已存在，已补写本地标记'}：\n${tag}${time}\n${immutability}`
    };
  }

  public async publishProject(project: string): Promise<OpResult> {
    const state = this.currentState;
    if (state.kind !== 'local' || !state.remote) {
      return { ok: false, message: '请先完成本地仓库与远程仓库配置。' };
    }
    if (state.issues.length > 0) {
      return { ok: false, message: '请先完成界面列出的配置，再发布项目。' };
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
        const innerPath = remoteRepoPath(state.root);

        progress.report({ message: '同步远程创意仓库…' });
        const sync = await syncInnerRepository(innerPath, remote.branch);
        if (!sync.ok) {
          return { ok: false, message: sync.error };
        }

        progress.report({ message: '复制项目文件…' });
        const copy = await copyProjectIntoInnerRepository(innerPath, project, projectDir);
        if (!copy.ok) {
          return { ok: false, message: copy.error };
        }

        progress.report({ message: '提交并推送内层仓库…' });
        const push = await commitAndPushInnerRepository(innerPath, {
          url: remote.url,
          branch: remote.branch,
          projectName: project,
          token
        });
        if (!push.ok) {
          return { ok: false, message: push.error };
        }

        const url = remoteProjectUrl(remote.owner, remote.repo, remote.branch, project);
        return {
          ok: true,
          message: `${push.pushed ? '发布成功' : '项目已是最新状态，无需推送'}。\n远程项目地址：${url}`
        };
      }
    );
  }
}
