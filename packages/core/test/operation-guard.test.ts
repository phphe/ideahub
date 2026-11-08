import { describe, expect, it } from 'vitest';
import { ProjectOperationGuard } from '../src/operation-guard';

describe('ProjectOperationGuard', () => {
  it('ignores a second request for the same project while the first runs', async () => {
    const guard = new ProjectOperationGuard();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;

    const first = guard.run('MyGame', async () => {
      calls += 1;
      await gate;
      return 'first';
    });
    const second = await guard.run('MyGame', async () => {
      calls += 1;
      return 'second';
    });

    expect(second.ignored).toBe(true);
    expect(guard.isActive('MyGame')).toBe(true);
    release();
    const firstOutcome = await first;
    expect(firstOutcome.ignored).toBe(false);
    expect(firstOutcome.value).toBe('first');
    expect(calls).toBe(1);
    expect(guard.isActive('MyGame')).toBe(false);
  });

  it('allows different projects to run concurrently', async () => {
    const guard = new ProjectOperationGuard();
    const [a, b] = await Promise.all([
      guard.run('A', async () => 'a'),
      guard.run('B', async () => 'b')
    ]);
    expect(a.ignored).toBe(false);
    expect(b.ignored).toBe(false);
    expect(a.value).toBe('a');
    expect(b.value).toBe('b');
  });

  it('releases the guard after a failed task and after a duplicate', async () => {
    const guard = new ProjectOperationGuard();
    const failed = await guard.run('MyGame', async () => {
      throw new Error('boom');
    }).catch((error: unknown) => error);

    expect(failed).toBeInstanceOf(Error);
    expect(guard.isActive('MyGame')).toBe(false);

    await guard.run('MyGame', async () => 'ignored');
    const after = await guard.run('MyGame', async () => 'ok');
    expect(after.ignored).toBe(false);
    expect(after.value).toBe('ok');
  });
});
