export type ReleaseBranchSource = 'env' | 'file' | 'default';

export interface ReleaseBranchResolution {
  branch: string;
  source: ReleaseBranchSource;
  warnings: string[];
}

export interface ProofFileValueResolution {
  source: ReleaseBranchSource;
  warnings: string[];
}

export interface ProofFileVersionResolution extends ProofFileValueResolution {
  version: string;
}

export interface ProofFileHeaderResolution extends ProofFileValueResolution {
  header: string;
}

export interface OAuthClientIdResolution extends ProofFileValueResolution {
  clientId: string;
}

export interface DeveloperConfigSuccess {
  ok: true;
  value: Record<string, unknown>;
}

export interface DeveloperConfigFailure {
  ok: false;
  reason: 'missing' | 'load-failed' | 'default-missing' | 'default-not-object';
  detail?: string;
}

export type DeveloperConfigResult = DeveloperConfigSuccess | DeveloperConfigFailure;

export const DEFAULT_RELEASE_BRANCH: string;
export const DEFAULT_PROOF_FILE_VERSION: string;
export const DEFAULT_PROOF_FILE_HEADER: string;
export const DEFAULT_OAUTH_CLIENT_ID: string;
export const DEVELOPER_CONFIG_FILE: string;
export const RELEASE_BRANCH_ENV_KEY: string;
export const PROOF_FILE_VERSION_ENV_KEY: string;
export const PROOF_FILE_HEADER_ENV_KEY: string;
export const OAUTH_CLIENT_ID_ENV_KEY: string;

export function validateBranchName(branch: string): string | null;
export function parseEnvValue(envText: string, key: string): string | null;
export function loadDeveloperConfig(filePath?: string): Promise<DeveloperConfigResult>;
export function resolveReleaseBranch(input?: {
  envText?: string | null;
  config?: DeveloperConfigResult | null;
}): ReleaseBranchResolution;
export function resolveProofFileVersion(input?: {
  envText?: string | null;
  config?: DeveloperConfigResult | null;
}): ProofFileVersionResolution;
export function resolveProofFileHeader(input?: {
  envText?: string | null;
  config?: DeveloperConfigResult | null;
}): ProofFileHeaderResolution;
export function resolveOAuthClientId(input?: {
  envText?: string | null;
  config?: DeveloperConfigResult | null;
}): OAuthClientIdResolution;
export function findStandaloneSeparatorLine(header: string): number | null;
