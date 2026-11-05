import * as vscode from 'vscode';

/**
 * Uses VS Code's built-in GitHub authentication. Tokens are never written to
 * config files, logs, or the repository.
 */
export async function getGitHubToken(interactive: boolean): Promise<string | null> {
  try {
    const session = await vscode.authentication.getSession('github', ['repo'], {
      createIfNone: interactive,
      silent: !interactive
    });
    return session?.accessToken ?? null;
  } catch {
    return null;
  }
}
