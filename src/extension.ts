import * as vscode from 'vscode';
import { IdeahubController } from './ui/controller';
import { MainViewProvider } from './ui/main-view';

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('IdeaHub');
  const controller = new IdeahubController(output);
  const provider = new MainViewProvider(controller, output);

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '(none)';
  output.appendLine(`[${new Date().toISOString()}] IdeaHub activated; workspace: ${workspaceRoot}`);

  context.subscriptions.push(
    output,
    vscode.window.registerWebviewViewProvider(MainViewProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: false }
    }),
    vscode.commands.registerCommand('ideahub.refresh', () => {
      output.appendLine(`[${new Date().toISOString()}] command: ideahub.refresh`);
      return provider.refresh();
    }),
    vscode.commands.registerCommand('ideahub.openMain', async () => {
      output.appendLine(`[${new Date().toISOString()}] command: ideahub.openMain`);
      await vscode.commands.executeCommand('ideahub.main.focus');
      await provider.refresh();
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      output.appendLine(`[${new Date().toISOString()}] workspace folders changed; refreshing`);
      void provider.refresh();
    })
  );
}

export function deactivate(): void {
  // No global resources to dispose.
}
