import { promises as fs } from 'node:fs';
import * as path from 'node:path';

export const HOOK_BLOCK_START = '# >>> ideahub pre-push guard >>>';
export const HOOK_BLOCK_END = '# <<< ideahub pre-push guard <<<';

export interface HookTarget {
  owner: string;
  repo: string;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function shellUnquote(value: string): string {
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/'\\''/g, "'");
  }
  return value;
}

/**
 * Generates the guarded block. Only code between the two markers is managed by
 * IdeaHub; everything outside is owned by the user.
 */
export function buildHookBlock(target: HookTarget | null): string {
  const owner = target?.owner ?? '';
  const repo = target?.repo ?? '';
  return `${HOOK_BLOCK_START}
# Managed by IdeaHub. This block is replaced on update; edit outside it.
ideahub_remote_owner=${shellQuote(owner)}
ideahub_remote_repo=${shellQuote(repo)}
ideahub_normalize_remote() {
  ideahub_url=$1
  ideahub_url=\${ideahub_url%%\\?*}
  ideahub_url=\${ideahub_url%%#*}
  ideahub_url=\${ideahub_url%/}
  ideahub_url=\${ideahub_url%.git}
  ideahub_url=\${ideahub_url#ssh://}
  ideahub_url=\${ideahub_url#https://}
  ideahub_url=\${ideahub_url#http://}
  ideahub_url=\${ideahub_url#git://}
  ideahub_url=\${ideahub_url#*@}
  ideahub_url=$(printf '%s' "$ideahub_url" | sed 's/:/\\//')
  printf '%s' "$ideahub_url" | tr '[:upper:]' '[:lower:]'
}
if [ -n "$ideahub_remote_owner" ] && [ -n "$ideahub_remote_repo" ] && [ -n "$2" ]; then
  ideahub_expected=$(printf 'github.com/%s/%s' "$ideahub_remote_owner" "$ideahub_remote_repo" | tr '[:upper:]' '[:lower:]')
  ideahub_actual=$(ideahub_normalize_remote "$2")
  if [ "$ideahub_actual" = "$ideahub_expected" ]; then
    echo "IdeaHub: 不能直接把本地创意仓库推送到远程创意仓库（创意内容需通过“发布”功能公开）。" >&2
    exit 1
  fi
fi
while read -r ideahub_local_ref ideahub_local_sha ideahub_remote_ref ideahub_remote_sha; do
  :
done
exit 0
${HOOK_BLOCK_END}`;
}

export function mergeHook(existing: string, block: string): string {
  const start = existing.indexOf(HOOK_BLOCK_START);
  const end = existing.indexOf(HOOK_BLOCK_END, start);

  if (start !== -1 && end !== -1) {
    return existing.slice(0, start) + block + existing.slice(end + HOOK_BLOCK_END.length);
  }

  const normalized = existing.replace(/\r\n/g, '\n');
  if (normalized.trim().length === 0) {
    return `#!/bin/sh\n\n${block}\n`;
  }

  const separator = normalized.endsWith('\n') ? '\n' : '\n\n';
  return `${normalized}${separator}${block}\n`;
}

export function hasHookBlock(content: string): boolean {
  return content.includes(HOOK_BLOCK_START) && content.includes(HOOK_BLOCK_END);
}

export function readHookTarget(content: string): HookTarget | null {
  const start = content.indexOf(HOOK_BLOCK_START);
  const end = content.indexOf(HOOK_BLOCK_END, start);
  if (start === -1 || end === -1) {
    return null;
  }
  const block = content.slice(start, end);
  const ownerMatch = /^ideahub_remote_owner=(.*)$/m.exec(block);
  const repoMatch = /^ideahub_remote_repo=(.*)$/m.exec(block);
  if (!ownerMatch || !repoMatch) {
    return null;
  }
  return {
    owner: shellUnquote(ownerMatch[1].trim()),
    repo: shellUnquote(repoMatch[1].trim())
  };
}

export function isHookTargetCurrent(content: string, target: HookTarget | null): boolean {
  const parsed = readHookTarget(content);
  if (!parsed) {
    return false;
  }
  if (!target) {
    return true;
  }
  return (
    parsed.owner.toLowerCase() === target.owner.toLowerCase() &&
    parsed.repo.toLowerCase() === target.repo.toLowerCase()
  );
}

export function hooksDir(root: string): string {
  return path.join(root, '.git', 'hooks');
}

export function prePushPath(root: string): string {
  return path.join(hooksDir(root), 'pre-push');
}

export async function readPrePushHook(root: string): Promise<string | null> {
  try {
    return await fs.readFile(prePushPath(root), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

export async function installPrePushHook(
  root: string,
  target: HookTarget | null
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  try {
    await fs.mkdir(hooksDir(root), { recursive: true });
    const existing = (await readPrePushHook(root)) ?? '';
    const merged = mergeHook(existing, buildHookBlock(target));
    await fs.writeFile(prePushPath(root), merged, 'utf8');
    if (process.platform !== 'win32') {
      await fs.chmod(prePushPath(root), 0o755);
    }
    return { ok: true, path: prePushPath(root) };
  } catch (error) {
    return {
      ok: false,
      error: `无法写入 pre-push hook：${error instanceof Error ? error.message : String(error)}`
    };
  }
}
