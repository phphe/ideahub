import * as vscode from 'vscode';
import { MainViewProvider } from './ui/main-view';

export function activate(context: vscode.ExtensionContext): void {
  const provider = new MainViewProvider();

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(MainViewProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: false }
    }),
    vscode.commands.registerCommand('ideahub.refresh', () => provider.refresh()),
    vscode.commands.registerCommand('ideahub.openMain', async () => {
      await vscode.commands.executeCommand('ideahub.main.focus');
      await provider.refresh();
    })
  );
}

export function deactivate(): void {
  // No global resources to dispose.
}
