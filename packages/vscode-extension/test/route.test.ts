import { describe, expect, it, vi } from 'vitest';
import type { OpResult } from '../src/ui/controller';
import { isSilentSuccess, routeMessage, type RouteHandlers } from '../src/ui/route';

const ok = async (): Promise<OpResult> => ({ ok: true, message: 'ok' });

function createHandlers(): RouteHandlers {
  return {
    refresh: vi.fn(async (): Promise<void> => {}),
    initialize: vi.fn(ok),
    initializeNonEmpty: vi.fn(ok),
    initGit: vi.fn(ok),
    installHook: vi.fn(ok),
    createProject: vi.fn(ok),
    setRemote: vi.fn(ok),
    cloneRemote: vi.fn(ok),
    openProject: vi.fn(ok),
    editTags: vi.fn(ok),
    copyUrl: vi.fn(ok),
    markProject: vi.fn(ok),
    publishProject: vi.fn(ok)
  };
}

describe('routeMessage', () => {
  it('routes the init message to the initialize handler', async () => {
    const handlers = createHandlers();
    const route = routeMessage({ type: 'init' }, handlers);

    expect(route.kind).toBe('operation');
    if (route.kind !== 'operation') {
      throw new Error('expected init to be routed as an operation');
    }
    expect(route.name).toBe('init');

    const result = await route.run();
    expect(result.ok).toBe(true);
    expect(handlers.initialize).toHaveBeenCalledTimes(1);
    expect(handlers.initGit).not.toHaveBeenCalled();
    expect(handlers.installHook).not.toHaveBeenCalled();
  });

  it('routes initNonEmpty separately from the empty-folder init handler', async () => {
    const handlers = createHandlers();
    const route = routeMessage({ type: 'initNonEmpty' }, handlers);

    expect(route.kind).toBe('operation');
    if (route.kind !== 'operation') {
      throw new Error('expected initNonEmpty to be routed as an operation');
    }
    expect(route.name).toBe('initNonEmpty');
    await route.run();
    expect(handlers.initializeNonEmpty).toHaveBeenCalledTimes(1);
    expect(handlers.initialize).not.toHaveBeenCalled();
  });

  it('passes only the remote url to setRemote', async () => {
    const handlers = createHandlers();
    const route = routeMessage(
      {
        type: 'setRemote',
        url: 'https://github.com/owner/repo'
      },
      handlers
    );

    expect(route.kind).toBe('operation');
    if (route.kind !== 'operation') {
      throw new Error('expected setRemote to be routed as an operation');
    }
    await route.run();
    expect(handlers.setRemote).toHaveBeenCalledWith('https://github.com/owner/repo');
  });

  it('routes createProject and treats opening a file as a silent success', async () => {
    const handlers = createHandlers();
    const route = routeMessage({ type: 'createProject' }, handlers);

    expect(route.kind).toBe('operation');
    if (route.kind !== 'operation') {
      throw new Error('expected createProject to be routed as an operation');
    }
    await route.run();
    expect(handlers.createProject).toHaveBeenCalledTimes(1);

    expect(isSilentSuccess('open')).toBe(true);
    expect(isSilentSuccess('mark')).toBe(false);
    expect(isSilentSuccess('createProject')).toBe(false);
  });

  it('routes editTags to the controller and requires a project name', async () => {
    const handlers = createHandlers();
    const route = routeMessage({ type: 'editTags', project: 'Demo' }, handlers);

    expect(route.kind).toBe('operation');
    if (route.kind !== 'operation') {
      throw new Error('expected editTags to be routed as an operation');
    }
    expect(route.name).toBe('editTags');
    await route.run();
    expect(handlers.editTags).toHaveBeenCalledWith('Demo');
    expect(routeMessage({ type: 'editTags' }, handlers).kind).toBe('unknown');
    expect(isSilentSuccess('editTags')).toBe(false);
  });

  it('routes copyUrl to the controller and treats it as a silent success', async () => {
    const handlers = createHandlers();
    const route = routeMessage({ type: 'copyUrl', project: 'My Game' }, handlers);

    expect(route.kind).toBe('operation');
    if (route.kind !== 'operation') {
      throw new Error('expected copyUrl to be routed as an operation');
    }
    expect(route.name).toBe('copyUrl');
    await route.run();
    expect(handlers.copyUrl).toHaveBeenCalledWith('My Game');
    expect(routeMessage({ type: 'copyUrl' }, handlers).kind).toBe('unknown');
    expect(isSilentSuccess('copyUrl')).toBe(true);
  });

  it('ignores unknown message types and project actions without a project name', () => {
    const handlers = createHandlers();
    expect(routeMessage({}, handlers).kind).toBe('unknown');
    expect(routeMessage({ type: 'unknown' }, handlers).kind).toBe('unknown');
    expect(routeMessage({ type: 'mark' }, handlers).kind).toBe('unknown');
    expect(routeMessage({ type: 'publish' }, handlers).kind).toBe('unknown');
  });
});
