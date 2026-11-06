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

  it('passes the remote url, branch and immutability confirmation to setRemote', async () => {
    const handlers = createHandlers();
    const route = routeMessage(
      {
        type: 'setRemote',
        url: 'https://github.com/owner/repo',
        branch: 'dev',
        immutabilityConfirmed: true
      },
      handlers
    );

    expect(route.kind).toBe('operation');
    if (route.kind !== 'operation') {
      throw new Error('expected setRemote to be routed as an operation');
    }
    await route.run();
    expect(handlers.setRemote).toHaveBeenCalledWith('https://github.com/owner/repo', true, 'dev');
  });

  it('passes an empty branch when the optional branch field is omitted', async () => {
    const handlers = createHandlers();
    const route = routeMessage(
      { type: 'setRemote', url: 'https://github.com/owner/repo' },
      handlers
    );
    if (route.kind !== 'operation') {
      throw new Error('expected setRemote to be routed as an operation');
    }
    await route.run();
    expect(handlers.setRemote).toHaveBeenCalledWith('https://github.com/owner/repo', false, '');
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

  it('ignores unknown message types and project actions without a project name', () => {
    const handlers = createHandlers();
    expect(routeMessage({}, handlers).kind).toBe('unknown');
    expect(routeMessage({ type: 'unknown' }, handlers).kind).toBe('unknown');
    expect(routeMessage({ type: 'mark' }, handlers).kind).toBe('unknown');
    expect(routeMessage({ type: 'publish' }, handlers).kind).toBe('unknown');
  });
});
