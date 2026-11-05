import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { configGitignorePath, describeError, ideahubDir, writeConfig } from './config';
import { initGitRepository } from './git';
import { installPrePushHook } from './hook';

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
- 扩展不会自动提交、推送或公开任何本地文件。

## 如何创建项目

在仓库根目录新建一个文件夹（例如 \`MyGame\`），在其中创建 \`ideas.md\`，然后回到 VS Code 的创意仓库界面操作。
`;

export type InitResult =
  | { ok: true }
  | { ok: false; error: string; completedSteps: string[] };

export async function initializeLocalRepository(root: string): Promise<InitResult> {
  let entries;
  try {
    entries = await fs.readdir(root);
  } catch (error) {
    return { ok: false, error: `无法读取当前文件夹：${describeError(error)}`, completedSteps: [] };
  }
  if (entries.length > 0) {
    return {
      ok: false,
      error: '当前文件夹不是空文件夹，为避免覆盖用户数据，已停止初始化。',
      completedSteps: []
    };
  }

  const completed: string[] = [];
  try {
    const gitResult = await initGitRepository(root);
    if (gitResult.code !== 0) {
      return {
        ok: false,
        error: `git init 失败：${gitResult.stderr.trim() || gitResult.stdout.trim()}`,
        completedSteps: completed
      };
    }
    completed.push('初始化 Git 仓库');

    await fs.mkdir(ideahubDir(root), { recursive: true });
    await fs.writeFile(
      configGitignorePath(root),
      '# Ignore the cloned public idea repository\nremote/\n',
      'utf8'
    );
    completed.push('创建 .ideahub/.gitignore');

    await writeConfig(root, { version: 1 });
    completed.push('创建 .ideahub/config.json');

    const hookResult = await installPrePushHook(root, null);
    if (!hookResult.ok) {
      return { ok: false, error: hookResult.error, completedSteps: completed };
    }
    completed.push('安装 pre-push hook');

    await fs.writeFile(path.join(root, 'README.md'), README_CONTENT, 'utf8');
    completed.push('创建 README.md');

    return { ok: true };
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
