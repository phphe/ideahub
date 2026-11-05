import * as vscode from 'vscode';
import { detectWorkspace, type WorkspaceState } from '../core/status';
import { initializeLocalRepository, ensureLocalGitRepository } from '../core/init';
import { installPrePushHook } from '../core/hook';
import { writeConfig } from '../core/config';
import { GitHubClient } from '../core/github';
import { validateRemoteRepository } from '../core/remote-setup';
import { parseRemoteUrl } from '../core/remote-url';
import { cloneRemoteRepository, removeLocalClone } from '../core/clone';
import { getGitHubToken } from './auth';

export interface OpResult {
  ok: boolean;
  message: string;
}

export class IdeahubController {
  public currentState: WorkspaceState = { kind: 'no-folder' };

  public workspaceRoot(): string | null {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null;
  }

  public async refresh(): Promise<WorkspaceState> {
    this.currentState = await detectWorkspace(this.workspaceRoot());
    return this.currentState;
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
    if (!immutabilityConfirmed) {
      return {
        ok: false,
        message: `请先在 https://github.com/${parsed.value.owner}/${parsed.value.repo}/settings 启用 “Enable release immutability”，并勾选已启用确认。`
      };
    }

    const token = await getGitHubToken(true);
    if (!token) {
      return { ok: false, message: '需要登录 GitHub 才能校验远程创意仓库。' };
    }

    const client = new GitHubClient(async () => token);
    const validation = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: '正在校验远程创意仓库…' },
      () => validateRemoteRepository(url, client)
    );
    if (!validation.ok) {
      return { ok: false, message: validation.error };
    }

    const state = this.currentState;
    const previous = state.kind === 'local' ? state.remote : null;
    if (
      previous &&
      (previous.owner.toLowerCase() !== validation.remote.owner.toLowerCase() ||
        previous.repo.toLowerCase() !== validation.remote.repo.toLowerCase())
    ) {
      const choice = await vscode.window.showWarningMessage(
        '更换远程创意仓库地址会影响已有证明的可验证性；已有证明仍然保留在原远程仓库中。确认更换吗？',
        { modal: true },
        '确认更换'
      );
      if (choice !== '确认更换') {
        return { ok: false, message: '已取消更换远程地址。' };
      }
    }

    await writeConfig(root, { version: 1, remote: validation.remote });
    const hookResult = await installPrePushHook(root, {
      owner: validation.remote.owner,
      repo: validation.remote.repo
    });
    if (!hookResult.ok) {
      return { ok: false, message: `远程地址已保存，但 ${hookResult.error}` };
    }

    const extra =
      state.kind === 'local' && state.remoteDirExists
        ? '\n当前 .ideahub/remote/ 若与新地址不一致，请执行“重新克隆”。'
        : '';
    return {
      ok: true,
      message: `远程地址已保存（分支 ${validation.remote.branch}）。GitHub API 无法检测 Release 不可变性，请自行确认已启用。${extra}`
    };
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

  public async openProject(project: string): Promise<void> {
    const root = this.requireLocalRoot();
    if (!root) {
      return;
    }
    const uri = vscode.Uri.file(`${root}/${project}/ideas.md`);
    try {
      const document = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(document);
    } catch (error) {
      void vscode.window.showErrorMessage(
        `无法打开项目 ideas.md：${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
