import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  detectWorkspace,
  summarizeProject,
  translate,
  type ProjectSummary,
  type ProjectRemoteStatus,
  type RemoteStatus,
  type Translator,
  type WorkspaceState
} from '@ideahub/core';
import {
  hasGitDirectory,
  hasReadmeFile,
  initializeLocalRepository,
  ensureLocalGitRepository
} from '@ideahub/core';
import { installPrePushHook } from '@ideahub/core';
import { configPath, remoteRepoPath, writeConfig } from '@ideahub/core';
import { GitHubApiError, GitHubClient } from '@ideahub/core';
import { RELEASE_COMMIT } from '@ideahub/core';
import {
  buildReleaseTag,
  resolveReleaseTarget,
  validateTagName
} from '@ideahub/core';
import { validateRemoteRepository } from '@ideahub/core';
import { parseRemoteUrl } from '@ideahub/core';
import type { RemoteSettingsDisplay, RemoteSettingsInfo } from './html';
import { cloneRemoteRepository, inspectRemoteTarget, removeLocalClone } from '@ideahub/core';
import {
  runRemoteSetupFlow,
  type RemoteSetupFlowResult,
  type RemoteSetupStep
} from '@ideahub/core';
import {
  appendMarkerLine,
  formatMarkerLine,
  parseIdeas
} from '@ideahub/core';
import { parseTagInput, parseTags, updateTags } from '@ideahub/core';
import { buildFingerprint } from '@ideahub/core';
import {
  extractProofBlocks,
  renderProofFile,
  type ProofFileBlock
} from '@ideahub/core';
import {
  describeMissingProofReleases,
  findMissingProofReleases,
  type ProofCheckTarget
} from '@ideahub/core';
import { ProjectOperationGuard } from '@ideahub/core';
import { ProjectParseCache } from '@ideahub/core';
import {
  commitMarkerLine,
  commitSingleFile,
  CONFIG_REMOTE_COMMIT_MESSAGE,
  DEFAULT_PROOF_COMMIT_MESSAGE,
  DEFAULT_PUBLISH_COMMIT_MESSAGE,
  resolveCommitMessage,
  type MarkerCommitResult
} from '@ideahub/core';
import { formatMarkerTime } from '@ideahub/core';
import { createProject as createProjectOnDisk, validateProjectName } from '@ideahub/core';
import {
  checkInnerRepositoryHead,
  commitAndPushInnerRepository,
  copyProjectIntoInnerRepository,
  readInnerRepositoryHead,
  remoteProjectUrl,
  checkProjectReadme,
  restoreInnerRepository,
  scanProjectDirectory,
  syncInnerRepository
} from '@ideahub/core';
import { getGitHubToken } from './auth';

export interface OpResult {
  ok: boolean;
  message: string;
  /** Duplicate requests are ignored without notice or refresh. */
  silent?: boolean;
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.lstat(target);
    return true;
  } catch {
    return false;
  }
}

function remoteSetupStepMessage(step: RemoteSetupStep, t: Translator): string {
  switch (step) {
    case 'validate':
      return t('Step 1/2: validating the remote proof repository…');
    case 'persist':
      return t('Step 1/2: validation passed, saving configuration and hook…');
    case 'clone':
      return t('Step 2/2: cloning the remote proof repository…');
  }
}

function withDisplay(
  info: Omit<RemoteSettingsInfo, 'display'>,
  t: Translator
): RemoteSettingsInfo {
  const display: RemoteSettingsDisplay = {
    url: info.url || t('Not configured'),
    ownerRepo:
      info.owner && info.repo ? `${info.owner}/${info.repo}` : t('Not configured'),
    host: info.host ?? t('Unknown'),
    branch: info.branch ?? t('Unknown')
  };
  return { ...info, display };
}

function formatRemoteSetupResult(
  result: RemoteSetupFlowResult,
  t: Translator
): OpResult {
  if (result.ok) {
    const target = `${result.remote.owner}/${result.remote.repo}`;
    const cloneStep =
      result.clone === 'cloned'
        ? t(
            'Step 2/2: the remote proof repository was cloned (branch {0}).',
            result.branch
          )
        : t(
            'Step 2/2: .ideahub/remote/ is already a valid Git repository, so cloning was skipped; if it does not match the new URL, use "Re-clone".'
          );
    return {
      ok: true,
      message: t(
        'Step 1/2: remote URL validation passed; configuration and hook saved.\n{0}\nRemote proof repository: {1} (branch {2})',
        cloneStep,
        target,
        result.branch
      )
    };
  }

  const stageLabels = {
    validation: t('Step 1/2 (validation)'),
    config: t('Step 1/2 (save configuration)'),
    clone: t('Step 2/2 (clone)')
  } as const;
  const retry = result.retryClone
    ? t(
        '\nThe clone entry is still available; click "Clone remote proof repository" to retry. To start over, use "Re-clone".'
      )
    : '';
  return {
    ok: false,
    message: `${stageLabels[result.stage]}${t(' failed: {0}{1}', result.message, retry)}`
  };
}

export class IdeahubController {
  public currentState: WorkspaceState = { kind: 'no-folder' };
  private readonly operationGuard = new ProjectOperationGuard();
  /** Last fully resolved settings snapshot, reused for instant rendering. */
  private remoteSettingsCache: RemoteSettingsInfo | null = null;
  /** Language of `remoteSettingsCache`; a language change discards translated text. */
  private remoteSettingsLanguage: string | null = null;
  /** Section 8.7: parsed `ideas.md` summaries, scoped to the current repo root. */
  private projectCache: ProjectParseCache | null = null;
  private projectCacheRoot: string | null = null;

  constructor(
    private readonly output: vscode.OutputChannel,
    private readonly t: Translator = translate
  ) {}

  private log(message: string): void {
    this.output.appendLine(`[${new Date().toISOString()}] ${message}`);
  }

  public workspaceRoot(): string | null {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null;
  }

  /**
   * Parsing cache is bound to the current repository root, so switching
   * workspaces never reuses summaries keyed to another root.
   */
  private cacheFor(root: string): ProjectParseCache {
    if (!this.projectCache || this.projectCacheRoot !== root) {
      this.projectCache = new ProjectParseCache(summarizeProject);
      this.projectCacheRoot = root;
    }
    return this.projectCache;
  }

  /** Section 8.7: watcher change/delete drops the cached summary. */
  public invalidateProject(project: string): void {
    const root = this.workspaceRoot();
    if (root) {
      this.cacheFor(root).invalidate(root, project);
    }
  }

  public async refresh(): Promise<WorkspaceState> {
    const root = this.workspaceRoot();
    const cache = root ? this.cacheFor(root) : undefined;
    const language = vscode.env.language;
    if (
      this.remoteSettingsLanguage !== null &&
      this.remoteSettingsLanguage !== language
    ) {
      this.remoteSettingsCache = null;
      this.remoteSettingsLanguage = null;
    }
    const state = await detectWorkspace(root, cache, this.t);
    if (state.kind === 'local' && state.remote) {
      state.remoteStatus = await this.loadRemoteStatus(state);
    }
    this.currentState = state;
    return state;
  }

  private githubClient(token: string | null): GitHubClient {
    return new GitHubClient(async () => token, fetch, this.t);
  }

  /**
   * Recomputes the badges of a single project after its ideas.md changed on
   * disk, without rescanning the whole workspace. Returns null when the project
   * is not part of the current state (the list structure must be refreshed).
   */
  public async summarizeProjectByName(name: string): Promise<ProjectSummary | null> {
    const state = this.currentState;
    if (state.kind !== 'local') {
      return null;
    }
    const index = state.projects.findIndex((project) => project.name === name);
    if (index < 0) {
      return null;
    }
    try {
      const summary = await this.cacheFor(state.root).summarize(state.root, name);
      state.projects[index] = summary;
      return summary;
    } catch {
      return null;
    }
  }

  private async loadRemoteStatus(
    state: Extract<WorkspaceState, { kind: 'local' }>
  ): Promise<RemoteStatus> {
    if (!state.remote) {
      return { available: false, projects: {} };
    }
    const remote = state.remote;
    const token = await getGitHubToken(false);
    const client = this.githubClient(token);

    try {
      const releases = await client.listReleases(remote.owner, remote.repo);
      const byTag = new Map(
        releases.filter((release) => release.tagName).map((release) => [release.tagName, release])
      );
      const projects: Record<string, ProjectRemoteStatus> = {};

      await Promise.all(
        state.projects.map(async (project) => {
          let latestProofAt: string | null = null;
          for (const tagName of project.proofTags) {
            const release = byTag.get(tagName);
            if (release?.publishedAt && (!latestProofAt || release.publishedAt > latestProofAt)) {
              latestProofAt = release.publishedAt;
            }
          }
          let published = false;
          try {
            published = await client.hasContent(remote.owner, remote.repo, project.name);
          } catch {
            published = false;
          }
          projects[project.name] = { published, latestProofAt };
        })
      );

      return { available: true, projects };
    } catch (error) {
      return {
        available: false,
        error: error instanceof Error ? error.message : String(error),
        projects: {}
      };
    }
  }

  private requireLocalRoot(): string | null {
    return this.currentState.kind === 'local' ? this.currentState.root : null;
  }

  public async initialize(allowNonEmpty = false): Promise<OpResult> {
    const state = this.currentState;
    if (allowNonEmpty) {
      if (state.kind !== 'not-ideahub') {
        return {
          ok: false,
          message: this.t('Initialization is not allowed in the current state.')
        };
      }
      const hasGit = await hasGitDirectory(state.root);
      const hasReadme = await hasReadmeFile(state.root);
      const readmeLine = hasReadme
        ? this.t('README.md already exists, so the existing README.md will be kept.')
        : this.t('README.md will be created.');
      const common = this.t(
        'Existing .ideahub/ content will be reused; {0} No existing files will be overwritten, and nothing will be pushed or published automatically; only the newly created .ideahub/config.json, .ideahub/.gitignore and README.md will be committed to the local idea repository.\nInitialize the local idea repository in this folder anyway?',
        readmeLine
      );
      const confirmation = hasGit
        ? this.t(
            'Detected an existing .git/; initialization will reuse it and will not reinitialize or overwrite it.\n{0}',
            common
          )
        : this.t('A .git/ will be created in this folder, along with .ideahub/.\n{0}', common);
      const confirm = this.t('Initialize anyway');
      const choice = await vscode.window.showWarningMessage(
        confirmation,
        { modal: true },
        confirm
      );
      if (choice !== confirm) {
        return { ok: false, message: '', silent: true };
      }
    } else if (state.kind !== 'empty-folder') {
      return {
        ok: false,
        message: this.t('Initialization is not allowed in the current state.')
      };
    }
    const result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: this.t('Initializing the local idea repository…')
      },
      () => initializeLocalRepository(state.root, { allowNonEmpty, t: this.t })
    );
    if (result.ok) {
      return {
        ok: true,
        message: [
          this.t('Initialization succeeded: the local idea repository has been initialized.'),
          ...result.notes
        ].join('\n')
      };
    }
    const steps = result.completedSteps.length
      ? this.t('\nCompleted steps: {0}', result.completedSteps.join(', '))
      : '';
    return { ok: false, message: `${result.error}${steps}` };
  }

  public async initGit(): Promise<OpResult> {
    const root = this.requireLocalRoot();
    if (!root) {
      return {
        ok: false,
        message: this.t('This operation is not allowed in the current state.')
      };
    }
    const result = await ensureLocalGitRepository(root, this.t);
    if (!result.ok) {
      return { ok: false, message: result.error };
    }
    return { ok: true, message: this.t('The local Git repository has been initialized.') };
  }

  public async installHook(): Promise<OpResult> {
    const root = this.requireLocalRoot();
    if (!root) {
      return {
        ok: false,
        message: this.t('This operation is not allowed in the current state.')
      };
    }
    const state = this.currentState;
    const remote = state.kind === 'local' ? state.remote : null;
    const result = await installPrePushHook(root, remote, this.t);
    if (!result.ok) {
      return { ok: false, message: result.error };
    }
    return { ok: true, message: this.t('The pre-push hook was installed / updated.') };
  }

  public async setRemote(url: string): Promise<OpResult> {
    const root = this.requireLocalRoot();
    if (!root) {
      return {
        ok: false,
        message: this.t('This operation is not allowed in the current state.')
      };
    }

    const parsed = parseRemoteUrl(url, this.t);
    if (!parsed.ok) {
      return { ok: false, message: parsed.error };
    }

    const token = await getGitHubToken(true);
    if (!token) {
      return {
        ok: false,
        message: this.t('You must sign in to GitHub to validate the remote proof repository.')
      };
    }

    const client = this.githubClient(token);
    const state = this.currentState;
    const previous = state.kind === 'local' ? state.remote : null;
    // Section 6.3: the branch is no longer edited in the webview; the existing
    // configuration stays authoritative and an empty value means "remote
    // default branch", which validateRemoteRepository resolves as before.
    const configuredBranch = previous?.branch ?? '';
    let configCommitNote = '';

    const result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: this.t('Configuring the remote proof repository (1/2 validate → 2/2 clone)'),
        cancellable: false
      },
      (progress) =>
        runRemoteSetupFlow({
          t: this.t,
          validate: () => validateRemoteRepository(url, client, configuredBranch, this.t),
          confirmChange: async (next) => {
            const sameRepo =
              previous !== null &&
              previous.owner.toLowerCase() === next.owner.toLowerCase() &&
              previous.repo.toLowerCase() === next.repo.toLowerCase();
            if (!previous || sameRepo) {
              return true;
            }
            const confirm = this.t('Change');
            const choice = await vscode.window.showWarningMessage(
              this.t(
                'Changing the remote proof repository URL affects the verifiability of existing proofs; existing proofs remain in the previous remote proof repository. Change it anyway?'
              ),
              { modal: true },
              confirm
            );
            return choice === confirm;
          },
          persist: async (remote) => {
            await writeConfig(root, { version: 1, remote });
            const hookResult = await installPrePushHook(
              root,
              {
                owner: remote.owner,
                repo: remote.repo
              },
              this.t
            );
            if (!hookResult.ok) {
              return { ok: false, error: hookResult.error };
            }
            const commit = await commitSingleFile({
              root,
              filePath: configPath(root),
              message: CONFIG_REMOTE_COMMIT_MESSAGE,
              t: this.t
            });
            if (commit.status === 'committed') {
              configCommitNote = this.t(
                'Automatically committed .ideahub/config.json to the local idea repository (not pushed).'
              );
            } else if (commit.status === 'failed') {
              configCommitNote = this.t(
                '.ideahub/config.json was saved, but the automatic commit failed: {0}',
                commit.reason
              );
            }
            return { ok: true };
          },
          inspect: () => inspectRemoteTarget(root, this.t),
          clone: (remote) => cloneRemoteRepository(root, remote, this.t),
          onStep: (step) =>
            progress.report({ message: remoteSetupStepMessage(step, this.t) })
        })
    );

    const formatted = formatRemoteSetupResult(result, this.t);
    if (formatted.ok && configCommitNote) {
      return { ok: true, message: `${formatted.message}\n${configCommitNote}` };
    }
    return formatted;
  }

  public async cloneRemote(reclone: boolean): Promise<OpResult> {
    const root = this.requireLocalRoot();
    const state = this.currentState;
    if (!root || state.kind !== 'local' || !state.remote) {
      return {
        ok: false,
        message: this.t('Enter and save the remote proof repository URL first.')
      };
    }

    if (reclone) {
      const confirm = this.t('Delete and re-clone');
      const choice = await vscode.window.showWarningMessage(
        this.t(
          'This will delete .ideahub/remote/ and clone the remote proof repository again. Uncommitted changes in that directory will be lost. Continue?'
        ),
        { modal: true },
        confirm
      );
      if (choice !== confirm) {
        return { ok: false, message: this.t('Re-clone cancelled.') };
      }
      const removed = await removeLocalClone(root, this.t);
      if (!removed.ok) {
        return { ok: false, message: removed.error };
      }
    } else if (state.remoteDirExists) {
      return {
        ok: false,
        message: this.t(
          '.ideahub/remote/ already exists; use "Re-clone" to clone it again.'
        )
      };
    }

    const result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: this.t('Cloning the remote proof repository…')
      },
      () => cloneRemoteRepository(root, state.remote!, this.t)
    );
    if (!result.ok) {
      this.log(
        `clone: failed: ${result.error}${result.detail ? `\n${result.detail}` : ''}`
      );
      return { ok: false, message: result.error };
    }
    return {
      ok: true,
      message: this.t(
        'The remote proof repository was cloned (branch {0}).',
        result.branch
      )
    };
  }

  private rememberSettings(info: RemoteSettingsInfo): RemoteSettingsInfo {
    this.remoteSettingsCache = info;
    this.remoteSettingsLanguage = vscode.env.language;
    return info;
  }

  /**
   * Synchronous snapshot for instant rendering when the settings view opens.
   * Uses the last resolved result when it still matches the current remote;
   * otherwise only state-derived fields are filled and the API-derived fields
   * are left as placeholders to be patched asynchronously.
   */
  public currentRemoteSettingsInfo(): RemoteSettingsInfo {
    const state = this.currentState;
    if (state.kind !== 'local') {
      return this.rememberSettings(
        withDisplay(
          {
            url: '',
            owner: null,
            repo: null,
            host: null,
            branch: null,
            visibility: this.t('Unknown'),
            error: this.t('There is no local idea repository open.')
          },
          this.t
        )
      );
    }
    if (!state.remote) {
      return this.rememberSettings(
        withDisplay(
          {
            url: '',
            owner: null,
            repo: null,
            host: null,
            branch: null,
            visibility: this.t('Unknown'),
            error: this.t('No remote proof repository is configured yet.')
          },
          this.t
        )
      );
    }

    const remote = state.remote;
    const cached = this.remoteSettingsCache;
    if (
      cached &&
      cached.url === remote.url &&
      this.remoteSettingsLanguage === vscode.env.language
    ) {
      return cached;
    }
    const parsed = parseRemoteUrl(remote.url, this.t);
    return withDisplay(
      {
        url: remote.url,
        owner: remote.owner,
        repo: remote.repo,
        host: parsed.ok ? parsed.value.host : null,
        branch: remote.branch,
        visibility: this.t('Loading…'),
        error: null
      },
      this.t
    );
  }

  public async getRemoteSettingsInfo(): Promise<RemoteSettingsInfo> {
    const state = this.currentState;
    if (state.kind !== 'local') {
      return this.rememberSettings(
        withDisplay(
          {
            url: '',
            owner: null,
            repo: null,
            host: null,
            branch: null,
            visibility: this.t('Unknown'),
            error: this.t('There is no local idea repository open.')
          },
          this.t
        )
      );
    }
    if (!state.remote) {
      return this.rememberSettings(
        withDisplay(
          {
            url: '',
            owner: null,
            repo: null,
            host: null,
            branch: null,
            visibility: this.t('Unknown'),
            error: this.t('No remote proof repository is configured yet.')
          },
          this.t
        )
      );
    }

    const remote = state.remote;
    const parsed = parseRemoteUrl(remote.url, this.t);
    const base = {
      url: remote.url,
      owner: remote.owner,
      repo: remote.repo,
      host: parsed.ok ? parsed.value.host : null,
      branch: remote.branch,
      visibility: this.t('Unknown'),
      error: null as string | null
    };

    const token = await getGitHubToken(false);
    if (!token) {
      return this.rememberSettings(
        withDisplay(
          {
            ...base
          },
          this.t
        )
      );
    }

    const client = this.githubClient(token);
    try {
      const repository = await client.getRepository(remote.owner, remote.repo);
      if (!repository) {
        return this.rememberSettings(
          withDisplay(
            {
              ...base,
              error: this.t(
                'Unable to read remote proof repository information (the repository does not exist or there is no access).'
              )
            },
            this.t
          )
        );
      }
      return this.rememberSettings(
        withDisplay(
          {
            ...base,
            branch: repository.defaultBranch || remote.branch,
            visibility: repository.isPrivate
              ? this.t('Private (does not meet the requirement; it must be public)')
              : this.t('Public')
          },
          this.t
        )
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return this.rememberSettings(
        withDisplay(
          {
            ...base,
            error: this.t('Unable to read remote proof repository information: {0}', reason)
          },
          this.t
        )
      );
    }
  }

  public async createProject(): Promise<OpResult> {
    const root = this.requireLocalRoot();
    if (!root) {
      return {
        ok: false,
        message: this.t('This operation is not allowed in the current state.')
      };
    }

    const state = this.currentState;
    const existingProjects = state.kind === 'local' ? state.projects.map((project) => project.name) : [];
    const remoteProjects =
      state.kind === 'local' && state.remoteStatus?.available
        ? Object.keys(state.remoteStatus.projects)
        : [];

    const name = await vscode.window.showInputBox({
      title: this.t('New project'),
      prompt: this.t('Enter a project name; <project>/ideas.md will be created'),
      placeHolder: this.t('For example MyGame'),
      validateInput: (value) =>
        validateProjectName(value, existingProjects, remoteProjects, this.t) ?? ''
    });
    if (name === undefined) {
      return { ok: false, message: this.t('Project creation cancelled.') };
    }

    const result = await createProjectOnDisk(root, name, remoteProjects, this.t);
    if (!result.ok) {
      return { ok: false, message: result.error };
    }

    let openNote: string;
    try {
      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(result.ideasPath));
      await vscode.window.showTextDocument(document);
      openNote = this.t('\nideas.md was opened.');
    } catch (error) {
      openNote = this.t(
        '\nThe project was created, but opening ideas.md automatically failed: {0}',
        error instanceof Error ? error.message : String(error)
      );
    }

    const commitNote = this.describeCreatedFileCommit(result.commit);

    return {
      ok: true,
      message: this.t(
        'Created project "{0}" ({1}/ideas.md).\nUsing the minimal template (the documentation does not define an ideas.md template): {2}{3}{4}',
        name,
        name,
        result.content.trim(),
        openNote,
        commitNote
      )
    };
  }

  public async openProject(project: string): Promise<OpResult> {
    const root = this.requireLocalRoot();
    if (!root) {
      return {
        ok: false,
        message: this.t('This operation is not allowed in the current state.')
      };
    }
    const uri = vscode.Uri.file(path.join(root, project, 'ideas.md'));
    try {
      const document = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(document);
      return { ok: true, message: this.t('Opened {0}/ideas.md.', project) };
    } catch (error) {
      return {
        ok: false,
        message: this.t(
          'Unable to open the project ideas.md: {0}',
          error instanceof Error ? error.message : String(error)
        )
      };
    }
  }

  /**
   * Section 8.7: copies the project URL in the remote proof repository. The branch
   * comes from config; the project name is URL-encoded. A 404 before publishing
   * is expected and intentionally not warned about.
   */
  public async copyProjectUrl(project: string): Promise<OpResult> {
    const state = this.currentState;
    if (state.kind !== 'local' || !state.remote) {
      return {
        ok: false,
        message: this.t('Complete the remote proof repository configuration first.')
      };
    }
    const url = remoteProjectUrl(
      state.remote.owner,
      state.remote.repo,
      state.remote.branch,
      project
    );
    try {
      await vscode.env.clipboard.writeText(url);
    } catch (error) {
      return {
        ok: false,
        message: this.t(
          'Failed to copy the project URL: {0}',
          error instanceof Error ? error.message : String(error)
        )
      };
    }
    return { ok: true, message: this.t('Copied project URL: {0}', url) };
  }

  /**
   * Section 6.9: edits the `tags` section only. Front matter is metadata, so
   * this never touches markers, never commits and never pushes.
   */
  public async editProjectTags(project: string): Promise<OpResult> {
    const root = this.requireLocalRoot();
    if (!root) {
      return {
        ok: false,
        message: this.t('This operation is not allowed in the current state.')
      };
    }
    const uri = vscode.Uri.file(path.join(root, project, 'ideas.md'));
    let document;
    try {
      document = await vscode.workspace.openTextDocument(uri);
    } catch (error) {
      return {
        ok: false,
        message: this.t(
          'Unable to read the project ideas.md: {0}',
          error instanceof Error ? error.message : String(error)
        )
      };
    }

    const text = document.getText();
    const current = parseTags(text);
    const input = await vscode.window.showInputBox({
      title: this.t('Edit tags'),
      prompt: this.t(
        'Separate multiple tags with commas (Chinese commas and enumeration commas are supported); leave empty to clear all tags.'
      ),
      value: current.join(', '),
      placeHolder: this.t('For example game, writing')
    });
    if (input === undefined) {
      return { ok: false, message: '', silent: true };
    }

    const next = parseTagInput(input);
    const updated = updateTags(text, next);
    if (updated === text) {
      return { ok: true, message: this.t('Tags did not change.') };
    }

    const edit = new vscode.WorkspaceEdit();
    edit.replace(
      uri,
      new vscode.Range(new vscode.Position(0, 0), document.positionAt(text.length)),
      updated
    );
    const applied = await vscode.workspace.applyEdit(edit);
    if (!applied) {
      return {
        ok: false,
        message: this.t('Failed to write tags. Check whether the file is editable.')
      };
    }
    const saved = await document.save();
    if (!saved) {
      return {
        ok: false,
        message: this.t('Tags were written to the editor, but saving the file failed.')
      };
    }

    this.invalidateProject(project);
    return {
      ok: true,
      message:
        next.length > 0
          ? this.t('Updated tags: {0}', next.join(', '))
          : this.t('Cleared all tags.')
    };
  }

  private logReleaseFailure(
    error: unknown,
    context: {
      owner: string;
      repo: string;
      tag: string;
      targetCommitish: string;
      branch: string;
    }
  ): void {
    const fallbackUrl = `https://api.github.com/repos/${context.owner}/${context.repo}/releases`;
    if (!(error instanceof GitHubApiError)) {
      this.log(
        [
          'mark: createRelease failed (no local marker was written)',
          `POST ${fallbackUrl}`,
          `tag_name=${context.tag}`,
          `target_commitish=${context.targetCommitish}`,
          `target_branch=${context.branch}`,
          `error=${error instanceof Error ? error.message : String(error)}`
        ].join('\n')
      );
      return;
    }
    const errors = error.payload?.errors;
    this.log(
      [
        'mark: createRelease failed (no local marker was written)',
        `POST ${error.url ?? fallbackUrl}`,
        `tag_name=${context.tag}`,
        `target_commitish=${context.targetCommitish}`,
        `target_branch=${context.branch}`,
        `status=${error.status}`,
        `response.message=${error.payload?.message ?? '(none)'}`,
        `errors=${errors ? JSON.stringify(errors) : '(none)'}`,
        `response.body=${error.rawBody ?? '(empty)'}`
      ].join('\n')
    );
  }

  public async markProject(project: string): Promise<OpResult> {
    const outcome = await this.operationGuard.run(project, () =>
      this.markProjectUnlocked(project)
    );
    if (outcome.ignored) {
      this.log(`mark: ignored duplicate request for ${project}`);
      return {
        ok: true,
        message: this.t('An operation is in progress; the duplicate request was ignored.'),
        silent: true
      };
    }
    return outcome.value!;
  }

  private async markProjectUnlocked(project: string): Promise<OpResult> {
    const state = this.currentState;
    if (state.kind !== 'local' || !state.remote) {
      return {
        ok: false,
        message: this.t('Complete the local and remote proof repository configuration first.')
      };
    }
    if (state.issues.length > 0) {
      return {
        ok: false,
        message: this.t(
          'Complete the configuration listed in the view before generating a proof.'
        )
      };
    }
    const remote = state.remote;

    const uri = vscode.Uri.file(path.join(state.root, project, 'ideas.md'));
    let document;
    try {
      document = await vscode.workspace.openTextDocument(uri);
    } catch (error) {
      return {
        ok: false,
        message: this.t(
          'Unable to read the project ideas.md: {0}',
          error instanceof Error ? error.message : String(error)
        )
      };
    }

    const text = document.getText();
    const parsed = parseIdeas(text);
    if (!parsed.hasUnsealedContent) {
      return {
        ok: true,
        message: this.t('There is no new content that needs a proof.')
      };
    }

    // Section 8.8: publishing generates README.md, so a user README.md would
    // be overwritten. Prove and publish both refuse it before any write.
    const readmeCheck = await checkProjectReadme(
      path.join(state.root, project),
      'proof',
      this.t
    );
    if (!readmeCheck.ok) {
      return { ok: false, message: readmeCheck.error };
    }

    this.log(
      `mark: release config: release_commit=${RELEASE_COMMIT || '(default branch head)'} source=build`
    );

    // Section 7.3: fingerprint the sealed text plus referenced project files.
    const fingerprint = await buildFingerprint({
      project,
      text: parsed.tailAfterLastMarker,
      projectDir: path.join(state.root, project),
      repoRoot: state.root,
      t: this.t
    });
    if (!fingerprint.ok) {
      this.log(`mark: fingerprint aborted: ${fingerprint.code}: ${fingerprint.message}`);
      return { ok: false, message: fingerprint.message };
    }
    const contentHash = fingerprint.hash;
    const tag = buildReleaseTag(contentHash).tag;
    const tagError = validateTagName(tag, this.t);
    if (tagError) {
      this.log(
        [
          'mark: release preflight failed (no request sent)',
          `tag_name=${tag}`,
          `release_commit=${RELEASE_COMMIT || '(default branch head)'}`
        ].join('\n')
      );
      return {
        ok: false,
        message: this.t('Unable to create the Release (tag_name={0}): {1}', tag, tagError)
      };
    }

    const token = await getGitHubToken(true);
    if (!token) {
      return {
        ok: false,
        message: this.t('You must sign in to GitHub to create proof Releases.')
      };
    }

    const client = this.githubClient(token);
    const targetResult = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: this.t('Resolving the Release target…')
      },
      () =>
        resolveReleaseTarget(
          {
            getRepository: (owner, repo) => client.getRepository(owner, repo),
            getCommit: (owner, repo, commit) => client.getCommit(owner, repo, commit),
            getEarliestCommit: (owner, repo, branch) =>
              client.getEarliestCommit(owner, repo, branch)
          },
          remote.owner,
          remote.repo,
          RELEASE_COMMIT,
          this.t
        )
    );
    if (!targetResult.ok) {
      this.log(
        [
          'mark: release preflight failed (no request sent)',
          `POST https://api.github.com/repos/${remote.owner}/${remote.repo}/releases`,
          `tag_name=${tag}`,
          `error=${targetResult.error}`
        ].join('\n')
      );
      return {
        ok: false,
        message: this.t('Unable to resolve the Release target: {0}', targetResult.error)
      };
    }
    const target = targetResult.target;
    this.log(
      [
        'mark: release target resolved',
        `default_branch=${target.branch}`,
        `target_commitish=${target.sha}`,
        `commit_source=${target.commitSource}`
      ].join('\n')
    );
    if (target.releaseCommitFallback) {
      this.log(
        `mark: configured release commit was not used (${target.releaseCommitFallback}); falling back to default_branch=${target.branch}`
      );
    }
    this.log(
      [
        'mark: createRelease request',
        `POST https://api.github.com/repos/${remote.owner}/${remote.repo}/releases`,
        `tag_name=${tag}`,
        `target_commitish=${target.sha}`,
        `default_branch=${target.branch}`,
        `commit_source=${target.commitSource}`
      ].join('\n')
    );

    let release;
    try {
      release = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: this.t('Creating the proof Release…')
        },
        // Section 7.4: tag conflicts are handled inside createRelease
        // (immutable existing Release = done; mutable one = delete and retry).
        () => client.createRelease(remote.owner, remote.repo, tag, target.sha)
      );
    } catch (error) {
      this.logReleaseFailure(error, {
        owner: remote.owner,
        repo: remote.repo,
        tag,
        targetCommitish: target.sha,
        branch: target.branch
      });
      return {
        ok: false,
        message: this.t(
          'Failed to create the Release (tag_name={0}, target_commitish={1} (branch {2})). No marker was written: {3}',
          tag,
          target.sha,
          target.branch,
          error instanceof Error ? error.message : String(error)
        )
      };
    }

    // Sections 7.4 / 8.9: a Release that is not confirmed immutable must fail
    // before any marker is written, and the error notification must lead with
    // the summary.
    if (release.release?.immutable !== true) {
      const cause =
        release.release?.immutable === false
          ? this.t('The remote proof repository has immutable Releases disabled.')
          : this.t('GitHub did not report the Release immutability field.');
      return {
        ok: false,
        message: this.t(
          'Proof failed: the Release is not immutable.\nTag: {0}\n{1}\nEnable "Enable release immutability" in the remote proof repository settings, then retry. No marker was written to ideas.md.',
          tag,
          cause
        )
      };
    }

    // Section 7.5: an existing immutable Release keeps its own publish time;
    // using "now" would break the CLI's one-hour proof window.
    const releasedAt = release.release?.publishedAt
      ? new Date(release.release.publishedAt)
      : null;
    const proofTime =
      !release.created && releasedAt && !Number.isNaN(releasedAt.getTime())
        ? releasedAt
        : new Date();
    const proofTimeText = formatMarkerTime(proofTime);
    const markerLine = formatMarkerLine('proof', proofTimeText);

    const updated = appendMarkerLine(text, markerLine);
    const edit = new vscode.WorkspaceEdit();
    edit.replace(uri, new vscode.Range(new vscode.Position(0, 0), document.positionAt(text.length)), updated);
    const applied = await vscode.workspace.applyEdit(edit);
    if (!applied) {
      return {
        ok: false,
        message: this.t(
          'The Release was created, but writing the marker to ideas.md failed. Add the marker manually.'
        )
      };
    }
    const saved = await document.save();
    if (!saved) {
      return {
        ok: false,
        message: this.t('The marker was written to the editor, but saving the file failed.')
      };
    }

    const commitNote = await this.autoCommitMarker(
      state.root,
      project,
      markerLine,
      proofTimeText,
      'proof'
    );

    const time = release.release?.publishedAt
      ? this.t(', published at {0}', release.release.publishedAt)
      : '';
    const immutability = this.t('This proof is confirmed immutable.');
    // Section 7.7: external links never abort, but the proof does not cover
    // their content; report the unique count.
    const externalNote =
      fingerprint.externalLinks.length > 0
        ? this.t(
            '\n{0} external links detected (deduplicated); this proof does not guarantee their content.',
            fingerprint.externalLinks.length
          )
        : '';
    return {
      ok: true,
      message: `${release.created ? this.t('Proof created') : this.t('Proof already existed; the local marker was added')}:\n${tag}${time}\n${immutability}${commitNote}${externalNote}`
    };
  }

  /**
   * Sections 8.9 / 8.10: optional local-only commit of the marker line.
   * Result is appended to the UI message; failures never affect the marker.
   */
  private async autoCommitMarker(
    root: string,
    project: string,
    markerLine: string,
    timeText: string,
    kind: 'proof' | 'publish'
  ): Promise<string> {
    const proofConfig = vscode.workspace.getConfiguration('ideahub.proof');
    const enabled = proofConfig.get<boolean>('autoCommit', true);
    const template =
      kind === 'proof'
        ? proofConfig.get<string>('commitMessage', DEFAULT_PROOF_COMMIT_MESSAGE)
        : vscode.workspace
            .getConfiguration('ideahub.publish')
            .get<string>('commitMessage', DEFAULT_PUBLISH_COMMIT_MESSAGE);
    const message = resolveCommitMessage(
      template,
      { project, time: timeText },
      kind === 'proof' ? DEFAULT_PROOF_COMMIT_MESSAGE : DEFAULT_PUBLISH_COMMIT_MESSAGE
    );

    const result = await commitMarkerLine({
      root,
      project,
      markerLine,
      message,
      enabled,
      t: this.t
    });

    const label = kind === 'proof' ? this.t('marker') : this.t('publish marker');
    return this.describeCommitResult(result, label, message);
  }

  private describeCreatedFileCommit(result: MarkerCommitResult): string {
    if (result.status === 'committed') {
      this.log(
        `create: auto commit succeeded: ${result.commit ?? '(unknown)'} message=ideahub: create project`
      );
      const short = result.commit ? result.commit.slice(0, 7) : '(unknown)';
      return this.t('\nAuto-committed ideas.md (local only, not pushed): {0}', short);
    }
    if (result.status === 'skipped') {
      this.log(`create: auto commit skipped: ${result.reason}`);
      return '';
    }
    this.log(`create: auto commit failed: ${result.reason}`);
    return this.t('\nideas.md was created, but auto-commit failed: {0}', result.reason);
  }

  private describeCommitResult(
    result: MarkerCommitResult,
    label: string,
    message: string
  ): string {
    if (result.status === 'committed') {
      this.log(
        `mark: auto commit succeeded: ${result.commit ?? '(unknown)'} message=${message}`
      );
      const short = result.commit ? result.commit.slice(0, 7) : '(unknown)';
      return this.t(
        '\nAuto-committed the {0} line (local only, not pushed): {1}',
        label,
        short
      );
    }
    if (result.status === 'skipped') {
      this.log(`mark: auto commit skipped: ${result.reason}`);
      return result.silent ? '' : this.t('\nAuto-commit skipped: {0}', result.reason);
    }
    this.log(`mark: auto commit failed: ${result.reason}`);
    return this.t(
      '\n{0} written, but auto-commit failed: {1}',
      label,
      result.reason
    );
  }

  public async publishProject(project: string): Promise<OpResult> {
    const outcome = await this.operationGuard.run(project, () =>
      this.publishProjectUnlocked(project)
    );
    if (outcome.ignored) {
      this.log(`publish: ignored duplicate request for ${project}`);
      return {
        ok: true,
        message: this.t('An operation is in progress; the duplicate request was ignored.'),
        silent: true
      };
    }
    return outcome.value!;
  }

  private async publishProjectUnlocked(project: string): Promise<OpResult> {
    const state = this.currentState;
    if (state.kind !== 'local' || !state.remote) {
      return {
        ok: false,
        message: this.t('Complete the local and remote proof repository configuration first.')
      };
    }
    if (state.issues.length > 0) {
      return {
        ok: false,
        message: this.t(
          'Complete the configuration listed in the view before publishing the project.'
        )
      };
    }

    // Section 8.10: block before any write, commit, copy or push.
    let currentText: string;
    try {
      currentText = await fs.readFile(
        path.join(state.root, project, 'ideas.md'),
        'utf8'
      );
    } catch (error) {
      return {
        ok: false,
        message: this.t(
          'Unable to read the project ideas.md: {0}',
          error instanceof Error ? error.message : String(error)
        )
      };
    }
    if (parseIdeas(currentText).hasUnsealedContent) {
      return {
        ok: false,
        message: this.t('There is new unproven content. Prove it first.')
      };
    }

    // Section 8.10 preflight: avoid offering "publish" when the inner clone
    // has no usable HEAD (empty or interrupted clone).
    const innerPath = remoteRepoPath(state.root);
    const innerHead = await checkInnerRepositoryHead(innerPath, this.t);
    if (!innerHead.ok) {
      this.log(
        `publish: inner repository preflight failed: ${innerHead.error}\n${innerHead.detail}`
      );
      return { ok: false, message: innerHead.error };
    }

    const projectDir = path.join(state.root, project);
    const readmeCheck = await checkProjectReadme(projectDir, 'publish', this.t);
    if (!readmeCheck.ok) {
      return { ok: false, message: readmeCheck.error };
    }

    const scan = await scanProjectDirectory(projectDir, this.t);
    if (scan.blocked.length > 0) {
      return {
        ok: false,
        message: this.t(
          'Files that cannot be published safely were detected; publishing stopped:\n{0}',
          scan.blocked.join('\n')
        )
      };
    }

    const target = path.join(remoteRepoPath(state.root), project);
    const targetExists = await exists(target);

    // Section 8.10: ideas.md is not published; README.md is generated instead.
    const visibleFiles = scan.files.filter((file) => file !== 'ideas.md');
    const fileList =
      visibleFiles.length === 0
        ? this.t('(the project directory contains no other files)')
        : visibleFiles.join('\n');
    const detail = this.t(
      'Folder to be published: {0}\nFile list:\n{1}{2}',
      project,
      fileList,
      targetExists
        ? this.t(
            '\n\nA directory with the same name already exists in the remote proof repository; this publish will overwrite it.'
          )
        : ''
    );

    const publish = this.t('Publish');
    const cancel = this.t('Cancel');
    const first = await vscode.window.showWarningMessage(
      this.t(
        'Your idea "{0}" will be published to your remote proof repository and made public. Continue?',
        project
      ),
      { modal: true, detail },
      targetExists ? this.t('Overwrite and continue') : publish,
      cancel
    );
    if (first === undefined || first === cancel) {
      return { ok: false, message: this.t('Publish cancelled.') };
    }

    const second = await vscode.window.showWarningMessage(
      this.t(
        'To prevent accidentally publishing an idea before it is ready, please confirm once more!'
      ),
      { modal: true, detail: this.t('Project: {0}', project) },
      publish,
      cancel
    );
    if (second === undefined || second === cancel) {
      return { ok: false, message: this.t('Publish cancelled.') };
    }

    const token = await getGitHubToken(true);
    if (!token) {
      return {
        ok: false,
        message: this.t(
          'You must sign in to GitHub to publish to the remote proof repository.'
        )
      };
    }

    return vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: this.t('Publishing the project…')
      },
      async (progress) => {
        const remote = state.remote!;

        // Section 7.6: recompute every proof fingerprint and compare its tag
        // with the paginated remote release list before any write or copy.
        progress.report({ message: this.t('Validating existing proofs…') });
        const checkTargets: ProofCheckTarget[] = [];
        for (const block of extractProofBlocks(currentText)) {
          const blockFingerprint = await buildFingerprint({
            project,
            text: block.rawText,
            projectDir,
            repoRoot: state.root,
            t: this.t
          });
          if (!blockFingerprint.ok) {
            this.log(
              `publish: fingerprint aborted at ${block.time ?? '(unknown)'}: ${blockFingerprint.code}: ${blockFingerprint.message}`
            );
            return { ok: false, message: blockFingerprint.message };
          }
          checkTargets.push({
            time: block.time,
            tag: buildReleaseTag(blockFingerprint.hash).tag
          });
        }

        const client = this.githubClient(token);
        let releases;
        try {
          releases = await client.listAllReleases(remote.owner, remote.repo);
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          this.log(`publish: list releases failed: ${detail}`);
          return {
            ok: false,
            message: this.t('Failed to read the remote Release list: {0}', detail)
          };
        }
        const missing = findMissingProofReleases(checkTargets, releases);
        if (missing.length > 0) {
          this.log(
            `publish: blocked by missing releases:\n${missing
              .map((item) => item.time ?? '(unknown)')
              .join('\n')}`
          );
          return {
            ok: false,
            message: describeMissingProofReleases(missing, this.t)
          };
        }

        progress.report({ message: this.t('Synchronizing the remote proof repository…') });
        const sync = await syncInnerRepository(innerPath, remote.branch, this.t);
        if (!sync.ok) {
          this.log(
            `publish: inner repository sync failed: ${sync.error}${
              sync.detail ? `\n${sync.detail}` : ''
            }`
          );
          return { ok: false, message: sync.error };
        }

        const beforeHead = await readInnerRepositoryHead(innerPath, this.t);
        if (!beforeHead.ok) {
          this.log(
            `publish: inner repository HEAD read failed: ${beforeHead.error}\n${beforeHead.detail}`
          );
          return { ok: false, message: beforeHead.error };
        }

        progress.report({ message: this.t('Writing the publish marker…') });
        const publishedTime = formatMarkerTime(new Date());
        const publishedMarker = formatMarkerLine('published', publishedTime);
        const markerWrite = await this.appendLocalMarker(
          state.root,
          project,
          publishedMarker
        );
        if (!markerWrite.ok) {
          return { ok: false, message: markerWrite.message };
        }
        const commitNote = await this.autoCommitMarker(
          state.root,
          project,
          publishedMarker,
          publishedTime,
          'publish'
        );
        const localMarkerNote = this.t(
          '\nThe local Published marker was written.{0}',
          commitNote
        );

        // Section 7.8: generate the English proof file from the updated
        // ideas.md; the published copy contains README.md instead of ideas.md.
        progress.report({ message: this.t('Generating the proof file…') });
        let updatedText: string;
        try {
          updatedText = await fs.readFile(path.join(projectDir, 'ideas.md'), 'utf8');
        } catch (error) {
          return {
            ok: false,
            message: this.t(
              'Publishing stopped: unable to read ideas.md after writing the marker ({0}).{1}',
              error instanceof Error ? error.message : String(error),
              localMarkerNote
            )
          };
        }
        const proofFileBlocks: ProofFileBlock[] = [];
        for (const block of extractProofBlocks(updatedText)) {
          const blockFingerprint = await buildFingerprint({
            project,
            text: block.rawText,
            projectDir,
            repoRoot: state.root,
            t: this.t
          });
          if (!blockFingerprint.ok) {
            return { ok: false, message: `${blockFingerprint.message}${localMarkerNote}` };
          }
          proofFileBlocks.push({
            time: block.time,
            markerLine: block.markerLine,
            text: blockFingerprint.text,
            files: blockFingerprint.files,
            externalLinks: blockFingerprint.externalLinks
          });
        }
        const projectUrl = remoteProjectUrl(remote.owner, remote.repo, remote.branch, project);
        const proofFile = renderProofFile(proofFileBlocks, projectUrl);
        const externalLinkCount = new Set(
          proofFileBlocks.flatMap((block) => block.externalLinks)
        ).size;
        const externalNote =
          externalLinkCount > 0
            ? this.t(
                '\n{0} external links detected (deduplicated); this proof does not guarantee their content.',
                externalLinkCount
              )
            : '';

        progress.report({ message: this.t('Copying project files…') });
        const copy = await copyProjectIntoInnerRepository(
          innerPath,
          project,
          projectDir,
          proofFile,
          this.t
        );
        if (!copy.ok) {
          return { ok: false, message: `${copy.error}${localMarkerNote}` };
        }

        progress.report({ message: this.t('Committing and pushing the inner repository…') });
        const push = await commitAndPushInnerRepository(
          innerPath,
          {
            url: remote.url,
            branch: remote.branch,
            projectName: project,
            token
          },
          this.t
        );
        if (!push.ok) {
          if (push.stage === 'push') {
            this.log(`publish: push failed: ${push.error}`);
            return {
              ok: false,
              message: `${push.error}${this.t(
                '\nThe local remote was kept so you can push it manually.'
              )}${localMarkerNote}`
            };
          }
          const rollback = await restoreInnerRepository(
            innerPath,
            beforeHead.head,
            project,
            this.t
          );
          this.log(
            `publish: ${push.stage} failed: ${push.error}\nrollback: ${
              rollback.ok ? 'ok' : rollback.error
            }`
          );
          const rollbackNote = rollback.ok
            ? this.t('\nRestored the local remote; the remote was unchanged.')
            : this.t('\nFailed to roll back the local remote: {0}', rollback.error);
          return { ok: false, message: `${push.error}${rollbackNote}${localMarkerNote}` };
        }

        return {
          ok: true,
          message: this.t(
            '{0}.\nRemote project URL: {1}{2}{3}',
            push.pushed
              ? this.t('Publish succeeded')
              : this.t('The project is already up to date; nothing was pushed'),
            projectUrl,
            localMarkerNote,
            externalNote
          )
        };
      }
    );
  }

  private async appendLocalMarker(
    root: string,
    project: string,
    markerLine: string
  ): Promise<OpResult> {
    const uri = vscode.Uri.file(path.join(root, project, 'ideas.md'));
    let document;
    try {
      document = await vscode.workspace.openTextDocument(uri);
    } catch (error) {
      return {
        ok: false,
        message: this.t(
          'Publishing stopped: unable to read the project ideas.md ({0}).',
          error instanceof Error ? error.message : String(error)
        )
      };
    }

    const text = document.getText();
    const updated = appendMarkerLine(text, markerLine);
    const edit = new vscode.WorkspaceEdit();
    edit.replace(
      uri,
      new vscode.Range(new vscode.Position(0, 0), document.positionAt(text.length)),
      updated
    );
    const applied = await vscode.workspace.applyEdit(edit);
    if (!applied) {
      return {
        ok: false,
        message: this.t('Publishing stopped: failed to write the Published marker.')
      };
    }
    const saved = await document.save();
    if (!saved) {
      return {
        ok: false,
        message: this.t(
          'Publishing stopped: the Published marker was written to the editor, but saving the file failed.'
        )
      };
    }
    return { ok: true, message: '' };
  }
}
