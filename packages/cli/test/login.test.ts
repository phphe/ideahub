import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runLogin } from '../src/login';

const CLIENT_ID = 'Iv1.testclient';

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
}

describe('runLogin device flow', () => {
  let configHome: string;
  let previousConfigHome: string | undefined;

  beforeEach(async () => {
    configHome = await fs.mkdtemp(path.join(os.tmpdir(), 'ideahub-login-'));
    previousConfigHome = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = configHome;
  });

  afterEach(async () => {
    if (previousConfigHome === undefined) {
      delete process.env.XDG_CONFIG_HOME;
    } else {
      process.env.XDG_CONFIG_HOME = previousConfigHome;
    }
    await fs.rm(configHome, { recursive: true, force: true });
  });

  it('prints the verification instructions before polling and finishes', async () => {
    let polls = 0;
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/login/device/code')) {
        return json({
          device_code: 'device-1',
          user_code: 'ABCD-1234',
          verification_uri: 'https://github.com/login/device',
          expires_in: 900,
          interval: 1
        });
      }
      if (url.endsWith('/login/oauth/access_token')) {
        polls += 1;
        return polls < 2
          ? json({ error: 'authorization_pending' })
          : json({ access_token: 'token-1' });
      }
      if (url.endsWith('/user')) {
        return json({ login: 'octocat' });
      }
      return json({ message: 'unexpected' });
    }) as unknown as typeof fetch;

    const reported: string[] = [];
    const result = await runLogin([], fetchImpl, (message) => reported.push(message), CLIENT_ID);

    expect(result.code).toBe(0);
    expect(reported[0]).toContain('正在向 GitHub 申请设备授权码');
    expect(reported[1]).toContain('ABCD-1234');
    expect(reported[1]).toContain('https://github.com/login/device');
    expect(reported[2]).toContain('等待授权中');
    expect(result.messages.join('\n')).toContain('octocat');

    const credentials = JSON.parse(
      await fs.readFile(path.join(configHome, 'ideahub', 'credentials.json'), 'utf8')
    ) as { token?: string };
    expect(credentials.token).toBe('token-1');
  });

  it('reports a failed device code request instead of hanging', async () => {
    const fetchImpl = (async () => {
      throw Object.assign(new Error('The operation was aborted'), { name: 'TimeoutError' });
    }) as unknown as typeof fetch;

    const reported: string[] = [];
    const result = await runLogin([], fetchImpl, (message) => reported.push(message), CLIENT_ID);

    expect(result.code).toBe(2);
    expect(reported[0]).toContain('正在向 GitHub 申请设备授权码');
    expect(result.messages.join('\n')).toContain('超时');
    expect(result.messages.join('\n')).toContain('--token');
  });
});
