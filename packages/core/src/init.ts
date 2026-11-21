import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import {
  configGitignorePath,
  configPath,
  describeError,
  ideahubDir,
  writeConfig
} from './config';
import { initGitRepository } from './git';
import { installPrePushHook } from './hook';
import { translate, type Translator } from './i18n';
import { commitFiles, INIT_COMMIT_MESSAGE } from './marker-commit';

/**
 * Section 8.3: the README written into the user's local idea repository is
 * fixed English and must not follow the VS Code display language (14.5).
 */
const README_CONTENT = `# Idea Repository

This repository records how your ideas take shape and keeps verifiable timestamps for the idea content.

## Structure

- \`.ideahub/config.json\`: idea repository configuration (contains no tokens).
- \`.ideahub/remote/\`: the cloned remote proof repository, not tracked by the local repository.
- Every project folder must contain an \`ideas.md\`.

## Security notes

- The local idea repository may only connect to your own **private** Git repository. Never push the local idea repository to the remote proof repository.
- The extension installs a \`pre-push\` hook that blocks accidental pushes of the local idea repository to the remote proof repository.
- Idea content is made public only through the "Publish" feature, which requires two confirmations.
- The extension never pushes or publishes local files automatically; it only creates local commits when writing a proof marker, a publish marker, or changing \`.ideahub/config.json\`.

## Creating a project

Create a folder in the repository root (for example \`MyGame\`), add an \`ideas.md\` inside it, then use the IdeaHub view in VS Code.
`;

export type InitResult =
  | { ok: true; notes: string[] }
  | { ok: false; error: string; completedSteps: string[] };

export interface InitializeOptions {
  /** Explicit user opt-in for a non-empty folder; never overwrites existing files. */
  allowNonEmpty?: boolean;
  t?: Translator;
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

export async function hasGitDirectory(root: string): Promise<boolean> {
  return exists(path.join(root, '.git'));
}

export async function hasReadmeFile(root: string): Promise<boolean> {
  return exists(path.join(root, 'README.md'));
}

export async function initializeLocalRepository(
  root: string,
  options: InitializeOptions = {}
): Promise<InitResult> {
  const t = options.t ?? translate;
  let entries;
  try {
    entries = await fs.readdir(root);
  } catch (error) {
    return {
      ok: false,
      error: t('Unable to read the current folder: {0}', describeError(error)),
      completedSteps: []
    };
  }
  if (entries.length > 0 && !options.allowNonEmpty) {
    return {
      ok: false,
      error: t(
        'The current folder is not empty. To avoid overwriting user data, initialization was stopped.'
      ),
      completedSteps: []
    };
  }

  const completed: string[] = [];
  const notes: string[] = [];
  try {
    if (await exists(path.join(root, '.git'))) {
      completed.push(t('Reused the existing Git repository'));
      notes.push(
        t(
          'Found an existing .git/ and reused it as the Git repository; git init was not run again.'
        )
      );
    } else {
      const gitResult = await initGitRepository(root);
      if (gitResult.code !== 0) {
        return {
          ok: false,
          error: t(
            'git init failed: {0}',
            gitResult.stderr.trim() || gitResult.stdout.trim()
          ),
          completedSteps: completed
        };
      }
      completed.push(t('Initialized the Git repository'));
    }

    const commitPaths: string[] = [];

    await fs.mkdir(ideahubDir(root), { recursive: true });

    if (await exists(configGitignorePath(root))) {
      completed.push(t('Reused .ideahub/.gitignore'));
    } else {
      await fs.writeFile(
        configGitignorePath(root),
        '# Ignore the cloned public remote proof repository\nremote/\n',
        'utf8'
      );
      commitPaths.push(configGitignorePath(root));
      completed.push(t('Created .ideahub/.gitignore'));
    }

    if (await exists(configPath(root))) {
      completed.push(t('Reused .ideahub/config.json'));
    } else {
      await writeConfig(root, { version: 1 });
      commitPaths.push(configPath(root));
      completed.push(t('Created .ideahub/config.json'));
    }

    const hookResult = await installPrePushHook(root, null, t);
    if (!hookResult.ok) {
      return { ok: false, error: hookResult.error, completedSteps: completed };
    }
    completed.push(t('Installed the pre-push hook'));

    if (await hasReadmeFile(root)) {
      notes.push(
        t('README.md already exists, so the existing README.md was kept (not overwritten).')
      );
      completed.push(t('Kept the existing README.md'));
    } else {
      const readmePath = path.join(root, 'README.md');
      await fs.writeFile(readmePath, README_CONTENT, 'utf8');
      commitPaths.push(readmePath);
      completed.push(t('Created README.md'));
    }

    if (commitPaths.length > 0) {
      const commit = await commitFiles({
        root,
        filePaths: commitPaths,
        message: INIT_COMMIT_MESSAGE,
        t
      });
      if (commit.status === 'committed') {
        notes.push(
          t(
            'Committed the newly created local idea repository files automatically (not pushed).'
          )
        );
      } else if (commit.status === 'failed') {
        notes.push(
          t(
            'The new local idea repository files were created, but the automatic commit failed: {0}',
            commit.reason
          )
        );
      }
    }

    return { ok: true, notes };
  } catch (error) {
    return {
      ok: false,
      error: t('Initialization failed: {0}', describeError(error)),
      completedSteps: completed
    };
  }
}

export async function ensureLocalGitRepository(
  root: string,
  t: Translator = translate
): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = await initGitRepository(root);
  if (result.code !== 0) {
    return {
      ok: false,
      error: t('git init failed: {0}', result.stderr.trim() || result.stdout.trim())
    };
  }
  return { ok: true };
}
