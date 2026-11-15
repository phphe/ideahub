import type { CloneResult, RemoteTargetInspection } from './clone';
import type { RemoteConfig } from './config';
import { translate, type Translator } from './i18n';
import type { ImmutabilityCheck } from './immutability';
import type { ValidateRemoteResult } from './remote-setup';

export type RemoteSetupStep = 'validate' | 'persist' | 'clone';

export interface RemoteSetupDecisionLike {
  ok: boolean;
  message: string;
}

export interface RemoteSetupFlowDeps {
  t?: Translator;
  validate(): Promise<ValidateRemoteResult>;
  decideImmutability(check: ImmutabilityCheck): RemoteSetupDecisionLike;
  confirmChange?(next: RemoteConfig): Promise<boolean>;
  persist(remote: RemoteConfig): Promise<{ ok: true } | { ok: false; error: string }>;
  inspect(): Promise<RemoteTargetInspection>;
  clone(remote: RemoteConfig): Promise<CloneResult>;
  onStep?(step: RemoteSetupStep): void;
}

export type RemoteSetupFlowResult =
  | {
      ok: true;
      remote: RemoteConfig;
      immutabilityMessage: string;
      clone: 'cloned' | 'skipped';
      branch: string;
    }
  | {
      ok: false;
      stage: 'validation' | 'config' | 'clone';
      message: string;
      retryClone: boolean;
    };

export type RemoteClonePlan =
  | { action: 'clone' }
  | { action: 'skip'; reason: 'existing-repo' }
  | { action: 'block'; reason: string };

export function planRemoteClone(target: RemoteTargetInspection): RemoteClonePlan {
  switch (target.kind) {
    case 'valid-repo':
      return { action: 'skip', reason: 'existing-repo' };
    case 'blocked':
      return { action: 'block', reason: target.reason };
    default:
      return { action: 'clone' };
  }
}

export async function runRemoteSetupFlow(
  deps: RemoteSetupFlowDeps
): Promise<RemoteSetupFlowResult> {
  const t = deps.t ?? translate;
  deps.onStep?.('validate');
  const validation = await deps.validate();
  if (!validation.ok) {
    return {
      ok: false,
      stage: 'validation',
      message: validation.error,
      retryClone: false
    };
  }

  const immutability = deps.decideImmutability(validation.immutability);
  if (!immutability.ok) {
    return {
      ok: false,
      stage: 'validation',
      message: immutability.message,
      retryClone: false
    };
  }

  if (deps.confirmChange && !(await deps.confirmChange(validation.remote))) {
    return {
      ok: false,
      stage: 'validation',
      message: t('Remote repository address change cancelled.'),
      retryClone: false
    };
  }

  deps.onStep?.('persist');
  const persisted = await deps.persist(validation.remote);
  if (!persisted.ok) {
    return {
      ok: false,
      stage: 'config',
      message: persisted.error,
      retryClone: false
    };
  }

  const plan = planRemoteClone(await deps.inspect());
  if (plan.action === 'skip') {
    return {
      ok: true,
      remote: validation.remote,
      immutabilityMessage: immutability.message,
      clone: 'skipped',
      branch: validation.remote.branch
    };
  }
  if (plan.action === 'block') {
    return {
      ok: false,
      stage: 'clone',
      message: plan.reason,
      retryClone: true
    };
  }

  deps.onStep?.('clone');
  const cloned = await deps.clone(validation.remote);
  if (!cloned.ok) {
    return {
      ok: false,
      stage: 'clone',
      message: cloned.error,
      retryClone: true
    };
  }

  const remote = { ...validation.remote, branch: cloned.branch };
  return {
    ok: true,
    remote,
    immutabilityMessage: immutability.message,
    clone: 'cloned',
    branch: cloned.branch
  };
}
