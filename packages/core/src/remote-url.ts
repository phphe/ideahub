import { translate, type Translator } from './i18n';

export interface ParsedRemoteUrl {
  owner: string;
  repo: string;
  /** Host parsed from the remote URL. */
  host: string;
  /** Canonical browser URL: https://github.com/owner/repo */
  canonicalUrl: string;
  /** HTTPS clone URL, usable for public repositories without SSH keys. */
  cloneUrl: string;
}

export type ParseRemoteUrlResult =
  | { ok: true; value: ParsedRemoteUrl }
  | { ok: false; error: string };

const OWNER_REPO = '([A-Za-z0-9_.-]+)';

const HTTPS_PATTERN = new RegExp(
  `^https://(?:www\\.)?github\\.com/${OWNER_REPO}/${OWNER_REPO}/?$`,
  'i'
);
const SSH_URL_PATTERN = new RegExp(
  `^ssh://git@github\\.com/${OWNER_REPO}/${OWNER_REPO}/?$`,
  'i'
);
const SCP_PATTERN = new RegExp(`^git@github\\.com:${OWNER_REPO}/${OWNER_REPO}$`, 'i');

export function parseRemoteUrl(
  input: string,
  t: Translator = translate
): ParseRemoteUrlResult {
  const raw = input.trim();
  if (raw.length === 0) {
    return { ok: false, error: t('Enter the remote idea repository URL.') };
  }

  let owner: string | undefined;
  let repo: string | undefined;

  for (const pattern of [HTTPS_PATTERN, SSH_URL_PATTERN, SCP_PATTERN]) {
    const match = pattern.exec(raw);
    if (match) {
      owner = match[1];
      repo = match[2].replace(/\.git$/i, '');
      break;
    }
  }

  if (!owner || !repo) {
    return {
      ok: false,
      error: t(
        'Invalid URL. Use a GitHub HTTPS URL (https://github.com/owner/repo) or SSH URL (git@github.com:owner/repo.git).'
      )
    };
  }

  if (repo.length === 0 || repo === '.' || repo === '..') {
    return { ok: false, error: t('The repository name in the URL is invalid.') };
  }

  return {
    ok: true,
    value: {
      owner,
      repo,
      host: 'github.com',
      canonicalUrl: `https://github.com/${owner}/${repo}`,
      cloneUrl: `https://github.com/${owner}/${repo}.git`
    }
  };
}

/** The URL GitHub itself would use, used by the pre-push hook for comparison. */
export function canonicalRemoteIdentity(owner: string, repo: string): string {
  return `${owner}/${repo}`.toLowerCase();
}
