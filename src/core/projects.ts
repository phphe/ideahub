import { promises as fs } from 'node:fs';
import * as path from 'node:path';

export const IDEAS_FILE = 'ideas.md';

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
