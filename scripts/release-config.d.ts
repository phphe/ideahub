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

export const DEFAULT_RELEASE_BRANCH: string;
export const DEFAULT_PROOF_FILE_VERSION: string;
export const DEFAULT_PROOF_FILE_HEADER: string;
export const RELEASE_CONFIG_FILE: string;
export const RELEASE_BRANCH_ENV_KEY: string;
export const PROOF_FILE_VERSION_ENV_KEY: string;
export const PROOF_FILE_HEADER_ENV_KEY: string;

export function validateBranchName(branch: string): string | null;
export function parseEnvValue(envText: string, key: string): string | null;
export function resolveReleaseBranch(input?: {
  envText?: string | null;
  configText?: string | null;
}): ReleaseBranchResolution;
export function resolveProofFileVersion(input?: {
  envText?: string | null;
  configText?: string | null;
}): ProofFileVersionResolution;
export function resolveProofFileHeader(input?: {
  envText?: string | null;
  configText?: string | null;
}): ProofFileHeaderResolution;
