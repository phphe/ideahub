import * as vscode from 'vscode';
import { detectWorkspace, type WorkspaceState } from '../core/status';
import { initializeLocalRepository, ensureLocalGitRepository } from '../core/init';
import { installPrePushHook } from '../core/hook';

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
