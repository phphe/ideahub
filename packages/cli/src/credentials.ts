import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';

/**
 * Section 13.6: token sources, in order.
 *   1. IDEAHUB_TOKEN / GITHUB_TOKEN / GH_TOKEN
 *   2. `gh auth token`
 *   3. credentials saved by `npx @ideahub/cli login` (mode 0600)
 *   4. anonymous
 */

const execFileAsync = promisify(execFile);

export function credentialsPath(): string {
  const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(base, 'ideahub', 'credentials.json');
}

export interface TokenResolution {
  token: string | null;
  source: string;
}

export async function resolveToken(): Promise<TokenResolution> {
  for (const key of ['IDEAHUB_TOKEN', 'GITHUB_TOKEN', 'GH_TOKEN']) {
    const value = process.env[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return { token: value.trim(), source: key };
    }
  }

  const ghToken = await readGhToken();
  if (ghToken) {
    return { token: ghToken, source: 'gh auth token' };
  }

  const stored = await readStoredToken();
  if (stored) {
    return { token: stored, source: 'ideahub credentials' };
  }

  return { token: null, source: 'anonymous' };
}

async function readGhToken(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('gh', ['auth', 'token'], {
      timeout: 3000,
      windowsHide: true
    });
    const token = stdout.trim();
    return token.length > 0 ? token : null;
  } catch {
    return null;
  }
}

export async function readStoredToken(): Promise<string | null> {
  try {
    const raw = JSON.parse(await fs.readFile(credentialsPath(), 'utf8')) as {
      token?: unknown;
    };
    return typeof raw.token === 'string' && raw.token.trim().length > 0
      ? raw.token.trim()
      : null;
  } catch {
    return null;
  }
}

/** Section 13.6: never echo the token; 0600 on POSIX, best effort on Windows. */
export async function saveToken(token: string): Promise<string> {
  const file = credentialsPath();
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await fs.writeFile(file, `${JSON.stringify({ version: 1, token }, null, 2)}\n`, {
    mode: 0o600
  });
  await fs.chmod(file, 0o600).catch(() => undefined);
  return file;
}
