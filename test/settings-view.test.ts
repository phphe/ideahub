import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceState } from '../src/core/status';
import type { IdeahubController } from '../src/ui/controller';
import type { RemoteSettingsInfo } from '../src/ui/html';
import { MainViewProvider } from '../src/ui/main-view';

vi.mock('vscode', () => ({
  window: {
    showErrorMessage: vi.fn(),
    showInformationMessage: vi.fn(),
    showWarningMessage: vi.fn(),
    withProgress: vi.fn()
  },
  workspace: { getConfiguration: vi.fn() },
  Uri: { file: (fsPath: string) => ({ fsPath }) },
  ProgressLocation: { Notification: 1 },
  env: { language: 'zh-cn' }
}));

const REMOTE = {
  provider: 'github' as const,
  owner: 'phphe',
  repo: 'test_1027e9ad9a',
  url: 'https://github.com/phphe/test_1027e9ad9a',
  branch: 'main'
};

const STATE: WorkspaceState = {
  kind: 'local',
  root: 'C:/repo',
  remote: REMOTE,
  configError: null,
  remoteDirExists: true,
  issues: [],
  projects: []
};

const CACHED: RemoteSettingsInfo = {
  url: REMOTE.url,
  owner: REMOTE.owner,
  repo: REMOTE.repo,
  host: 'github.com',
  branch: 'main',
  visibility: '公开',
  immutability: '已启用 Release 不可变性',
  error: null
};

const PLACEHOLDER: RemoteSettingsInfo = {
  ...CACHED,
  visibility: '读取中…',
  immutability: '读取中…'
};

function outputChannel(): import('vscode').OutputChannel {
  return { appendLine: vi.fn() } as unknown as import('vscode').OutputChannel;
}

function createView(): {
  view: import('vscode').WebviewView;
  webview: {
    html: string;
    options: Record<string, unknown>;
    onDidReceiveMessage: (callback: (message: unknown) => void) => void;
    postMessage: ReturnType<typeof vi.fn>;
  };
  handler: () => (message: unknown) => void;
} {
  let receive: ((message: unknown) => void) | undefined;
  const webview = {
    html: '',
    options: {} as Record<string, unknown>,
    onDidReceiveMessage: (callback: (message: unknown) => void) => {
      receive = callback;
    },
    postMessage: vi.fn(async () => true)
  };
  const view = {
    visible: true,
    webview,
    onDidChangeVisibility: vi.fn()
  };
  return {
    view: view as unknown as import('vscode').WebviewView,
    webview,
    handler: () => {
      expect(receive).toBeTypeOf('function');
      return receive!;
    }
  };
}

async function mount(provider: MainViewProvider) {
  const created = createView();
  provider.resolveWebviewView(created.view);
  await vi.waitFor(() => expect(created.webview.html).toContain('<h1>创意仓库</h1>'));
  return created;
}

describe('settings view switching', () => {
  it('opens settings and returns synchronously without awaiting network or rescanning', async () => {
    const controller = {
      currentState: STATE,
      refresh: vi.fn(async () => STATE),
      currentRemoteSettingsInfo: vi.fn(() => CACHED),
      getRemoteSettingsInfo: vi.fn(
        () => new Promise<RemoteSettingsInfo>(() => undefined)
      )
    };
    const provider = new MainViewProvider(
      controller as unknown as IdeahubController,
      outputChannel()
    );
    const { webview, handler } = await mount(provider);

    expect(controller.refresh).toHaveBeenCalledTimes(1);

    // The message handler must render settings before returning to the event loop.
    handler()({ type: 'openSettings' });
    expect(webview.html).toContain('<h1>设置</h1>');
    expect(webview.html).toContain('已启用 Release 不可变性');
    expect(controller.currentRemoteSettingsInfo).toHaveBeenCalledTimes(1);

    handler()({ type: 'closeSettings' });
    expect(webview.html).toContain('<h1>创意仓库</h1>');
    expect(controller.refresh).toHaveBeenCalledTimes(1);
    expect(webview.postMessage).not.toHaveBeenCalled();
  });

  it('renders placeholders first and patches remote details asynchronously', async () => {
    const controller = {
      currentState: STATE,
      refresh: vi.fn(async () => STATE),
      currentRemoteSettingsInfo: vi.fn(() => PLACEHOLDER),
      getRemoteSettingsInfo: vi.fn(async () => CACHED)
    };
    const provider = new MainViewProvider(
      controller as unknown as IdeahubController,
      outputChannel()
    );
    const { webview, handler } = await mount(provider);

    handler()({ type: 'openSettings' });
    expect(webview.html).toContain('<h1>设置</h1>');
    expect(webview.html).toContain('读取中…');

    await vi.waitFor(() => expect(webview.postMessage).toHaveBeenCalledTimes(1));
    expect(webview.postMessage.mock.calls[0][0]).toEqual({
      type: 'settingsInfo',
      info: CACHED
    });
  });

  it('ignores a late settings result after returning to the main view', async () => {
    let resolveInfo!: (info: RemoteSettingsInfo) => void;
    const controller = {
      currentState: STATE,
      refresh: vi.fn(async () => STATE),
      currentRemoteSettingsInfo: vi.fn(() => PLACEHOLDER),
      getRemoteSettingsInfo: vi.fn(
        () =>
          new Promise<RemoteSettingsInfo>((resolve) => {
            resolveInfo = resolve;
          })
      )
    };
    const provider = new MainViewProvider(
      controller as unknown as IdeahubController,
      outputChannel()
    );
    const { webview, handler } = await mount(provider);

    handler()({ type: 'openSettings' });
    handler()({ type: 'closeSettings' });
    resolveInfo(CACHED);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(webview.html).toContain('<h1>创意仓库</h1>');
    expect(webview.postMessage).not.toHaveBeenCalled();
  });
});
