import * as vscode from 'vscode';
import { IdeahubController, type OpResult } from './controller';
import { renderMainHtml } from './html';

interface WebviewMessage {
  type?: string;
  project?: string;
}

export class MainViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'ideahub.main';

  private view?: vscode.WebviewView;

  constructor(private readonly controller: IdeahubController) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: []
    };
    webviewView.webview.onDidReceiveMessage((message: WebviewMessage) => {
      void this.handleMessage(message);
    });
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        void this.refresh();
      }
    });
    void this.refresh();
  }

  public async refresh(): Promise<void> {
    if (!this.view) {
      return;
    }
    const state = await this.controller.refresh();
    this.view.webview.html = renderMainHtml(state);
  }

  private async handleMessage(message: WebviewMessage): Promise<void> {
    switch (message.type) {
      case 'refresh':
        await this.refresh();
        return;
      case 'init':
        await this.runOperation(() => this.controller.initialize());
        return;
      case 'initGit':
        await this.runOperation(() => this.controller.initGit());
        return;
      case 'installHook':
        await this.runOperation(() => this.controller.installHook());
        return;
      case 'open':
        if (message.project) {
          await this.controller.openProject(message.project);
        }
        return;
      default:
        return;
    }
  }

  private async runOperation(operation: () => Promise<OpResult>): Promise<void> {
    const result = await operation();
    if (result.ok) {
      void vscode.window.showInformationMessage(result.message);
    } else {
      void vscode.window.showErrorMessage(result.message);
    }
    await this.refresh();
  }
}
