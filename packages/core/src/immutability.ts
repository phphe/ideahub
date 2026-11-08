export const GITHUB_COM_HOST = 'github.com';

export type ImmutabilityCheck =
  | { kind: 'enabled'; enforcedByOwner: boolean }
  | { kind: 'disabled'; source: 'api' | 'not-found' }
  | { kind: 'unknown'; reason: 'forbidden' | 'non-github-host' | 'http' | 'network'; status?: number };

export type ImmutabilityProbe =
  | { type: 'response'; host: string; status: number; body?: unknown }
  | { type: 'network-error'; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function classifyImmutabilityProbe(probe: ImmutabilityProbe): ImmutabilityCheck {
  if (probe.type === 'network-error') {
    return { kind: 'unknown', reason: 'network' };
  }

  if (probe.host.toLowerCase() !== GITHUB_COM_HOST) {
    return { kind: 'unknown', reason: 'non-github-host' };
  }

  if (probe.status === 200) {
    const body = isRecord(probe.body) ? probe.body : undefined;
    if (body?.enabled === true) {
      return { kind: 'enabled', enforcedByOwner: body.enforced_by_owner === true };
    }
    if (body?.enabled === false) {
      return { kind: 'disabled', source: 'api' };
    }
    return { kind: 'unknown', reason: 'http', status: probe.status };
  }

  if (probe.status === 404) {
    return { kind: 'disabled', source: 'not-found' };
  }

  if (probe.status === 403) {
    return { kind: 'unknown', reason: 'forbidden' };
  }

  return { kind: 'unknown', reason: 'http', status: probe.status };
}

export function describeImmutabilityCheck(check: ImmutabilityCheck): string {
  switch (check.kind) {
    case 'enabled':
      return check.enforcedByOwner
        ? '已通过 GitHub API 确认启用 Release 不可变（组织策略强制）。'
        : '已通过 GitHub API 确认启用 Release 不可变。';
    case 'disabled':
      return check.source === 'not-found'
        ? 'GitHub API 返回 404：该仓库未启用 Release 不可变。'
        : 'GitHub API 返回 enabled=false：该仓库未启用 Release 不可变。';
    case 'unknown':
      switch (check.reason) {
        case 'forbidden':
          return '无法确认 Release 不可变性（需要仓库 admin 读权限）。';
        case 'non-github-host':
          return '无法确认 Release 不可变性（非 github.com 域名，GHES 可能没有该检测端点）。';
        case 'network':
          return '无法确认 Release 不可变性（网络请求失败）。';
        default:
          return check.status === undefined
            ? '无法确认 Release 不可变性（GitHub API 返回异常响应）。'
            : `无法确认 Release 不可变性（GitHub API 返回 HTTP ${check.status}）。`;
      }
  }
}

export interface RemoteSetupDecision {
  ok: boolean;
  message: string;
}

export function decideRemoteSetup(
  check: ImmutabilityCheck,
  manualConfirmed: boolean,
  settingsUrl: string
): RemoteSetupDecision {
  const description = describeImmutabilityCheck(check);

  if (check.kind === 'enabled') {
    return { ok: true, message: description };
  }

  if (check.kind === 'disabled') {
    return {
      ok: false,
      message: `${description}\n请在 ${settingsUrl} 启用 “Enable release immutability” 后重试。`
    };
  }

  if (!manualConfirmed) {
    return {
      ok: false,
      message: `${description}\n请勾选“我已确认仓库启用了 Enable release immutability”后重试。`
    };
  }

  return { ok: true, message: `${description}\n已按你的手动确认继续。` };
}

export function describeReleaseImmutability(immutable: boolean | undefined): string {
  if (immutable === true) {
    return '本次证明已确认不可变。';
  }
  if (immutable === false) {
    return '本次 Release 可变，仓库可能未启用该设置。';
  }
  return '本次 Release 不可变性未知（API 未返回 immutable 字段）。';
}
