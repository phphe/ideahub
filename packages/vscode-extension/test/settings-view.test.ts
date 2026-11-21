import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceState } from '@ideahub/core';
import type { IdeahubController } from '../src/ui/controller';
import type { RemoteSettingsInfo } from '../src/ui/html';
import { MainViewProvider } from '../src/ui/main-view';

vi.mock('vscode', () => ({
  window: {
    showErrorMessage: vi.fn(),
    showInformationMessage: vi.fn(),
    showWarningMessage: vi.fn(),
    withProgress: vi.fn((_options, task) => task())
  },
  workspace: { getConfiguration: vi.fn() },
  Uri: {
    file: (fsPath: string) => ({ fsPath }),
    joinPath: (base: { fsPath: string }, ...parts: string[]) => ({
      fsPath: [base.fsPath, ...parts].join('/')
    })
  },
  ProgressLocation: { Notification: 1 },
  l10n: {
    t: (message: string, ...args: unknown[]) =>
      message.replace(/\{(\d+)\}/g, (match, index) => {
        const value = args[Number(index)];
        return value === undefined ? match : String(value);
      })
  },
  env: { language: 'en' }
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
  visibility: 'Public',
  error: null,
  display: {
    url: REMOTE.url,
    ownerRepo: 'phphe/test_1027e9ad9a',
    host: 'github.com',
    branch: 'main'
  }
};

const PLACEHOLDER: RemoteSettingsInfo = {
  ...CACHED,
  visibility: 'Loading…'
};

function outputChannel(): import('vscode').OutputChannel {
  return { appendLine: vi.fn() } as unknown as import('vscode').OutputChannel;
}

type FakeWebview = {
  html: string;
  options: Record<string, unknown>;
  cspSource: string;
  asWebviewUri: (uri: { fsPath: string }) => { toString: () => string };
  onDidReceiveMessage: (callback: (message: unknown) => void) => void;
  postMessage: ReturnType<typeof vi.fn>;
};

function createView(): {
  view: import('vscode').WebviewView;
  webview: FakeWebview;
  /** Every html assignment, so tests can assert a full re-render happened. */
  htmlSets: string[];
  handler: () => (message: unknown) => void;
} {
  let receive: ((message: unknown) => void) | undefined;
  let htmlValue = '';
  const htmlSets: string[] = [];
  const webview = {
    options: {} as Record<string, unknown>,
    cspSource: 'vscode-resource:',
    asWebviewUri: (uri: { fsPath: string }) => ({
      toString: () => `vscode-resource:${uri.fsPath}`
    }),
    onDidReceiveMessage: (callback: (message: unknown) => void) => {
      receive = callback;
    },
    postMessage: vi.fn(async () => true)
  } as unknown as FakeWebview;
  Object.defineProperty(webview, 'html', {
    get: () => htmlValue,
    set: (value: string) => {
      htmlValue = value;
      htmlSets.push(value);
    }
  });
  const view = {
    visible: true,
    webview,
    onDidChangeVisibility: vi.fn()
  };
  return {
    view: view as unknown as import('vscode').WebviewView,
    webview,
    htmlSets,
    handler: () => {
      expect(receive).toBeTypeOf('function');
      return receive!;
    }
  };
}

const EXTENSION_URI = { fsPath: 'C:/ext' } as unknown as import('vscode').Uri;

async function mount(provider: MainViewProvider) {
  const created = createView();
  provider.resolveWebviewView(created.view);
  await vi.waitFor(() => expect(created.webview.html).toContain('<h1>Idea projects</h1>'));
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
      outputChannel(),
      EXTENSION_URI
    );
    const { webview, handler } = await mount(provider);

    expect(controller.refresh).toHaveBeenCalledTimes(1);

    // The message handler must render settings before returning to the event loop.
    handler()({ type: 'openSettings' });
    expect(webview.html).toContain('<h1>Settings</h1>');
    expect(webview.html).toContain('Remote proof repository');
    expect(controller.currentRemoteSettingsInfo).toHaveBeenCalledTimes(1);

    handler()({ type: 'closeSettings' });
    expect(webview.html).toContain('<h1>Idea projects</h1>');
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
      outputChannel(),
      EXTENSION_URI
    );
    const { webview, handler } = await mount(provider);

    handler()({ type: 'openSettings' });
    expect(webview.html).toContain('<h1>Settings</h1>');
    expect(webview.html).toContain('Loading…');

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
      outputChannel(),
      EXTENSION_URI
    );
    const { webview, handler } = await mount(provider);

    handler()({ type: 'openSettings' });
    handler()({ type: 'closeSettings' });
    resolveInfo(CACHED);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(webview.html).toContain('<h1>Idea projects</h1>');
    expect(webview.postMessage).not.toHaveBeenCalled();
  });
});

describe('busy state recovery', () => {
  const NOT_IDEAHUB: WorkspaceState = { kind: 'not-ideahub', root: 'C:/repo' };

  function createProvider(controller: Record<string, unknown>): MainViewProvider {
    return new MainViewProvider(
      controller as unknown as IdeahubController,
      outputChannel(),
      EXTENSION_URI
    );
  }

  async function mountState(
    controller: Record<string, unknown>
  ): Promise<ReturnType<typeof createView>> {
    const provider = createProvider(controller);
    const created = createView();
    provider.resolveWebviewView(created.view);
    await vi.waitFor(() => expect(created.htmlSets.length).toBe(1));
    return created;
  }

  it('posts a busy reset instead of rewriting the page after a cancelled non-empty init', async () => {
    const controller = {
      currentState: NOT_IDEAHUB,
      refresh: vi.fn(async () => NOT_IDEAHUB),
      initialize: vi.fn(async () => ({ ok: false, message: '', silent: true }))
    };
    const { webview, htmlSets, handler } = await mountState(controller);
    expect(webview.html).toContain('data-action="initNonEmpty"');

    handler()({ type: 'initNonEmpty' });
    await vi.waitFor(() =>
      expect(webview.postMessage).toHaveBeenCalledWith({ type: 'resetBusy' })
    );
    expect(controller.initialize).toHaveBeenCalledWith(true);
    // The page stays intact so the scroll position and focus survive cancellation.
    expect(htmlSets.length).toBe(1);
    expect(controller.refresh).toHaveBeenCalledTimes(1);

    // The already-rendered page can prompt for confirmation a second time.
    handler()({ type: 'initNonEmpty' });
    await vi.waitFor(() => expect(controller.initialize).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(webview.postMessage).toHaveBeenCalledTimes(2));
    expect(htmlSets.length).toBe(1);
  });

  it('posts the same busy reset when setRemote is cancelled in the settings view', async () => {
    const controller = {
      currentState: STATE,
      refresh: vi.fn(async () => STATE),
      currentRemoteSettingsInfo: vi.fn(() => CACHED),
      getRemoteSettingsInfo: vi.fn(
        () => new Promise<RemoteSettingsInfo>(() => undefined)
      ),
      setRemote: vi.fn(async () => ({ ok: false, message: '', silent: true }))
    };
    const { webview, htmlSets, handler } = await mountState(controller);

    handler()({ type: 'openSettings' });
    expect(htmlSets.length).toBe(2);
    expect(webview.html).toContain('<h1>Settings</h1>');

    handler()({
      type: 'setRemote',
      url: 'https://github.com/phphe/other'
    });
    await vi.waitFor(() =>
      expect(webview.postMessage).toHaveBeenCalledWith({ type: 'resetBusy' })
    );
    expect(controller.setRemote).toHaveBeenCalledWith('https://github.com/phphe/other');
    expect(htmlSets.length).toBe(2);
    expect(webview.html).toContain('<h1>Settings</h1>');
  });

  it('re-renders after a failed clone so the retry button is clickable again', async () => {
    const controller = {
      currentState: NOT_IDEAHUB,
      refresh: vi.fn(async () => NOT_IDEAHUB),
      cloneRemote: vi.fn(async () => ({ ok: false, message: 'clone failed' }))
    };
    const { webview, htmlSets, handler } = await mountState(controller);

    handler()({ type: 'clone' });
    await vi.waitFor(() => expect(htmlSets.length).toBe(2));
    expect(controller.refresh).toHaveBeenCalledTimes(2);
    expect(webview.html).toContain('data-action="initNonEmpty"');
  });
});
