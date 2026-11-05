import type { OpResult } from './controller';

export interface WebviewMessage {
  type?: string;
  project?: string;
  url?: string;
  immutabilityConfirmed?: boolean;
  message?: string;
}

export interface RouteHandlers {
  refresh(): Promise<void>;
  initialize(): Promise<OpResult>;
  initGit(): Promise<OpResult>;
  installHook(): Promise<OpResult>;
  setRemote(url: string, immutabilityConfirmed: boolean): Promise<OpResult>;
  cloneRemote(reclone: boolean): Promise<OpResult>;
  openProject(project: string): Promise<OpResult>;
  markProject(project: string): Promise<OpResult>;
  publishProject(project: string): Promise<OpResult>;
}

export type MessageRoute =
  | { kind: 'command'; name: string; run: () => Promise<void> }
  | { kind: 'operation'; name: string; run: () => Promise<OpResult> }
  | { kind: 'unknown' };

export function routeMessage(message: WebviewMessage, handlers: RouteHandlers): MessageRoute {
  switch (message.type) {
    case 'refresh':
      return { kind: 'command', name: 'refresh', run: () => handlers.refresh() };
    case 'init':
      return { kind: 'operation', name: 'init', run: () => handlers.initialize() };
    case 'initGit':
      return { kind: 'operation', name: 'initGit', run: () => handlers.initGit() };
    case 'installHook':
      return { kind: 'operation', name: 'installHook', run: () => handlers.installHook() };
    case 'setRemote':
      return {
        kind: 'operation',
        name: 'setRemote',
        run: () => handlers.setRemote(message.url ?? '', message.immutabilityConfirmed === true)
      };
    case 'clone':
      return { kind: 'operation', name: 'clone', run: () => handlers.cloneRemote(false) };
    case 'reclone':
      return { kind: 'operation', name: 'reclone', run: () => handlers.cloneRemote(true) };
    case 'open': {
      const project = message.project;
      if (!project) {
        return { kind: 'unknown' };
      }
      return { kind: 'operation', name: 'open', run: () => handlers.openProject(project) };
    }
    case 'mark': {
      const project = message.project;
      if (!project) {
        return { kind: 'unknown' };
      }
      return { kind: 'operation', name: 'mark', run: () => handlers.markProject(project) };
    }
    case 'publish': {
      const project = message.project;
      if (!project) {
        return { kind: 'unknown' };
      }
      return { kind: 'operation', name: 'publish', run: () => handlers.publishProject(project) };
    }
    default:
      return { kind: 'unknown' };
  }
}
