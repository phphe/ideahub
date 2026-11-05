import * as vscode from 'vscode';
import type { WorkspaceState } from '../core/status';
import { IdeahubController, type OpResult } from './controller';
import { renderMainHtml, type ViewNotice } from './html';
import { isSilentSuccess, routeMessage, type RouteHandlers, type WebviewMessage } from './route';

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? `${error.name}: ${error.message}`;
  }
  return String(error);
}

export class MainViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'ideahub.main';

  private view?: vscode.WebviewView;
  private notice: ViewNotice | null = null;

  constructor(
    private readonly controller: IdeahubController,
    private readonly output: vscode.OutputChannel
  ) {}

  private log(message: string): void {
    this.output.appendLine(`[${new Date().toISOString()}] ${message}`);
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    this.log('resolveWebviewView: webview view created');
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: []
    };
    webviewView.webview.onDidReceiveMessage((message: WebviewMessage) => {
      this.log(`received message: ${message.type ?? '(missing type)'}`);
      void this.handleMessage(message);
    });
    webviewView.onDidChangeVisibility(() => {
      this.log(`visibility changed: ${webviewView.visible ? 'visible' : 'hidden'}`);
      if (webviewView.visible) {
        void this.refresh();
      }
    });
    void this.refresh();
  }

  public async refresh(): Promise<void> {
    if (!this.view) {
      this.log('refresh skipped: webview view has not been created yet');
      return;
    }
    let state: WorkspaceState;
    try {
      state = await this.controller.refresh();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.log(`state detection failed: ${describeError(error)}`);
      state = { kind: 'error' as const, message: `状态检测失败：${reason}` };
    }
    this.log(`state detected: ${state.kind}${'root' in state ? ` (${state.root})` : ''}`);
    this.view.webview.html = renderMainHtml(state, this.notice);
  }

  private async handleMessage(message: WebviewMessage): Promise<void> {
    try {
      await this.dispatchMessage(message);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.log(`message handling failed (${message.type ?? 'unknown'}): ${describeError(error)}`);
      this.notice = { kind: 'error', text: `操作失败：${reason}` };
      try {
        await this.refresh();
      } catch (refreshError) {
        this.log(`failed to render error state: ${describeError(refreshError)}`);
      }
    }
  }

  private async dispatchMessage(message: WebviewMessage): Promise<void> {
    if (message.type === 'uiError') {
      const reason = message.message || '未知的前端错误';
      this.log(`webview script error: ${reason}`);
      this.notice = { kind: 'error', text: `界面脚本出错：${reason}` };
      await this.refresh();
      return;
    }

    const handlers: RouteHandlers = {
      refresh: async () => {
        this.notice = null;
        await this.refresh();
      },
      initialize: () => this.controller.initialize(),
      initGit: () => this.controller.initGit(),
      installHook: () => this.controller.installHook(),
      createProject: () => this.controller.createProject(),
      setRemote: (url, immutabilityConfirmed) =>
        this.controller.setRemote(url, immutabilityConfirmed),
      cloneRemote: (reclone) => this.controller.cloneRemote(reclone),
      openProject: (project) => this.controller.openProject(project),
      markProject: (project) => this.controller.markProject(project),
      publishProject: (project) => this.controller.publishProject(project)
    };

    const route = routeMessage(message, handlers);
    if (route.kind === 'unknown') {
      this.log(`ignored message: ${JSON.stringify(message)}`);
      return;
    }
    if (route.kind === 'command') {
      await route.run();
      return;
    }
    await this.runOperation(route.name, route.run);
  }

  private async runOperation(name: string, operation: () => Promise<OpResult>): Promise<void> {
    this.log(`action started: ${name}`);
    let result: OpResult;
    try {
      result = await operation();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.log(`action crashed: ${name}: ${describeError(error)}`);
      result = { ok: false, message: `操作失败：${reason}` };
    }
    this.log(`action finished: ${name} -> ${result.ok ? 'ok' : 'error'}: ${result.message}`);
    if (!result.ok) {
      this.notice = { kind: 'error', text: result.message };
      void vscode.window.showErrorMessage(result.message);
      await this.refresh();
      return;
    }
    if (isSilentSuccess(name)) {
      return;
    }
    this.notice = { kind: 'info', text: result.message };
    void vscode.window.showInformationMessage(result.message);
    await this.refresh();
  }
}
