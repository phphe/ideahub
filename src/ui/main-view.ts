import * as vscode from 'vscode';

export class MainViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'ideahub.main';

  private view?: vscode.WebviewView;

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: []
    };
    webviewView.webview.html = this.renderPlaceholder();
    webviewView.webview.onDidReceiveMessage(() => {
      void this.refresh();
    });
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        void this.refresh();
      }
    });
  }

  public async refresh(): Promise<void> {
    if (!this.view) {
      return;
    }
    this.view.webview.html = this.renderPlaceholder();
  }

  private renderPlaceholder(): string {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>创意仓库</title>
</head>
<body>
  <p>创意仓库正在加载…</p>
</body>
</html>`;
  }
}
