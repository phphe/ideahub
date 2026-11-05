import { execFile } from 'node:child_process';

export interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface GitOptions {
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

export class GitError extends Error {
  constructor(
    message: string,
    readonly result: GitResult
  ) {
    super(message);
    this.name = 'GitError';
  }
}

export function runGit(cwd: string, args: string[], options: GitOptions = {}): Promise<GitResult> {
  return new Promise((resolve) => {
    execFile(
      'git',
      args,
      {
        cwd,
        timeout: options.timeoutMs ?? 120_000,
        maxBuffer: 20 * 1024 * 1024,
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: '0',
          GIT_CONFIG_NOSYSTEM: '1',
          ...options.env
        }
      },
      (error, stdout, stderr) => {
        const code = error ? ((error as NodeJS.ErrnoException & { code?: number }).code ?? 1) : 0;
        resolve({
          code: typeof code === 'number' ? code : 1,
          stdout: stdout.toString(),
          stderr: stderr.toString()
        });
      }
    );
  });
}

export async function isGitRepository(cwd: string): Promise<boolean> {
  const result = await runGit(cwd, ['rev-parse', '--git-dir']);
  return result.code === 0;
}

export async function initGitRepository(cwd: string): Promise<GitResult> {
  return runGit(cwd, ['init']);
}

export async function getRemoteOriginUrl(repoPath: string): Promise<string | null> {
  const result = await runGit(repoPath, ['config', '--get', 'remote.origin.url']);
  if (result.code !== 0) {
    return null;
  }
  const value = result.stdout.trim();
  return value.length > 0 ? value : null;
}

export function redactSecrets(text: string, secrets: string[]): string {
  let result = text;
  for (const secret of secrets) {
    if (secret.length >= 6) {
      result = result.split(secret).join('[redacted]');
    }
  }
  return result;
}
