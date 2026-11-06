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
  let entries;
  try {
    entries = await fs.readdir(root);
  } catch (error) {
    return { ok: false, error: `无法读取当前文件夹：${describeError(error)}`, completedSteps: [] };
  }
  if (entries.length > 0 && !options.allowNonEmpty) {
    return {
      ok: false,
      error: '当前文件夹不是空文件夹，为避免覆盖用户数据，已停止初始化。',
      completedSteps: []
    };
  }

  const completed: string[] = [];
  const notes: string[] = [];
  try {
    if (await exists(path.join(root, '.git'))) {
      completed.push('复用现有 Git 仓库');
      notes.push('检测到已存在的 .git/，已按现有 Git 仓库处理，未重复执行 git init。');
    } else {
      const gitResult = await initGitRepository(root);
      if (gitResult.code !== 0) {
        return {
          ok: false,
          error: `git init 失败：${gitResult.stderr.trim() || gitResult.stdout.trim()}`,
          completedSteps: completed
        };
      }
      completed.push('初始化 Git 仓库');
    }

    await fs.mkdir(ideahubDir(root), { recursive: true });

    if (await exists(configGitignorePath(root))) {
      completed.push('复用 .ideahub/.gitignore');
    } else {
      await fs.writeFile(
        configGitignorePath(root),
        '# Ignore the cloned public idea repository\nremote/\n',
        'utf8'
      );
      completed.push('创建 .ideahub/.gitignore');
    }

    let createdConfig = false;
    if (await exists(configPath(root))) {
      completed.push('复用 .ideahub/config.json');
    } else {
      await writeConfig(root, { version: 1 });
      completed.push('创建 .ideahub/config.json');
      createdConfig = true;
    }

    const hookResult = await installPrePushHook(root, null);
    if (!hookResult.ok) {
      return { ok: false, error: hookResult.error, completedSteps: completed };
    }
    completed.push('安装 pre-push hook');

    if (await hasReadmeFile(root)) {
      notes.push('README.md 已存在，已保留现有 README.md（未覆盖）。');
      completed.push('保留现有 README.md');
    } else {
      await fs.writeFile(path.join(root, 'README.md'), README_CONTENT, 'utf8');
      completed.push('创建 README.md');
    }

    if (createdConfig) {
      const commit = await commitSingleFile({
        root,
        filePath: configPath(root),
        message: CONFIG_INIT_COMMIT_MESSAGE
      });
      if (commit.status === 'committed') {
        notes.push('已自动提交新建的 .ideahub/config.json 到本地仓库（未推送）。');
      } else if (commit.status === 'failed') {
        notes.push(`.ideahub/config.json 已创建，但自动提交失败：${commit.reason}`);
      }
    }

    return { ok: true, notes };
  } catch (error) {
    return {
      ok: false,
      error: `初始化失败：${describeError(error)}`,
      completedSteps: completed
    };
  }
}

export async function ensureLocalGitRepository(
  root: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = await initGitRepository(root);
  if (result.code !== 0) {
    return {
      ok: false,
      error: `git init 失败：${result.stderr.trim() || result.stdout.trim()}`
    };
  }
  return { ok: true };
}
