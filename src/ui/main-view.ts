import * as vscode from 'vscode';
import type { WorkspaceState } from '../core/status';
import { IdeahubController, type OpResult } from './controller';
import {
  DEFAULT_WEBVIEW_ASSETS,
  renderMainHtml,
  renderSettingsHtml,
  type RemoteSettingsInfo,
  type WebviewAssets
} from './html';
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
  private settingsInfo: RemoteSettingsInfo | null = null;
  /** Invalidates in-flight settings refreshes after leaving the settings view. */
  private settingsRequest = 0;
  private assets: WebviewAssets = DEFAULT_WEBVIEW_ASSETS;

  constructor(
    private readonly controller: IdeahubController,
    private readonly output: vscode.OutputChannel,
    private readonly extensionUri: vscode.Uri
  ) {}

  private log(message: string): void {
    this.output.appendLine(`[${new Date().toISOString()}] ${message}`);
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    this.log('resolveWebviewView: webview view created');
    const mediaRoot = vscode.Uri.joinPath(this.extensionUri, 'media');
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [mediaRoot]
    };
    this.assets = {
      cspSource: webviewView.webview.cspSource,
      codiconCssUri: webviewView.webview
        .asWebviewUri(vscode.Uri.joinPath(mediaRoot, 'codicon.css'))
        .toString()
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
    if (this.settingsInfo) {
      // Settings must switch instantly: render the cached snapshot first and
      // patch API-derived fields later instead of blocking on network IO.
      const info = this.controller.currentRemoteSettingsInfo();
      this.settingsInfo = info;
      this.view.webview.html = renderSettingsHtml(info, this.assets);
      void this.loadSettingsInfo();
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
    this.view.webview.html = renderMainHtml(state, this.assets);
  }

  private openSettings(): void {
    if (!this.view) {
      return;
    }
    const info = this.controller.currentRemoteSettingsInfo();
    this.settingsInfo = info;
    this.view.webview.html = renderSettingsHtml(info, this.assets);
    this.log('settings: opened (instant, cached snapshot)');
    void this.loadSettingsInfo();
  }

  private renderCurrentView(): void {
    if (!this.view) {
      return;
    }
    this.view.webview.html = this.settingsInfo
      ? renderSettingsHtml(this.settingsInfo, this.assets)
      : renderMainHtml(this.controller.currentState, this.assets);
  }

  private closeSettings(): void {
    if (!this.view) {
      return;
    }
    this.settingsRequest += 1;
    this.settingsInfo = null;
    // Reuse the in-memory workspace state: no git/API scan on the way back.
    this.view.webview.html = renderMainHtml(this.controller.currentState, this.assets);
    this.log('settings: closed (instant, reused cached state)');
  }

  private async loadSettingsInfo(): Promise<void> {
    const request = ++this.settingsRequest;
    let info: RemoteSettingsInfo;
    try {
      info = await this.controller.getRemoteSettingsInfo();
    } catch (error) {
      this.log(`settings: remote info failed: ${describeError(error)}`);
      return;
    }
    if (request !== this.settingsRequest || this.settingsInfo === null) {
      return;
    }
    this.settingsInfo = info;
    void this.view?.webview.postMessage({ type: 'settingsInfo', info });
    this.log('settings: remote info patched asynchronously');
  }

  private async handleMessage(message: WebviewMessage): Promise<void> {
    try {
      await this.dispatchMessage(message);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.log(`message handling failed (${message.type ?? 'unknown'}): ${describeError(error)}`);
      void vscode.window.showErrorMessage(`操作失败：${reason}`);
      try {
        await this.refresh();
      } catch (refreshError) {
        this.log(`failed to render error state: ${describeError(refreshError)}`);
      }
    }
  }

  private async dispatchMessage(message: WebviewMessage): Promise<void> {
    if (message.type === 'openSettings') {
      this.openSettings();
      return;
    }
    if (message.type === 'closeSettings') {
      this.closeSettings();
      return;
    }

    if (message.type === 'uiError') {
      const reason = message.message || '未知的前端错误';
      this.log(`webview script error: ${reason}`);
      void vscode.window.showErrorMessage(`界面脚本出错：${reason}`);
      await this.refresh();
      return;
    }

    const handlers: RouteHandlers = {
      refresh: async () => {
        await this.refresh();
      },
      initialize: () => this.controller.initialize(),
      initializeNonEmpty: () => this.controller.initialize(true),
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
      // Native progress keeps the webview layout untouched while an operation runs.
      result = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, cancellable: false },
        () => operation()
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.log(`action crashed: ${name}: ${describeError(error)}`);
      result = { ok: false, message: `操作失败：${reason}` };
    }
    this.log(`action finished: ${name} -> ${result.ok ? 'ok' : 'error'}: ${result.message}`);
    if (result.silent) {
      // Cancelled by the user: restore the un-busy page without any IO so the
      // buttons that the webview disabled become clickable again.
      this.renderCurrentView();
      return;
    }
    if (!result.ok) {
      void vscode.window.showErrorMessage(result.message);
      await this.refresh();
      return;
    }
    if (isSilentSuccess(name)) {
      return;
    }
    void vscode.window.showInformationMessage(result.message);
    await this.refresh();
  }
}
