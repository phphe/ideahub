const DEFAULT_RELEASE_BRANCH = 'main';
const RELEASE_CONFIG_FILE = 'ideahub.config.json';
const RELEASE_BRANCH_ENV_KEY = 'IDEAHUB_RELEASE_BRANCH';
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

/**
 * Pure build-time resolver. Callers pass file contents explicitly; nothing is
 * read from an end user's workspace at runtime.
 */
function resolveReleaseBranch({ envText = null, configText = null } = {}) {
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

  if (typeof configText !== 'string') {
    warnings.push(
      `未找到 ${RELEASE_CONFIG_FILE}，使用默认 releaseBranch=${DEFAULT_RELEASE_BRANCH}。`
    );
    return { branch: DEFAULT_RELEASE_BRANCH, source: 'default', warnings };
  }

  let parsed;
  try {
    parsed = JSON.parse(configText);
  } catch {
    warnings.push(
      `${RELEASE_CONFIG_FILE} 不是有效的 JSON，使用默认 releaseBranch=${DEFAULT_RELEASE_BRANCH}。`
    );
    return { branch: DEFAULT_RELEASE_BRANCH, source: 'default', warnings };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    warnings.push(
      `${RELEASE_CONFIG_FILE} 顶层必须是对象，使用默认 releaseBranch=${DEFAULT_RELEASE_BRANCH}。`
    );
    return { branch: DEFAULT_RELEASE_BRANCH, source: 'default', warnings };
  }

  const value = parsed.releaseBranch;
  if (value === undefined || value === null) {
    warnings.push(
      `${RELEASE_CONFIG_FILE} 缺少 releaseBranch，使用默认 releaseBranch=${DEFAULT_RELEASE_BRANCH}。`
    );
    return { branch: DEFAULT_RELEASE_BRANCH, source: 'default', warnings };
  }
  if (typeof value !== 'string') {
    warnings.push(
      `${RELEASE_CONFIG_FILE} 的 releaseBranch 必须是字符串，使用默认 releaseBranch=${DEFAULT_RELEASE_BRANCH}。`
    );
    return { branch: DEFAULT_RELEASE_BRANCH, source: 'default', warnings };
  }

  const branch = value.trim();
  const error = validateBranchName(branch);
  if (error) {
    warnings.push(
      `${RELEASE_CONFIG_FILE} 的 releaseBranch 无效：${error}，使用默认 releaseBranch=${DEFAULT_RELEASE_BRANCH}。`
    );
    return { branch: DEFAULT_RELEASE_BRANCH, source: 'default', warnings };
  }

  return { branch, source: 'file', warnings };
}

module.exports = {
  DEFAULT_RELEASE_BRANCH,
  RELEASE_CONFIG_FILE,
  RELEASE_BRANCH_ENV_KEY,
  validateBranchName,
  parseEnvValue,
  resolveReleaseBranch
};
