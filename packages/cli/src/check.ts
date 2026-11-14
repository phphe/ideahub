import {
  computeFingerprintWith,
  normalizeReferenceTarget,
  parseMarkerTime,
  PROOF_FILE_VERSION,
  RESERVED_CHAR,
  scanReferences,
  type BlobResolution
} from '@ideahub/core';
import { ApiError, CliGitHub, RateLimitError, type ReleaseInfo, type TreeEntry } from './api';
import { parseProofFile } from './proof';
import { parseProjectUrl, resolveBranch } from './url';

export type CheckStatus = 'PASS' | 'FAIL' | 'ERROR';

export interface CheckResult {
  status: CheckStatus;
  messages: string[];
  /** Human-readable context printed for a PASS. */
  detail?: string;
}

export interface CheckOptions {
  input: string;
  token: string | null;
  fetchImpl?: typeof fetch;
}

const ONE_HOUR_MS = 60 * 60 * 1000;

export async function runCheck(options: CheckOptions): Promise<CheckResult> {
  const parsedUrl = parseProjectUrl(options.input);
  if (!parsedUrl.ok) {
    return { status: 'ERROR', messages: [parsedUrl.message] };
  }
  const { owner, repo, segments } = parsedUrl.value;
  const api = new CliGitHub(options.token, options.fetchImpl ?? fetch);

  try {
    const repository = await api.getRepository(owner, repo);
    if (!repository) {
      return {
        status: 'ERROR',
        messages: [`仓库不存在或为私有仓库：${owner}/${repo}。如为私有仓库，请先执行 ideahub login。`]
      };
    }

    const branches = await api.listBranches(owner, repo);
    const resolved = resolveBranch(segments, branches);
    if (!resolved) {
      return {
        status: 'ERROR',
        messages: [
          `无法从地址中确定分支：${segments.join('/')}。请确认地址中的分支已存在于远程仓库。`
        ]
      };
    }
    const { branch } = resolved;
    const projectPath = resolved.projectSegments.join('/');
    const projectName = resolved.projectSegments[resolved.projectSegments.length - 1];
    const location = `${owner}/${repo}@${branch}/${projectPath}`;

    const readme = await api.getRawFile(owner, repo, branch, `${projectPath}/README.md`);
    if (readme === null) {
      return {
        status: 'ERROR',
        messages: [`未找到证明文件：${location}/README.md`]
      };
    }

    const structure = parseProofFile(readme);
    const structuralFailures = structure.problems.filter((problem) => problem.severity === 'FAIL');
    if (structuralFailures.length > 0) {
      return { status: 'FAIL', messages: structuralFailures.map((problem) => problem.message) };
    }
    if (structure.version !== PROOF_FILE_VERSION) {
      return {
        status: 'ERROR',
        messages: [
          `不认识的证明文件 version：${structure.version ?? '缺失'}（当前支持 ${PROOF_FILE_VERSION}）。`
        ]
      };
    }

    const headSha = await api.getBranchHeadSha(owner, repo, branch);
    if (!headSha) {
      return { status: 'ERROR', messages: [`无法读取分支最新提交：${owner}/${repo}@${branch}`] };
    }

    const tree = await api.getTreeRecursive(owner, repo, headSha);
    if (tree.truncated) {
      return {
        status: 'ERROR',
        messages: ['仓库文件树过大，GitHub 返回 truncated: true，无法完整校验。']
      };
    }

    const projectPrefix = `${projectPath}/`;
    const folder = tree.entries.find(
      (entry) => entry.path === projectPath && entry.type === 'tree'
    );
    if (!folder) {
      return { status: 'ERROR', messages: [`已发布内容中找不到项目目录：${location}`] };
    }

    const byPath = new Map<string, TreeEntry>();
    const byLowerPath = new Map<string, TreeEntry>();
    for (const entry of tree.entries) {
      if (!entry.path.startsWith(projectPrefix)) {
        continue;
      }
      const relative = entry.path.slice(projectPrefix.length);
      byPath.set(relative, entry);
      byLowerPath.set(relative.toLowerCase(), entry);
    }

    const lfs = await findLfsAttributes(api, owner, repo, branch, projectPath);
    if (lfs) {
      return {
        status: 'FAIL',
        messages: [
          `项目使用 Git LFS（${lfs}），其中的文件无法纳入证明与校验范围。`
        ]
      };
    }

    const releases = await api.listReleases(owner, repo);
    const releaseByTag = new Map<string, ReleaseInfo>();
    for (const release of releases) {
      if (release.tagName) {
        releaseByTag.set(release.tagName, release);
      }
    }

    const resolveBlob = async (relative: string): Promise<BlobResolution> => {
      const entry = byPath.get(relative) ?? byLowerPath.get(relative.toLowerCase());
      if (!entry) {
        return {
          ok: false,
          code: 'missing-file',
          message: `引用的文件在已发布内容中不存在：${relative}`
        };
      }
      if (entry.type !== 'blob') {
        return {
          ok: false,
          code: 'directory',
          message: `引用指向目录而不是文件：${relative}`
        };
      }
      return { ok: true, blob: entry.sha };
    };

    const failures: string[] = [];
    for (const block of structure.blocks) {
      const problems = checkReservedChars(block.text);
      if (problems.length > 0) {
        failures.push(...problems.map((problem) => `${block.timeText ?? '未知时间'}：${problem}`));
        continue;
      }

      const marker = parseMarkerTime(block.timeText);
      if (!marker) {
        return {
          status: 'ERROR',
          messages: [`无法解析证明标记的时间：${block.timeText ?? '缺失'}`]
        };
      }

      const fingerprint = await computeFingerprintWith({
        project: projectName,
        text: block.text,
        resolveBlob
      });
      if (!fingerprint.ok) {
        failures.push(`${block.timeText}：${fingerprint.message}`);
        continue;
      }

      const tag = `ideahub-${fingerprint.hash}`;
      const release = releaseByTag.get(tag);
      if (!release) {
        failures.push(`${block.timeText}：远程不存在对应 tag 的不可变 Release（${tag}）。`);
        continue;
      }
      if (release.immutable === false) {
        failures.push(`${block.timeText}：对应的 Release 不是不可变 Release。`);
        continue;
      }
      if (release.immutable !== true) {
        return {
          status: 'ERROR',
          messages: [
            `${block.timeText}：Release 未返回 immutable 字段，无法确认其不可变性。`
          ]
        };
      }

      const published = release.publishedAt ? Date.parse(release.publishedAt) : NaN;
      if (Number.isNaN(published)) {
        return {
          status: 'ERROR',
          messages: [`${block.timeText}：Release 缺少可用的发布时间（published_at）。`]
        };
      }
      if (Math.abs(published - marker.instant.getTime()) > ONE_HOUR_MS) {
        failures.push(
          `${block.timeText}：标记时间与 Release 发布时间相差超过 1 小时（发布：${release.publishedAt}）。`
        );
      }
    }

    if (failures.length > 0) {
      return { status: 'FAIL', messages: failures };
    }

    return {
      status: 'PASS',
      messages: [],
      detail: `已校验 ${structure.blocks.length} 个证明块：${location}（commit ${headSha.slice(0, 7)}）`
    };
  } catch (error) {
    if (error instanceof RateLimitError) {
      return { status: 'ERROR', messages: [error.message] };
    }
    if (error instanceof ApiError) {
      return { status: 'ERROR', messages: [error.message] };
    }
    return {
      status: 'ERROR',
      messages: [error instanceof Error ? error.message : String(error)]
    };
  }
}

/**
 * Section 13.4: `🔏` may only precede a project-internal reference. The block
 * text no longer contains the marker line, so any other occurrence is forgery.
 */
function checkReservedChars(text: string): string[] {
  const problems: string[] = [];
  const internalIndexes = new Set<number>();
  for (const reference of scanReferences(text)) {
    const normalized = normalizeReferenceTarget(reference.target);
    if (normalized.kind === 'internal') {
      internalIndexes.add(reference.index);
      // `🔏` is an astral character (two UTF-16 code units), so compare with
      // `slice` rather than a single `charAt`/index lookup.
      const prefix = text.slice(reference.index - RESERVED_CHAR.length, reference.index);
      if (prefix !== RESERVED_CHAR) {
        problems.push(`项目内文件引用前缺少 ${RESERVED_CHAR}：${reference.target}`);
      }
    }
  }

  let index = text.indexOf(RESERVED_CHAR);
  while (index >= 0) {
    if (!internalIndexes.has(index + RESERVED_CHAR.length)) {
      problems.push(`${RESERVED_CHAR} 只允许出现在证明标记或项目内文件引用前。`);
      break;
    }
    index = text.indexOf(RESERVED_CHAR, index + RESERVED_CHAR.length);
  }
  return problems;
}

async function findLfsAttributes(
  api: CliGitHub,
  owner: string,
  repo: string,
  branch: string,
  projectPath: string
): Promise<string | null> {
  const attributes = await api.getRawFile(
    owner,
    repo,
    branch,
    `${projectPath}/.gitattributes`
  );
  if (attributes === null) {
    return null;
  }
  const line = attributes
    .split(/\r?\n/)
    .find((entry) => /filter\s*=\s*lfs/i.test(entry));
  return line ? line.trim() : null;
}
