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
import { commitSingleFile, CONFIG_INIT_COMMIT_MESSAGE } from './marker-commit';

const README_CONTENT = `# 创意仓库

这个仓库用于记录自己的创意形成过程，并为创意内容保存可验证的时间证明。

## 目录结构

- \`.ideahub/config.json\`：创意仓库配置（不含任何 Token）。
- \`.ideahub/remote/\`：远程创意仓库的克隆，本地仓库不跟踪该目录。
- 每个项目文件夹必须包含 \`ideas.md\`。

## 安全注意事项

- 本地仓库只能连接你自己的**私有** Git 仓库，**不能**把本地仓库直接推送到远程创意仓库。
- 扩展会安装 \`pre-push\` hook，阻止误把本地仓库推送到远程创意仓库。
- 创意内容只能通过“发布”功能公开，发布前需要两次确认。
- 扩展不会自动推送或公开任何本地文件；仅在写入证明标记、发布标记或修改 \`.ideahub/config.json\` 时自动提交到本地仓库。

## 如何创建项目

在仓库根目录新建一个文件夹（例如 \`MyGame\`），在其中创建 \`ideas.md\`，然后回到 VS Code 的创意仓库界面操作。
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

    await fs.mkdir(ideahubDir(root), { recursive: true });

    if (await exists(configGitignorePath(root))) {
      completed.push(t('Reused .ideahub/.gitignore'));
    } else {
      await fs.writeFile(
        configGitignorePath(root),
        '# Ignore the cloned public remote proof repository\nremote/\n',
        'utf8'
      );
      completed.push(t('Created .ideahub/.gitignore'));
    }

    let createdConfig = false;
    if (await exists(configPath(root))) {
      completed.push(t('Reused .ideahub/config.json'));
    } else {
      await writeConfig(root, { version: 1 });
      completed.push(t('Created .ideahub/config.json'));
      createdConfig = true;
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
      await fs.writeFile(path.join(root, 'README.md'), README_CONTENT, 'utf8');
      completed.push(t('Created README.md'));
    }

    if (createdConfig) {
      const commit = await commitSingleFile({
        root,
        filePath: configPath(root),
        message: CONFIG_INIT_COMMIT_MESSAGE,
        t
      });
      if (commit.status === 'committed') {
        notes.push(
          t(
            'Committed the new .ideahub/config.json to the local idea repository automatically (not pushed).'
          )
        );
      } else if (commit.status === 'failed') {
        notes.push(
          t(
            '.ideahub/config.json was created, but the automatic commit failed: {0}',
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
