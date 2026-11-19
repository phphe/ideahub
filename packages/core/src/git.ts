import { execFile } from 'node:child_process';

export interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
  /** True when the `git` executable itself could not be found. */
  missing?: boolean;
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
        const errno = error as NodeJS.ErrnoException | null;
        const missing = errno?.code === 'ENOENT';
        const code = error ? (typeof errno?.code === 'number' ? errno.code : 1) : 0;
        resolve({
          code,
          stdout: stdout.toString(),
          stderr: stderr.toString(),
          missing
        });
      }
    );
  });
}

export async function isGitRepository(cwd: string): Promise<boolean> {
  const result = await runGit(cwd, ['rev-parse', '--git-dir']);
  return result.code === 0;
}

/**
 * A repository can exist (`.git` present) yet have an unborn HEAD, for
 * example after cloning an empty remote or an interrupted clone. Publishing
 * needs a real commit, so callers must verify HEAD separately.
 */
export async function hasHeadCommit(cwd: string): Promise<boolean> {
  const result = await runGit(cwd, ['rev-parse', '--verify', 'HEAD']);
  return result.code === 0 && result.stdout.trim().length > 0;
}

export async function initGitRepository(cwd: string): Promise<GitResult> {
  return runGit(cwd, ['init']);
}

/**
 * Section 8.5: `.ideahub/remote` is cloned with `--depth 1`. Before the first
 * push (publish) the missing history must be completed, otherwise a remote
 * that lacks the shallow ancestors rejects the push with
 * `shallow update not allowed`.
 */
export async function isShallowRepository(cwd: string): Promise<boolean> {
  const result = await runGit(cwd, ['rev-parse', '--is-shallow-repository']);
  return result.code === 0 && result.stdout.trim() === 'true';
}

export async function unshallowRepository(cwd: string): Promise<GitResult> {
  return runGit(cwd, ['fetch', '--unshallow', 'origin'], { timeoutMs: 300_000 });
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
