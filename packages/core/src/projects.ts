import { promises as fs } from 'node:fs';
import * as path from 'node:path';

export const IDEAS_FILE = 'ideas.md';

export type CreateProjectResult =
  | { ok: true; projectPath: string; ideasPath: string; content: string }
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
  remoteProjects: string[] = []
): string | null {
  if (name.length === 0) {
    return '项目名称不能为空。';
  }
  if (name === '.' || name === '..') {
    return '项目名称不能是 "." 或 ".."。';
  }
  if (name.startsWith('.')) {
    return '项目名称不能以点开头。';
  }
  if (/[\\/]/.test(name)) {
    return '项目名称不能包含路径分隔符。';
  }
  if (/[<>:"|?*]/.test(name)) {
    return '项目名称不能包含 Windows 不允许的字符（<>:"|?*）。';
  }
  for (const char of name) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) {
      return '项目名称不能包含控制字符。';
    }
  }
  const lower = name.toLowerCase();
  if (
    existingProjects.some((entry) => entry.toLowerCase() === lower) ||
    remoteProjects.some((entry) => entry.toLowerCase() === lower)
  ) {
    return '已存在同名项目或远程仓库同名目录。';
  }
  return null;
}

/**
 * Creates <name>/ideas.md without touching any existing folder or file.
 */
export async function createProject(
  root: string,
  name: string,
  remoteProjects: string[] = []
): Promise<CreateProjectResult> {
  let existingProjects: string[];
  try {
    existingProjects = await listProjects(root);
  } catch (error) {
    return { ok: false, error: `无法读取项目列表：${describeError(error)}` };
  }

  const invalid = validateProjectName(name, existingProjects, remoteProjects);
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
        error: '已存在同名文件夹，已停止创建（不会覆盖任何内容）。'
      };
    }
    return { ok: false, error: `无法创建项目文件夹：${describeError(error)}` };
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
    return { ok: false, error: `无法创建 ideas.md：${describeError(error)}` };
  }

  return { ok: true, projectPath, ideasPath, content };
}
