import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as vscode from 'vscode';
import type { WorkspaceState } from '../src/core/status';
import { IdeahubController } from '../src/ui/controller';
import { MainViewProvider } from '../src/ui/main-view';

const mocks = vi.hoisted(() => ({
  createFileSystemWatcher: vi.fn(),
  showErrorMessage: vi.fn(),
  showInformationMessage: vi.fn(),
  showWarningMessage: vi.fn()
}));

vi.mock('vscode', () => {
  class RelativePattern {
    constructor(
      readonly base: unknown,
      readonly pattern: string
    ) {}
  }
  return {
    window: {
      showErrorMessage: mocks.showErrorMessage,
      showInformationMessage: mocks.showInformationMessage,
      showWarningMessage: mocks.showWarningMessage,
      withProgress: vi.fn((_options: unknown, task: () => unknown) => task())
    },
    workspace: {
      workspaceFolders: [{ uri: { fsPath: 'C:/repo' } }],
      createFileSystemWatcher: mocks.createFileSystemWatcher,
      getConfiguration: vi.fn()
    },
    RelativePattern,
    Uri: {
      file: (fsPath: string) => ({ fsPath }),
      joinPath: (base: { fsPath: string }, ...segments: string[]) => ({
        fsPath: [base.fsPath, ...segments].join('/')
      })
    },
    ProgressLocation: { Notification: 1 },
    env: { language: 'zh-cn' }
  };
});

const EXTENSION_URI = { fsPath: 'C:/ext' } as unknown as vscode.Uri;

const PROJECT = {
  name: 'MyGame',
  proofCount: 1,
  proofTags: [`ideahub-${'a'.repeat(64)}`],
  publishedCount: 0,
  hasNewContent: false,
  canPublish: true
};

const STATE: WorkspaceState = {
  kind: 'local',
  root: 'C:/repo',
  remote: null,
  configError: null,
  remoteDirExists: false,
  issues: [],
  projects: [PROJECT]
};

interface FakeUri {
  fsPath: string;
}

interface WatcherStub {
  onDidChange(callback: (uri: FakeUri) => void): void;
  onDidCreate(callback: (uri: FakeUri) => void): void;
  onDidDelete(callback: (uri: FakeUri) => void): void;
  dispose: ReturnType<typeof vi.fn>;
  change(fsPath: string): void;
  create(fsPath: string): void;
  remove(fsPath: string): void;
}

function makeWatcher(): WatcherStub {
  const changeCallbacks: Array<(uri: FakeUri) => void> = [];
  const createCallbacks: Array<(uri: FakeUri) => void> = [];
  const deleteCallbacks: Array<(uri: FakeUri) => void> = [];
  const fire = (
    callbacks: Array<(uri: FakeUri) => void>,
    fsPath: string
  ): void => {
    for (const callback of callbacks) {
      callback({ fsPath });
    }
  };
  return {
    onDidChange: (callback) => changeCallbacks.push(callback),
    onDidCreate: (callback) => createCallbacks.push(callback),
    onDidDelete: (callback) => deleteCallbacks.push(callback),
    dispose: vi.fn(),
    change: (fsPath) => fire(changeCallbacks, fsPath),
    create: (fsPath) => fire(createCallbacks, fsPath),
    remove: (fsPath) => fire(deleteCallbacks, fsPath)
  };
}

function createView(): {
  view: vscode.WebviewView;
  webview: {
    html: string;
    postMessage: ReturnType<typeof vi.fn>;
  };
  htmlSets: string[];
  send(message: unknown): void;
  setVisible(visible: boolean): void;
} {
  let visibilityCallback: (() => void) | undefined;
  let messageCallback: ((message: unknown) => void) | undefined;
  let htmlValue = '';
  const htmlSets: string[] = [];
  const webview = {
    options: {} as Record<string, unknown>,
    cspSource: 'vscode-resource:',
    asWebviewUri: (uri: { fsPath: string }) => ({
      toString: () => `vscode-resource:${uri.fsPath}`
    }),
    onDidReceiveMessage: (callback: (message: unknown) => void) => {
      messageCallback = callback;
    },
    postMessage: vi.fn(async () => true)
  };
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
    onDidChangeVisibility: (callback: () => void) => {
      visibilityCallback = callback;
    }
  };
  return {
    view: view as unknown as vscode.WebviewView,
    webview: webview as unknown as {
      html: string;
      postMessage: ReturnType<typeof vi.fn>;
    },
    htmlSets,
    send(message: unknown) {
      messageCallback?.(message);
    },
    setVisible(visible: boolean) {
      view.visible = visible;
      visibilityCallback?.();
    }
  };
}

function outputChannel(): vscode.OutputChannel {
  return { appendLine: vi.fn() } as unknown as vscode.OutputChannel;
}

describe('busy icon reset', () => {
  it('posts resetBusy as soon as a successful createProject settles', async () => {
    const controller = controllerStub();
    const created = await mount(controller);

    created.send({ type: 'createProject' });
    await vi.waitFor(() => expect(mocks.showInformationMessage).toHaveBeenCalled());

    expect(created.webview.postMessage).toHaveBeenCalledWith({ type: 'resetBusy' });
    expect(controller.refresh).toHaveBeenCalled();
  });

  it('posts resetBusy after a refresh command settles', async () => {
    const controller = controllerStub();
    const created = await mount(controller);
    created.webview.postMessage.mockClear();

    created.send({ type: 'refresh' });
    await vi.waitFor(() =>
      expect(created.webview.postMessage).toHaveBeenCalledWith({ type: 'resetBusy' })
    );
  });

  it('posts resetBusy before waiting for the refresh to finish', async () => {
    const controller = controllerStub();
    const created = await mount(controller);
    let releaseRefresh: (() => void) | undefined;
    controller.refresh.mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseRefresh = () => resolve(STATE);
        })
    );
    created.webview.postMessage.mockClear();

    created.send({ type: 'createProject' });
    await vi.waitFor(() =>
      expect(created.webview.postMessage).toHaveBeenCalledWith({ type: 'resetBusy' })
    );

    releaseRefresh?.();
  });
});

function controllerStub(): {
  currentState: WorkspaceState;
  refresh: ReturnType<typeof vi.fn>;
  summarizeProjectByName: ReturnType<typeof vi.fn>;
  createProject: ReturnType<typeof vi.fn>;
} {
  return {
    currentState: STATE,
    refresh: vi.fn(async () => STATE),
    summarizeProjectByName: vi.fn(async () => ({ ...PROJECT, proofCount: 3 })),
    createProject: vi.fn(async () => ({ ok: true, message: '项目已创建。' }))
  };
}

let watchers: WatcherStub[] = [];

async function mount(
  controller: ReturnType<typeof controllerStub>
): Promise<ReturnType<typeof createView>> {
  const provider = new MainViewProvider(
    controller as unknown as IdeahubController,
    outputChannel(),
    EXTENSION_URI
  );
  const created = createView();
  provider.resolveWebviewView(created.view);
  await vi.waitFor(() => expect(created.htmlSets.length).toBe(1));
  return created;
}

async function afterDebounce(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 600));
}

beforeEach(() => {
  watchers = [];
  mocks.createFileSystemWatcher.mockReset();
  mocks.createFileSystemWatcher.mockImplementation(() => {
    const watcher = makeWatcher();
    watchers.push(watcher);
    return watcher;
  });
});

describe('ideas.md watcher', () => {
  it('watches only **/ideas.md under the workspace root', async () => {
    await mount(controllerStub());

    expect(mocks.createFileSystemWatcher).toHaveBeenCalledTimes(1);
    const pattern = mocks.createFileSystemWatcher.mock.calls[0][0] as {
      base: { fsPath: string };
      pattern: string;
    };
    expect(pattern.pattern).toBe('**/ideas.md');
    expect(pattern.base.fsPath).toBe('C:/repo');
  });

  it('disposes the watcher while hidden and recreates it when visible again', async () => {
    const created = await mount(controllerStub());
    const first = watchers[0];

    created.setVisible(false);
    expect(first.dispose).toHaveBeenCalledTimes(1);

    created.setVisible(true);
    await vi.waitFor(() =>
      expect(mocks.createFileSystemWatcher).toHaveBeenCalledTimes(2)
    );
    expect(watchers).toHaveLength(2);
  });

  it('debounces repeated changes into one badge patch without rewriting the page', async () => {
    const controller = controllerStub();
    const created = await mount(controller);
    const watcher = watchers[0];

    watcher.change('C:/repo/MyGame/ideas.md');
    watcher.change('C:/repo/MyGame/ideas.md');
    watcher.change('C:/repo/MyGame/ideas.md');
    await afterDebounce();

    expect(controller.summarizeProjectByName).toHaveBeenCalledTimes(1);
    expect(controller.summarizeProjectByName).toHaveBeenCalledWith('MyGame');
    expect(created.htmlSets).toHaveLength(1);
    expect(created.webview.postMessage).toHaveBeenCalledTimes(1);
    expect(created.webview.postMessage).toHaveBeenCalledWith({
      type: 'projectBadges',
      project: 'MyGame',
      html: expect.stringContaining('3个证明')
    });
  });

  it('refreshes the whole list once on a debounced create or delete', async () => {
    const controller = controllerStub();
    const created = await mount(controller);
    const watcher = watchers[0];

    watcher.create('C:/repo/NewGame/ideas.md');
    watcher.remove('C:/repo/MyGame/ideas.md');
    await afterDebounce();

    expect(controller.refresh).toHaveBeenCalledTimes(2);
    expect(created.htmlSets).toHaveLength(2);
    expect(created.webview.postMessage).not.toHaveBeenCalled();
  });

  it('ignores .git, node_modules, .ideahub and nested ideas.md paths', async () => {
    const controller = controllerStub();
    const created = await mount(controller);
    const watcher = watchers[0];

    watcher.change('C:/repo/.git/ideas.md');
    watcher.change('C:/repo/node_modules/ideas.md');
    watcher.change('C:/repo/.ideahub/ideas.md');
    watcher.change('C:/repo/MyGame/sub/ideas.md');
    watcher.change('C:/repo/ideas.md');
    await afterDebounce();

    expect(controller.summarizeProjectByName).not.toHaveBeenCalled();
    expect(created.htmlSets).toHaveLength(1);
    expect(created.webview.postMessage).not.toHaveBeenCalled();
  });

  it('ignores events that arrive after the panel is hidden', async () => {
    const controller = controllerStub();
    const created = await mount(controller);
    const watcher = watchers[0];

    created.setVisible(false);
    watcher.change('C:/repo/MyGame/ideas.md');
    watcher.create('C:/repo/NewGame/ideas.md');
    await afterDebounce();

    expect(controller.summarizeProjectByName).not.toHaveBeenCalled();
    expect(controller.refresh).toHaveBeenCalledTimes(1);
    expect(created.htmlSets).toHaveLength(1);
  });
});
