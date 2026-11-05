export type ReleaseBranchSource = 'env' | 'file' | 'default';

export interface ReleaseBranchResolution {
  branch: string;
  source: ReleaseBranchSource;
  warnings: string[];
}

export const DEFAULT_RELEASE_BRANCH: string;
export const RELEASE_CONFIG_FILE: string;
export const RELEASE_BRANCH_ENV_KEY: string;

export function validateBranchName(branch: string): string | null;
export function parseEnvValue(envText: string, key: string): string | null;
export function resolveReleaseBranch(input?: {
  envText?: string | null;
  configText?: string | null;
}): ReleaseBranchResolution;
