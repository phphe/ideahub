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
import { hasHeadCommit, isGitRepository, getRemoteOriginUrl } from './git';
import { hasHookBlock, isHookTargetCurrent, readPrePushHook } from './hook';
import { translate, type Translator } from './i18n';
import { listProjects, IDEAS_FILE } from './projects';
import { ProjectParseCache } from './project-cache';
import { computeProofHash, parseIdeas } from './ideas';
import { parseTags } from './front-matter';
import { buildReleaseTag } from './release-target';
import { parseRemoteUrl } from './remote-url';

export type LocalIssueId = 'local-git' | 'remote-url' | 'remote-dir' | 'hook' | 'remote-mismatch';

export interface LocalIssue {
  id: LocalIssueId;
  title: string;
  message: string;
}

export interface ProjectSummary {
  name: string;
  proofCount: number;
  /** Release tags derived from the content hash of each `Proof:` marker. */
  proofTags: string[];
  publishedCount: number;
  hasNewContent: boolean;
  canPublish: boolean;
  /** Section 6.9: `tags` from the optional YAML front matter. */
  tags: string[];
  /** `ideas.md` mtime, reused for the default list ordering. */
  updatedAt?: number;
}

export function summarizeProject(name: string, text: string): ProjectSummary {
  const parsed = parseIdeas(text);

  return {
    name,
    proofCount: parsed.proofMarkers.length,
    proofTags: parsed.proofMarkers.map((marker) =>
      buildReleaseTag(computeProofHash(name, marker.hashContent)).tag
    ),
    publishedCount: parsed.publishedMarkers.length,
    hasNewContent: parsed.hasUnsealedContent,
    canPublish: parsed.canPublish,
    tags: parseTags(text)
  };
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

export async function detectWorkspace(
  folder: string | null,
  projectCache?: ProjectParseCache,
  t: Translator = translate
): Promise<WorkspaceState> {
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
    return { kind: 'error', message: t('Unable to read the folder: {0}', describeError(error)) };
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
    return {
      kind: 'error',
      message: t('Unable to access .ideahub: {0}', describeError(error))
    };
  }
  if (!ideahubStat.isDirectory()) {
    return { kind: 'not-ideahub', root: folder };
  }

  const issues: LocalIssue[] = [];

  const gitOk = await isGitRepository(folder);
  if (!gitOk) {
    issues.push({
      id: 'local-git',
      title: t('The workspace root is not a Git repository'),
      message: t(
        'Missing .git/. You can initialize a Git repository with the button below (it will not commit or push).'
      )
    });
  }

  let remote: RemoteConfig | null = null;
  let configError: string | null = null;
  const configResult = await readConfig(folder, t);
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
      title: t('Missing remote repository URL'),
      message:
        configError ??
        t(
          'Enter the URL of the public idea repository you created manually on GitHub (the extension never creates repositories).'
        )
    });
  }

  let remoteDirOk = false;
  let remoteDirExists = false;
  let remoteGitOk = false;
  if (remote) {
    const remotePath = remoteRepoPath(folder);
    try {
      const stat = await fs.stat(remotePath);
      remoteDirExists = stat.isDirectory();
      if (remoteDirExists && (await isGitRepository(remotePath))) {
        remoteGitOk = true;
        remoteDirOk = await hasHeadCommit(remotePath);
      }
    } catch {
      remoteDirExists = false;
      remoteDirOk = false;
      remoteGitOk = false;
    }
    if (!remoteDirOk) {
      issues.push({
        id: 'remote-dir',
        title: remoteGitOk
          ? t('The remote repository clone is incomplete')
          : t('Missing remote repository clone'),
        message: remoteGitOk
          ? t(
              'The inner repository has no usable HEAD (it may be an empty clone or the clone did not finish). Use "Re-clone" to fetch the remote idea repository again.'
            )
          : t(
              'Missing .ideahub/remote/ or it is not a valid Git repository. Use the button below to clone.'
            )
      });
    } else {
      const origin = await getRemoteOriginUrl(remoteRepoPath(folder));
      const parsedOrigin = origin ? parseRemoteUrl(origin, t) : null;
      const matches =
        parsedOrigin?.ok &&
        parsedOrigin.value.owner.toLowerCase() === remote.owner.toLowerCase() &&
        parsedOrigin.value.repo.toLowerCase() === remote.repo.toLowerCase();
      if (!matches) {
        issues.push({
          id: 'remote-mismatch',
          title: t('The remote clone does not match the configuration'),
          message: t(
            'The repository that .ideahub/remote/ points to does not match the remote URL in config.json. Re-clone first to avoid publishing to the wrong repository.'
          )
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
        title: t('Unable to read the pre-push hook'),
        message: describeError(error)
      });
    }
    if (hookContent === null) {
      issues.push({
        id: 'hook',
        title: t('Missing the git pre-push hook that prevents accidental pushes'),
        message: t(
          'Use the button below to install the hook; it only adds or replaces the block managed by IdeaHub.'
        )
      });
    } else if (!hasHookBlock(hookContent)) {
      issues.push({
        id: 'hook',
        title: t('Missing the git pre-push hook that prevents accidental pushes'),
        message: t(
          'Use the button below to install the hook; custom logic outside the managed block is preserved.'
        )
      });
    } else if (!isHookTargetCurrent(hookContent, remote)) {
      issues.push({
        id: 'hook',
        title: t('The pre-push hook target is out of date'),
        message: t(
          'The remote URL changed; update the block managed by IdeaHub in the hook.'
        )
      });
    }
  }

  const summarize = async (name: string): Promise<ProjectSummary> => {
    const file = path.join(folder, name, IDEAS_FILE);
    if (projectCache) {
      return projectCache.summarize(folder, name);
    }
    const stats = await fs.stat(file);
    const text = await fs.readFile(file, 'utf8');
    return { ...summarizeProject(name, text), updatedAt: stats.mtimeMs };
  };

  let projects: ProjectSummary[] = [];
  try {
    const names = await listProjects(folder);
    projects = await Promise.all(
      names.map(async (name) => {
        try {
          return await summarize(name);
        } catch {
          return {
            name,
            proofCount: 0,
            proofTags: [],
            publishedCount: 0,
            hasNewContent: false,
            canPublish: false,
            tags: []
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
