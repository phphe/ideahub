import { translate, type Translator } from './i18n';

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

export function describeImmutabilityCheck(
  check: ImmutabilityCheck,
  t: Translator = translate
): string {
  switch (check.kind) {
    case 'enabled':
      return check.enforcedByOwner
        ? t(
            'Release immutability is enabled (confirmed by the GitHub API; enforced by the organization policy).'
          )
        : t('Release immutability is enabled (confirmed by the GitHub API).');
    case 'disabled':
      return check.source === 'not-found'
        ? t(
            'The GitHub API returned 404: release immutability is not enabled for this repository.'
          )
        : t(
            'The GitHub API returned enabled=false: release immutability is not enabled for this repository.'
          );
    case 'unknown':
      switch (check.reason) {
        case 'forbidden':
          return t(
            'Cannot confirm release immutability (repository admin read permission is required).'
          );
        case 'non-github-host':
          return t(
            'Cannot confirm release immutability (non-github.com host; GHES may not expose this endpoint).'
          );
        case 'network':
          return t('Cannot confirm release immutability (the network request failed).');
        default:
          return check.status === undefined
            ? t('Cannot confirm release immutability (unexpected GitHub API response).')
            : t('Cannot confirm release immutability (GitHub API returned HTTP {0}).', check.status);
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
  settingsUrl: string,
  t: Translator = translate
): RemoteSetupDecision {
  const description = describeImmutabilityCheck(check, t);

  if (check.kind === 'enabled') {
    return { ok: true, message: description };
  }

  if (check.kind === 'disabled') {
    return {
      ok: false,
      message: t(
        '{0}\nEnable "Enable release immutability" at {1} and try again.',
        description,
        settingsUrl
      )
    };
  }

  if (!manualConfirmed) {
    return {
      ok: false,
      message: t(
        '{0}\nCheck "I have confirmed that Enable release immutability is enabled for the repository" and try again.',
        description
      )
    };
  }

  return {
    ok: true,
    message: t('{0}\nContinued based on your manual confirmation.', description)
  };
}

export function describeReleaseImmutability(
  immutable: boolean | undefined,
  t: Translator = translate
): string {
  if (immutable === true) {
    return t('This proof is confirmed immutable.');
  }
  if (immutable === false) {
    return t(
      'This release is mutable; the repository may not have this setting enabled.'
    );
  }
  return t(
    'The immutability of this release is unknown (the API did not return the immutable field).'
  );
}
