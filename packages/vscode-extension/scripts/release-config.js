const { pathToFileURL } = require('node:url');
const { resolve } = require('node:path');

const DEFAULT_RELEASE_COMMIT = '';
const DEFAULT_PROOF_FILE_VERSION = '0';
const DEFAULT_PROOF_FILE_HEADER = '';
const DEFAULT_OAUTH_CLIENT_ID = '';
const DEVELOPER_CONFIG_FILE = 'config.mjs';
const RELEASE_COMMIT_ENV_KEY = 'IDEAHUB_RELEASE_COMMIT';
const PROOF_FILE_VERSION_ENV_KEY = 'IDEAHUB_PROOF_FILE_VERSION';
const PROOF_FILE_HEADER_ENV_KEY = 'IDEAHUB_PROOF_FILE_HEADER';
const OAUTH_CLIENT_ID_ENV_KEY = 'IDEAHUB_OAUTH_CLIENT_ID';
const RELEASE_COMMIT_PATTERN = /^[0-9a-f]{7,64}$/i;

function validateReleaseCommit(commit) {
  return RELEASE_COMMIT_PATTERN.test(commit)
    ? null
    : 'release commit 必须是 7–64 位十六进制字符串';
}

function parseEnvValue(envText, key) {
  if (typeof envText !== 'string') {
    return null;
  }
  for (const line of envText.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) {
      continue;
    }
    const separator = trimmed.indexOf('=');
    if (separator <= 0) {
      continue;
    }
    if (trimmed.slice(0, separator).trim() !== key) {
      continue;
    }
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    return value;
  }
  return null;
}

let importCounter = 0;

/**
 * Section 6.7: load the developer config as an ES module and take the
 * `default` export. The returned result is a plain object so the resolvers
 * stay pure and unit-testable. A cache-busting query keeps repeated loads in
 * the same process fresh.
 */
async function loadDeveloperConfig(filePath = DEVELOPER_CONFIG_FILE) {
  importCounter += 1;
  const absolute = resolve(filePath);
  let loaded;
  try {
    loaded = await import(`${pathToFileURL(absolute).href}?v=${importCounter}`);
  } catch (error) {
    const code = error && error.code;
    if (code === 'ERR_MODULE_NOT_FOUND' || code === 'ENOENT') {
      return { ok: false, reason: 'missing' };
    }
    return {
      ok: false,
      reason: 'load-failed',
      detail: error instanceof Error ? error.message : String(error)
    };
  }

  const value = loaded && loaded.default;
  if (value === undefined) {
    return { ok: false, reason: 'default-missing' };
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, reason: 'default-not-object' };
  }
  return { ok: true, value };
}

function describeConfigFailure(config) {
  const reason = config && config.reason;
  switch (reason) {
    case 'missing':
      return `未找到 ${DEVELOPER_CONFIG_FILE}`;
    case 'load-failed':
      return `加载 ${DEVELOPER_CONFIG_FILE} 失败${
        config.detail ? `：${config.detail}` : ''
      }`;
    case 'default-missing':
      return `${DEVELOPER_CONFIG_FILE} 缺少 default 导出`;
    case 'default-not-object':
      return `${DEVELOPER_CONFIG_FILE} 的 default 必须是对象`;
    default:
      return `未找到 ${DEVELOPER_CONFIG_FILE}`;
  }
}

/**
 * Pure build-time resolver. Callers pass `.env` content and the loaded config
 * result explicitly; nothing is read from an end user's workspace at runtime.
 */
function resolveReleaseCommit({ envText = null, config = null } = {}) {
  const warnings = [];

  if (typeof envText === 'string') {
    const envValue = parseEnvValue(envText, RELEASE_COMMIT_ENV_KEY);
    if (envValue !== null) {
      const commit = envValue.trim();
      if (commit.length > 0) {
        const error = validateReleaseCommit(commit);
        if (!error) {
          return { commit, source: 'env', warnings };
        }
        warnings.push(`.env 中的 ${RELEASE_COMMIT_ENV_KEY} 无效：${error}，已忽略该来源。`);
      }
    }
  }

  if (!config || config.ok !== true) {
    warnings.push(`${describeConfigFailure(config)}，使用空 releaseCommit。`);
    return { commit: DEFAULT_RELEASE_COMMIT, source: 'default', warnings };
  }

  const value = config.value.releaseCommit;
  if (value === undefined || value === null) {
    warnings.push(`${DEVELOPER_CONFIG_FILE} 缺少 releaseCommit，使用空 releaseCommit。`);
    return { commit: DEFAULT_RELEASE_COMMIT, source: 'default', warnings };
  }
  if (typeof value !== 'string') {
    warnings.push(`${DEVELOPER_CONFIG_FILE} 的 releaseCommit 必须是字符串，使用空 releaseCommit。`);
    return { commit: DEFAULT_RELEASE_COMMIT, source: 'default', warnings };
  }

  const commit = value.trim();
  if (commit.length === 0) {
    return { commit: DEFAULT_RELEASE_COMMIT, source: 'file', warnings };
  }
  const error = validateReleaseCommit(commit);
  if (error) {
    warnings.push(
      `${DEVELOPER_CONFIG_FILE} 的 releaseCommit 无效：${error}，使用空 releaseCommit。`
    );
    return { commit: DEFAULT_RELEASE_COMMIT, source: 'default', warnings };
  }

  return { commit, source: 'file', warnings };
}

/**
 * Section 6.7: `proofFileVersion` resolves from `.env` > `config.mjs`
 * > `"0"`. Missing, non-string or empty values warn and fall back separately.
 */
function resolveProofFileVersion({ envText = null, config = null } = {}) {
  const warnings = [];

  if (typeof envText === 'string') {
    const envValue = parseEnvValue(envText, PROOF_FILE_VERSION_ENV_KEY);
    if (envValue !== null) {
      const version = envValue.trim();
      if (version.length === 0) {
        warnings.push(`.env 中的 ${PROOF_FILE_VERSION_ENV_KEY} 为空，已忽略该来源。`);
      } else {
        return { version, source: 'env', warnings };
      }
    }
  }

  const fallback = (message) => {
    warnings.push(
      `${message}，使用默认 proofFileVersion=${DEFAULT_PROOF_FILE_VERSION}。`
    );
    return { version: DEFAULT_PROOF_FILE_VERSION, source: 'default', warnings };
  };

  if (!config || config.ok !== true) {
    return fallback(describeConfigFailure(config));
  }

  const value = config.value.proofFileVersion;
  if (value === undefined || value === null) {
    return fallback(`${DEVELOPER_CONFIG_FILE} 缺少 proofFileVersion`);
  }
  if (typeof value !== 'string') {
    return fallback(`${DEVELOPER_CONFIG_FILE} 的 proofFileVersion 必须是字符串`);
  }
  const version = value.trim();
  if (version.length === 0) {
    return fallback(`${DEVELOPER_CONFIG_FILE} 的 proofFileVersion 为空`);
  }
  return { version, source: 'file', warnings };
}

/**
 * Section 6.7: `proofFileHeader` resolves from `.env` > `config.mjs`
 * > empty string. Missing, non-string or empty values warn and fall back to an
 * omitted header paragraph.
 */
function resolveProofFileHeader({ envText = null, config = null } = {}) {
  const warnings = [];

  if (typeof envText === 'string') {
    const envValue = parseEnvValue(envText, PROOF_FILE_HEADER_ENV_KEY);
    if (envValue !== null) {
      if (envValue.trim().length === 0) {
        warnings.push(`.env 中的 ${PROOF_FILE_HEADER_ENV_KEY} 为空，已忽略该来源。`);
      } else {
        return { header: envValue, source: 'env', warnings };
      }
    }
  }

  const fallback = (message) => {
    warnings.push(`${message}，证明文件不写头部说明。`);
    return { header: DEFAULT_PROOF_FILE_HEADER, source: 'default', warnings };
  };

  if (!config || config.ok !== true) {
    return fallback(describeConfigFailure(config));
  }

  const value = config.value.proofFileHeader;
  if (value === undefined || value === null) {
    return fallback(`${DEVELOPER_CONFIG_FILE} 缺少 proofFileHeader`);
  }
  if (typeof value !== 'string') {
    return fallback(`${DEVELOPER_CONFIG_FILE} 的 proofFileHeader 必须是字符串`);
  }
  if (value.trim().length === 0) {
    return fallback(`${DEVELOPER_CONFIG_FILE} 的 proofFileHeader 为空`);
  }
  return { header: value, source: 'file', warnings };
}

/**
 * Section 6.7: `oauthClientId` resolves from `.env` > `config.mjs` > empty.
 * Unlike the other fields, an empty value is legal (no OAuth App registered
 * yet) and never warns; only a non-string value falls back with a warning.
 */
function resolveOAuthClientId({ envText = null, config = null } = {}) {
  const warnings = [];

  if (typeof envText === 'string') {
    const envValue = parseEnvValue(envText, OAUTH_CLIENT_ID_ENV_KEY);
    if (envValue !== null) {
      const clientId = envValue.trim();
      if (clientId.length > 0) {
        return { clientId, source: 'env', warnings };
      }
    }
  }

  const fallback = (message) => {
    warnings.push(`${message}，使用空 oauthClientId。`);
    return { clientId: DEFAULT_OAUTH_CLIENT_ID, source: 'default', warnings };
  };

  if (!config || config.ok !== true) {
    return fallback(describeConfigFailure(config));
  }

  const value = config.value.oauthClientId;
  if (value === undefined || value === null) {
    return fallback(`${DEVELOPER_CONFIG_FILE} 缺少 oauthClientId`);
  }
  if (typeof value !== 'string') {
    return fallback(`${DEVELOPER_CONFIG_FILE} 的 oauthClientId 必须是字符串`);
  }
  return { clientId: value.trim(), source: 'file', warnings };
}

/**
 * Section 7.8: the proof file uses a standalone `---` line as the separator
 * before the proof blocks, and the header copy is written above it. A
 * standalone `---` inside the header would make that boundary ambiguous for
 * the checker, so the build rejects it. Quoted `> ---` lines are not
 * separators and stay allowed.
 *
 * Returns the 1-based line number of the first offending line, or `null`.
 */
function findStandaloneSeparatorLine(header) {
  if (typeof header !== 'string') {
    return null;
  }
  const lines = header.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].trim() === '---') {
      return index + 1;
    }
  }
  return null;
}

module.exports = {
  DEFAULT_RELEASE_COMMIT,
  DEFAULT_PROOF_FILE_VERSION,
  DEFAULT_PROOF_FILE_HEADER,
  DEFAULT_OAUTH_CLIENT_ID,
  DEVELOPER_CONFIG_FILE,
  RELEASE_COMMIT_ENV_KEY,
  PROOF_FILE_VERSION_ENV_KEY,
  PROOF_FILE_HEADER_ENV_KEY,
  OAUTH_CLIENT_ID_ENV_KEY,
  RELEASE_COMMIT_PATTERN,
  validateReleaseCommit,
  parseEnvValue,
  loadDeveloperConfig,
  resolveReleaseCommit,
  resolveProofFileVersion,
  resolveProofFileHeader,
  resolveOAuthClientId,
  findStandaloneSeparatorLine
};
