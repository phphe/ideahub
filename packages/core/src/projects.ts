import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { translate, type Translator } from './i18n';
import {
  commitFiles,
  PROJECT_CREATE_COMMIT_MESSAGE,
  type MarkerCommitResult
} from './marker-commit';

export const IDEAS_FILE = 'ideas.md';

export type CreateProjectResult =
  | {
      ok: true;
      projectPath: string;
      ideasPath: string;
      content: string;
      commit: MarkerCommitResult;
    }
  | { ok: false; error: string };

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The requirement does not define an ideas.md template, so the minimal legal
 * content is a single level-3 heading using the project name.
 */
export function ideasTemplate(projectName: string): string {
  return `### ${projectName}\n`;
}

export async function listProjects(root: string): Promise<string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const names: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    if (entry.name.startsWith('.')) {
      continue;
    }
    try {
      const stat = await fs.stat(path.join(root, entry.name, IDEAS_FILE));
      if (stat.isFile()) {
        names.push(entry.name);
      }
    } catch {
      // No ideas.md: not a project.
    }
  }
  return names.sort((a, b) => a.localeCompare(b));
}

/**
 * Returns an error message when the name cannot be used for a project folder,
 * or null when it is valid. Names are never rewritten (case is preserved).
 */
export function validateProjectName(
  name: string,
  existingProjects: string[] = [],
  remoteProjects: string[] = [],
  t: Translator = translate
): string | null {
  if (name.length === 0) {
    return t('Project name cannot be empty.');
  }
  if (name === '.' || name === '..') {
    return t('Project name cannot be "." or "..".');
  }
  if (name.startsWith('.')) {
    return t('Project name cannot start with a dot.');
  }
  if (/[\\/]/.test(name)) {
    return t('Project name cannot contain a path separator.');
  }
  if (/[<>:"|?*]/.test(name)) {
    return t('Project name cannot contain characters Windows does not allow (<>:"|?*).');
  }
  for (const char of name) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) {
      return t('Project name cannot contain control characters.');
    }
  }
  const lower = name.toLowerCase();
  if (
    existingProjects.some((entry) => entry.toLowerCase() === lower) ||
    remoteProjects.some((entry) => entry.toLowerCase() === lower)
  ) {
    return t('A project or remote directory with the same name already exists.');
  }
  return null;
}

/**
 * Creates <name>/ideas.md without touching any existing folder or file.
 */
export async function createProject(
  root: string,
  name: string,
  remoteProjects: string[] = [],
  t: Translator = translate
): Promise<CreateProjectResult> {
  let existingProjects: string[];
  try {
    existingProjects = await listProjects(root);
  } catch (error) {
    return { ok: false, error: t('Unable to read the project list: {0}', describeError(error)) };
  }

  const invalid = validateProjectName(name, existingProjects, remoteProjects, t);
  if (invalid) {
    return { ok: false, error: invalid };
  }

  const projectPath = path.join(root, name);
  try {
    await fs.mkdir(projectPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      return {
        ok: false,
        error: t(
          'A folder with the same name already exists. Creation stopped without overwriting anything.'
        )
      };
    }
    return {
      ok: false,
      error: t('Unable to create the project folder: {0}', describeError(error))
    };
  }

  const ideasPath = path.join(projectPath, IDEAS_FILE);
  const content = ideasTemplate(name);
  try {
    await fs.writeFile(ideasPath, content, { encoding: 'utf8', flag: 'wx' });
  } catch (error) {
    try {
      await fs.rm(projectPath, { recursive: true, force: true });
    } catch {
      // Best effort cleanup; the error below still reports the failure.
    }
    return {
      ok: false,
      error: t('Unable to create ideas.md: {0}', describeError(error))
    };
  }

  // Sections 2.4 / 8.8: commit only the newly created ideas.md, like init and
  // independent of `ideahub.proof.autoCommit`.
  const commit = await commitFiles({
    root,
    filePaths: [ideasPath],
    message: PROJECT_CREATE_COMMIT_MESSAGE,
    t
  });

  return { ok: true, projectPath, ideasPath, content, commit };
}
