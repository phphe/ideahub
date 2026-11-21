import { createInterface } from 'node:readline/promises';
import { OAUTH_CLIENT_ID } from '@ideahub/core';
import { CliGitHub } from './api';
import { saveToken } from './credentials';

/**
 * Section 13.6: `npx @ideahub/cli login`.
 * Device flow when a client id was injected at build time, otherwise a manual
 * token paste (or `--token`). The token is never printed.
 */

const DEVICE_CODE_URL = 'https://github.com/login/device/code';
const ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token';

interface DeviceCodeResponse {
  device_code?: string;
  user_code?: string;
  verification_uri?: string;
  expires_in?: number;
  interval?: number;
  error?: string;
  error_description?: string;
}

export interface LoginResult {
  code: number;
  messages: string[];
}

export async function runLogin(
  args: string[],
  fetchImpl: typeof fetch = fetch,
  report: (message: string) => void = () => undefined,
  clientIdValue: string = OAUTH_CLIENT_ID
): Promise<LoginResult> {
  const explicit = readTokenArgument(args);
  if (explicit !== undefined) {
    return finishLogin(explicit, fetchImpl);
  }

  const clientId = clientIdValue.trim();
  if (clientId.length > 0) {
    return deviceFlowLogin(clientId, fetchImpl, report);
  }

  if (!process.stdin.isTTY) {
    return {
      code: 2,
      messages: [
        'No OAuth client id is configured and stdin is not an interactive terminal. Use `npx @ideahub/cli login --token <token>`.'
      ]
    };
  }

  const readline = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await readline.question('Paste a GitHub Personal Access Token: ');
    const token = answer.trim();
    if (token.length === 0) {
      return { code: 2, messages: ['No token was entered.'] };
    }
    return finishLogin(token, fetchImpl);
  } finally {
    readline.close();
  }
}

function readTokenArgument(args: string[]): string | undefined {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--token') {
      return args[index + 1]?.trim();
    }
    if (arg.startsWith('--token=')) {
      return arg.slice('--token='.length).trim();
    }
  }
  return undefined;
}

async function finishLogin(token: string, fetchImpl: typeof fetch): Promise<LoginResult> {
  if (!token) {
    return { code: 2, messages: ['The token is empty.'] };
  }
  try {
    const login = await new CliGitHub(token, fetchImpl).getAuthenticatedLogin();
    const file = await saveToken(token);
    return {
      code: 0,
      messages: [
        `Logged in to GitHub as ${login}.`,
        `Credentials saved to ${file} (mode 0600, contents never echoed).`
      ]
    };
  } catch (error) {
    return {
      code: 2,
      messages: [`Login failed: ${error instanceof Error ? error.message : String(error)}`]
    };
  }
}

async function deviceFlowLogin(
  clientId: string,
  fetchImpl: typeof fetch,
  report: (message: string) => void
): Promise<LoginResult> {
  // Live output: the flow waits for the user in a browser, so instructions and
  // progress must be printed before/while polling instead of after it returns.
  report('Requesting a GitHub device code…');
  let start: DeviceCodeResponse;
  try {
    start = await postForm<DeviceCodeResponse>(
      DEVICE_CODE_URL,
      { client_id: clientId, scope: 'read:user' },
      fetchImpl
    );
  } catch (error) {
    return {
      code: 2,
      messages: [`Could not start the device flow: ${describeNetworkError(error)}`]
    };
  }

  if (!start.device_code || !start.user_code || !start.verification_uri) {
    return {
      code: 2,
      messages: [`Could not start the device flow: ${start.error_description ?? start.error ?? 'response is missing fields'}`]
    };
  }

  report(
    `Open ${start.verification_uri} in a browser and enter the code ${start.user_code} to authorize.`
  );
  report('Waiting for authorization… (press Ctrl+C to cancel)');
  const intervalMs = Math.max(1, start.interval ?? 5) * 1000;
  const deadline = Date.now() + Math.max(60, start.expires_in ?? 900) * 1000;

  while (Date.now() < deadline) {
    await sleep(intervalMs);
    let poll: DeviceCodeResponse;
    try {
      poll = await postForm<DeviceCodeResponse>(
        ACCESS_TOKEN_URL,
        {
          client_id: clientId,
          device_code: start.device_code,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
        },
        fetchImpl
      );
    } catch (error) {
      return {
        code: 2,
        messages: [`Failed to poll the authorization status: ${describeNetworkError(error)}`]
      };
    }

    if (poll.error === 'authorization_pending') {
      continue;
    }
    if (poll.error === 'slow_down') {
      await sleep(intervalMs);
      continue;
    }
    if (poll.error) {
      return { code: 2, messages: [`Authorization failed: ${poll.error_description ?? poll.error}`] };
    }

    const token = (poll as DeviceCodeResponse & { access_token?: string }).access_token;
    if (token) {
      return finishLogin(token, fetchImpl);
    }
    break;
  }

  return { code: 2, messages: ['Authorization timed out; run `npx @ideahub/cli login` again.'] };
}

/** Section 13.6: never leave the user staring at a silent terminal. */
function describeNetworkError(error: unknown): string {
  if (
    error instanceof Error &&
    (error.name === 'TimeoutError' || error.name === 'AbortError')
  ) {
    return 'The request to GitHub timed out after 15 seconds. If github.com is unreachable from this network, use `npx @ideahub/cli login --token <token>` instead.';
  }
  return error instanceof Error ? error.message : String(error);
}

async function postForm<T>(
  url: string,
  fields: Record<string, string>,
  fetchImpl: typeof fetch
): Promise<T> {
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'ideahub-cli'
    },
    body: new URLSearchParams(fields).toString(),
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
