const { pathToFileURL } = require('node:url');
const { resolve } = require('node:path');

const DEFAULT_RELEASE_BRANCH = 'main';
const DEFAULT_PROOF_FILE_VERSION = '0';
const DEFAULT_PROOF_FILE_HEADER = '';
const DEVELOPER_CONFIG_FILE = 'config.mjs';
const RELEASE_BRANCH_ENV_KEY = 'IDEAHUB_RELEASE_BRANCH';
const PROOF_FILE_VERSION_ENV_KEY = 'IDEAHUB_PROOF_FILE_VERSION';
const PROOF_FILE_HEADER_ENV_KEY = 'IDEAHUB_PROOF_FILE_HEADER';
const MAX_REF_LENGTH = 120;
const INVALID_REF_CHARS = new Set([' ', '~', '^', ':', '?', '*', '[', '\\']);

function findRefProblem(name) {
  if (name.length === 0) {
    return 'empty';
  }
  if (name.length > MAX_REF_LENGTH) {
    return 'too-long';
  }
  const hasInvalidChar = [...name].some((char) => {
    const code = char.charCodeAt(0);
    return code <= 0x1f || code === 0x7f || /\s/.test(char) || INVALID_REF_CHARS.has(char);
  });
  if (hasInvalidChar) {
    return 'invalid-char';
  }
  if (name.startsWith('.') || name.startsWith('/')) {
    return 'leading';
  }
  if (name.endsWith('.') || name.endsWith('/')) {
    return 'trailing';
  }
  if (name.startsWith('-') || name === 'HEAD') {
    return 'leading-dash';
  }
  if (name.includes('..')) {
    return 'dot-dot';
  }
  if (name.includes('@{')) {
    return 'at-brace';
  }
  if (name.includes('//')) {
    return 'double-slash';
  }
  if (name.split('/').some((segment) => segment.endsWith('.lock'))) {
    return 'lock';
  }
  return null;
}

const PROBLEM_MESSAGES = {
  empty: 'release 分支名为空',
  'too-long': `release 分支名超过 ${MAX_REF_LENGTH} 个字符`,
  'invalid-char': 'release 分支名含 Git 不允许的字符（空格、~ ^ : ? * [ \\ 或控制字符）',
  leading: 'release 分支名不能以 "." 或 "/" 开头',
  trailing: 'release 分支名不能以 "." 或 "/" 结尾',
  'leading-dash': 'release 分支名不能以 "-" 开头或命名为 "HEAD"',
  'dot-dot': 'release 分支名不能包含连续的 ".."',
  'at-brace': 'release 分支名不能包含 "@{"',
  'double-slash': 'release 分支名不能包含连续的斜杠',
  lock: 'release 分支名分段不能以 ".lock" 结尾'
};

function validateBranchName(branch) {
  const problem = findRefProblem(branch);
  return problem ? PROBLEM_MESSAGES[problem] : null;
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
function resolveReleaseBranch({ envText = null, config = null } = {}) {
  const warnings = [];

  if (typeof envText === 'string') {
    const envBranch = parseEnvValue(envText, RELEASE_BRANCH_ENV_KEY);
    if (envBranch !== null) {
      const branch = envBranch.trim();
      if (branch.length === 0) {
        warnings.push(`.env 中的 ${RELEASE_BRANCH_ENV_KEY} 为空，已忽略该来源。`);
      } else {
        const error = validateBranchName(branch);
        if (!error) {
          return { branch, source: 'env', warnings };
        }
        warnings.push(`.env 中的 ${RELEASE_BRANCH_ENV_KEY} 无效：${error}`);
      }
    }
  }

  if (!config || config.ok !== true) {
    warnings.push(
      `${describeConfigFailure(config)}，使用默认 releaseBranch=${DEFAULT_RELEASE_BRANCH}。`
    );
    return { branch: DEFAULT_RELEASE_BRANCH, source: 'default', warnings };
  }

  const value = config.value.releaseBranch;
  if (value === undefined || value === null) {
    warnings.push(
      `${DEVELOPER_CONFIG_FILE} 缺少 releaseBranch，使用默认 releaseBranch=${DEFAULT_RELEASE_BRANCH}。`
    );
    return { branch: DEFAULT_RELEASE_BRANCH, source: 'default', warnings };
  }
  if (typeof value !== 'string') {
    warnings.push(
      `${DEVELOPER_CONFIG_FILE} 的 releaseBranch 必须是字符串，使用默认 releaseBranch=${DEFAULT_RELEASE_BRANCH}。`
    );
    return { branch: DEFAULT_RELEASE_BRANCH, source: 'default', warnings };
  }

  const branch = value.trim();
  const error = validateBranchName(branch);
  if (error) {
    warnings.push(
      `${DEVELOPER_CONFIG_FILE} 的 releaseBranch 无效：${error}，使用默认 releaseBranch=${DEFAULT_RELEASE_BRANCH}。`
    );
    return { branch: DEFAULT_RELEASE_BRANCH, source: 'default', warnings };
  }

  return { branch, source: 'file', warnings };
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
  DEFAULT_RELEASE_BRANCH,
  DEFAULT_PROOF_FILE_VERSION,
  DEFAULT_PROOF_FILE_HEADER,
  DEVELOPER_CONFIG_FILE,
  RELEASE_BRANCH_ENV_KEY,
  PROOF_FILE_VERSION_ENV_KEY,
  PROOF_FILE_HEADER_ENV_KEY,
  validateBranchName,
  parseEnvValue,
  loadDeveloperConfig,
  resolveReleaseBranch,
  resolveProofFileVersion,
  resolveProofFileHeader,
  findStandaloneSeparatorLine
};
