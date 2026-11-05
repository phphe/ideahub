import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import {
  describeError,
  ideahubDir,
  isNotFound,
  readConfig,
  remoteRepoPath,
  type RemoteConfig
} from './config';
import { isGitRepository, getRemoteOriginUrl } from './git';
import { hasHookBlock, isHookTargetCurrent, readPrePushHook } from './hook';
import { listProjects, IDEAS_FILE } from './projects';
import { parseIdeas } from './ideas';
import { parseRemoteUrl } from './remote-url';

export type LocalIssueId = 'local-git' | 'remote-url' | 'remote-dir' | 'hook' | 'remote-mismatch';

export interface LocalIssue {
  id: LocalIssueId;
  title: string;
  message: string;
}

export interface ProjectSummary {
  name: string;
  markerCount: number;
  markerIds: string[];
  /** Newest `date=YYYY-MM-DD` across markers, or null when none is present. */
  latestMarkerDate: string | null;
  integrityOk: boolean;
  hasNewContent: boolean;
}

export interface ProjectRemoteStatus {
  published: boolean;
  latestProofAt: string | null;
}

export interface RemoteStatus {
  available: boolean;
  error?: string;
  projects: Record<string, ProjectRemoteStatus>;
}

export type WorkspaceState =
  | { kind: 'no-folder' }
  | { kind: 'empty-folder'; root: string }
  | { kind: 'not-ideahub'; root: string }
  | { kind: 'error'; message: string }
  | {
      kind: 'local';
      root: string;
      remote: RemoteConfig | null;
      configError: string | null;
      remoteDirExists: boolean;
      issues: LocalIssue[];
      projects: ProjectSummary[];
      remoteStatus?: RemoteStatus;
    };

export async function detectWorkspace(folder: string | null): Promise<WorkspaceState> {
  if (!folder) {
    return { kind: 'no-folder' };
  }

  let entries;
  try {
    entries = await fs.readdir(folder, { withFileTypes: true });
  } catch (error) {
    if (isNotFound(error)) {
      return { kind: 'no-folder' };
    }
    return { kind: 'error', message: `无法读取文件夹：${describeError(error)}` };
  }

  if (entries.length === 0) {
    return { kind: 'empty-folder', root: folder };
  }

  let ideahubStat;
  try {
    ideahubStat = await fs.stat(ideahubDir(folder));
  } catch (error) {
    if (isNotFound(error)) {
      return { kind: 'not-ideahub', root: folder };
    }
    return { kind: 'error', message: `无法访问 .ideahub：${describeError(error)}` };
  }
  if (!ideahubStat.isDirectory()) {
    return { kind: 'not-ideahub', root: folder };
  }

  const issues: LocalIssue[] = [];

  const gitOk = await isGitRepository(folder);
  if (!gitOk) {
    issues.push({
      id: 'local-git',
      title: '本地根目录不是 Git 仓库',
      message: '缺少 .git/。可以点击下方按钮初始化 Git 仓库（不会提交或推送）。'
    });
  }

  let remote: RemoteConfig | null = null;
  let configError: string | null = null;
  const configResult = await readConfig(folder);
  if (!configResult.ok) {
    configError = configResult.error;
  } else if (!configResult.config.remote) {
    configError = null;
  } else {
    remote = configResult.config.remote;
  }

  if (configError || !remote) {
    issues.push({
      id: 'remote-url',
      title: '缺少远程仓库地址',
      message:
        configError ??
        '请填写你在 GitHub 上手动创建好的公开创意仓库地址（扩展不会自动创建仓库）。'
    });
  }

  let remoteDirOk = false;
  let remoteDirExists = false;
  if (remote) {
    const remotePath = remoteRepoPath(folder);
    try {
      const stat = await fs.stat(remotePath);
      remoteDirExists = stat.isDirectory();
      if (remoteDirExists && (await isGitRepository(remotePath))) {
        remoteDirOk = true;
      }
    } catch {
      remoteDirExists = false;
      remoteDirOk = false;
    }
    if (!remoteDirOk) {
      issues.push({
        id: 'remote-dir',
        title: '缺少远程仓库克隆',
        message: '缺少 .ideahub/remote/ 或它不是有效的 Git 仓库。可以点击下方按钮执行克隆。'
      });
    } else {
      const origin = await getRemoteOriginUrl(remoteRepoPath(folder));
      const parsedOrigin = origin ? parseRemoteUrl(origin) : null;
      const matches =
        parsedOrigin?.ok &&
        parsedOrigin.value.owner.toLowerCase() === remote.owner.toLowerCase() &&
        parsedOrigin.value.repo.toLowerCase() === remote.repo.toLowerCase();
      if (!matches) {
        issues.push({
          id: 'remote-mismatch',
          title: '远程克隆与配置不一致',
          message:
            '当前 .ideahub/remote/ 指向的仓库与 config.json 中的远程地址不一致。请先重新克隆，避免发布到错误的仓库。'
        });
      }
    }
  }

  if (gitOk) {
    let hookContent: string | null = null;
    try {
      hookContent = await readPrePushHook(folder);
    } catch (error) {
      issues.push({
        id: 'hook',
        title: '无法读取 pre-push hook',
        message: describeError(error)
      });
    }
    if (hookContent === null) {
      issues.push({
        id: 'hook',
        title: '缺少防止误提交的 git pre-push hook',
        message: '点击下方按钮安装 hook；只会新增或替换由创意仓库管理的标记块。'
      });
    } else if (!hasHookBlock(hookContent)) {
      issues.push({
        id: 'hook',
        title: '缺少防止误提交的 git pre-push hook',
        message: '点击下方按钮安装 hook；不会覆盖你在标记块之外的自定义逻辑。'
      });
    } else if (!isHookTargetCurrent(hookContent, remote)) {
      issues.push({
        id: 'hook',
        title: 'pre-push hook 的拦截目标已过期',
        message: '远程地址已变化，需要更新 hook 中由创意仓库管理的标记块。'
      });
    }
  }

  let projects: ProjectSummary[] = [];
  try {
    const names = await listProjects(folder);
    projects = await Promise.all(
      names.map(async (name) => {
        try {
          const text = await fs.readFile(path.join(folder, name, IDEAS_FILE), 'utf8');
          const parsed = parseIdeas(text, name);
          const dates = parsed.markers
            .map((marker) => marker.date)
            .filter((date): date is string => date !== null);
          return {
            name,
            markerCount: parsed.markers.length,
            markerIds: parsed.markers.map((marker) => marker.id),
            latestMarkerDate: dates.length > 0 ? dates.reduce((a, b) => (a > b ? a : b)) : null,
            integrityOk: parsed.integrityOk,
            hasNewContent: parsed.hasUnsealedContent
          };
        } catch {
          return {
            name,
            markerCount: 0,
            markerIds: [],
            latestMarkerDate: null,
            integrityOk: false,
            hasNewContent: false
          };
        }
      })
    );
  } catch {
    projects = [];
  }

  return {
    kind: 'local',
    root: folder,
    remote,
    configError,
    remoteDirExists,
    issues,
    projects
  };
}
