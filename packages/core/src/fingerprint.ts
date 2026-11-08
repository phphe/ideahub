import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { runGit } from './git';

/** Section 7.3: reserved character inserted by the extension, never by users. */
export const RESERVED_CHAR = '🔏';

/** Section 7.2: `Published:` markers are metadata and never enter the hash. */
const PUBLISHED_MARKER_PATTERN =
  /^###### `Published:\s*(.+?)\s*\[ideahub\]`[ \t]*$/;

export type FingerprintErrorCode =
  | 'reserved-char'
  | 'external-image'
  | 'outside-project'
  | 'outside-repo'
  | 'missing-file'
  | 'directory'
  | 'git-missing'
  | 'git-failed';

export interface FingerprintFailure {
  ok: false;
  code: FingerprintErrorCode;
  message: string;
}

export interface FingerprintSuccess {
  ok: true;
  hash: string;
  /** Original text with `🔏` inserted, blank lines preserved (7.8 blocks). */
  text: string;
  /** Normalised text that actually entered the canonical JSON. */
  normalizedText: string;
  /** Project-relative path (forward slashes) → Git blob SHA-1. */
  files: Record<string, string>;
  /** Unique external links found in the text. */
  externalLinks: string[];
}

export type FingerprintResult = FingerprintSuccess | FingerprintFailure;

export interface FingerprintInput {
  project: string;
  /** Text to prove, i.e. the block between two markers. */
  text: string;
  projectDir: string;
  repoRoot: string;
}

/**
 * Section 7.2: the single normalisation shared by proof-time hashing,
 * pre-publish recomputation, proof-file generation and external checkers.
 * The remote side must NOT insert emoji again; it only applies this step.
 */
export function normalizeProofText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter((line) => line.trim().length > 0 && !PUBLISHED_MARKER_PATTERN.test(line))
    .join('\n')
    .trim();
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * Section 7.3: canonical JSON — key order `project`, `text`, `files`;
 * `files` keys sorted ascending; compact serialisation.
 */
export function canonicalFingerprintJson(
  project: string,
  text: string,
  files: Record<string, string>
): string {
  const keys = Object.keys(files).sort();
  const entries = keys
    .map((key) => `${JSON.stringify(key)}:${JSON.stringify(files[key])}`)
    .join(',');
  return `{"project":${JSON.stringify(project)},"text":${JSON.stringify(text)},"files":{${entries}}}`;
}

export function buildFingerprint(input: FingerprintInput): Promise<FingerprintResult> {
  return fingerprint(input);
}

async function fingerprint(input: FingerprintInput): Promise<FingerprintResult> {
  if (input.text.includes(RESERVED_CHAR)) {
    return fail(
      'reserved-char',
      `原文包含保留字符 ${RESERVED_CHAR}，无法生成证明。请删除该字符后重试。`
    );
  }

  const references = scanReferences(input.text);
  const spans: Array<{ index: number; target: string; isImage: boolean }> = [];
  const files: Record<string, string> = {};
  const externalLinks = new Set<string>();
  const classified = new Map<string, Classification>();

  for (const reference of references) {
    const cacheKey = `${reference.isImage ? 'img' : 'link'}\u0000${reference.target}`;
    let classification = classified.get(cacheKey);
    if (!classification) {
      classification = await classifyReference(reference.target, input);
      classified.set(cacheKey, classification);
    }
    if (classification.kind === 'error') {
      return classification.failure;
    }
    if (classification.kind === 'external') {
      if (reference.isImage) {
        return fail(
          'external-image',
          `不支持外部图片：${reference.target}。请改为项目内的相对路径图片。`
        );
      }
      externalLinks.add(reference.target);
      continue;
    }
    if (classification.kind === 'internal') {
      files[classification.relative] = classification.blob;
      spans.push({ index: reference.index, target: reference.target, isImage: reference.isImage });
    }
  }

  const text = insertReservedChar(input.text, spans);
  const normalizedText = normalizeProofText(text);
  const sortedFiles: Record<string, string> = {};
  for (const key of Object.keys(files).sort()) {
    sortedFiles[key] = files[key];
  }
  const hash = sha256Hex(canonicalFingerprintJson(input.project, normalizedText, sortedFiles));

  return {
    ok: true,
    hash,
    text,
    normalizedText,
    files: sortedFiles,
    externalLinks: [...externalLinks].sort()
  };
}

function fail(code: FingerprintErrorCode, message: string): FingerprintFailure {
  return { ok: false, code, message };
}

function insertReservedChar(
  text: string,
  spans: Array<{ index: number; target: string; isImage: boolean }>
): string {
  if (spans.length === 0) {
    return text;
  }
  const unique = new Map<number, (typeof spans)[number]>();
  for (const span of spans) {
    if (!unique.has(span.index)) {
      unique.set(span.index, span);
    }
  }
  const ordered = [...unique.values()].sort((a, b) => a.index - b.index);
  let result = '';
  let cursor = 0;
  for (const span of ordered) {
    result += text.slice(cursor, span.index);
    result += RESERVED_CHAR;
    cursor = span.index;
  }
  result += text.slice(cursor);
  return result;
}

interface ReferenceHit {
  index: number;
  target: string;
  isImage: boolean;
}

interface InternalClassification {
  kind: 'internal';
  relative: string;
  blob: string;
}

type Classification =
  | InternalClassification
  | { kind: 'external' }
  | { kind: 'skip' }
  | { kind: 'error'; failure: FingerprintFailure };

const INLINE_IMAGE_PATTERN =
  /!\[[^\]\n]*\]\(\s*(<[^>\n]*>|[^)\s]+)(?:\s+(?:"[^"\n]*"|'[^'\n]*'|\([^)\n]*\)))?\s*\)/g;
const INLINE_LINK_PATTERN =
  /(?<!!)\[[^\]\n]*\]\(\s*(<[^>\n]*>|[^)\s]+)(?:\s+(?:"[^"\n]*"|'[^'\n]*'|\([^)\n]*\)))?\s*\)/g;
const REFERENCE_USAGE_PATTERN = /(?<!!)\[([^\]\n]*)\]\[([^\]\n]*)\]/g;
const REFERENCE_DEFINITION_PATTERN = /^[ \t]{0,3}\[([^\]\n]+)\]:[ \t]*(<[^>\n]+>|[^\s\n]+)/gm;
const HTML_IMG_PATTERN = /<img\b[^>\n]*>/gi;
const HTML_A_PATTERN = /<a\b[^>\n]*>/gi;

function scanReferences(text: string): ReferenceHit[] {
  const hits: ReferenceHit[] = [];
  const definitions = new Map<string, string>();

  for (const match of text.matchAll(REFERENCE_DEFINITION_PATTERN)) {
    const id = match[1].trim().toLowerCase();
    if (id && !definitions.has(id)) {
      definitions.set(id, stripAngle(match[2]));
    }
  }

  for (const match of text.matchAll(INLINE_IMAGE_PATTERN)) {
    hits.push({ index: match.index ?? 0, target: stripAngle(match[1]), isImage: true });
  }
  for (const match of text.matchAll(INLINE_LINK_PATTERN)) {
    hits.push({ index: match.index ?? 0, target: stripAngle(match[1]), isImage: false });
  }
  for (const match of text.matchAll(REFERENCE_USAGE_PATTERN)) {
    const label = match[2].trim() || match[1].trim();
    const target = definitions.get(label.toLowerCase());
    if (target) {
      hits.push({ index: match.index ?? 0, target, isImage: false });
    }
  }
  for (const match of text.matchAll(HTML_IMG_PATTERN)) {
    const src = extractAttribute(match[0], 'src');
    if (src) {
      hits.push({ index: match.index ?? 0, target: src, isImage: true });
    }
  }
  for (const match of text.matchAll(HTML_A_PATTERN)) {
    const href = extractAttribute(match[0], 'href');
    if (href) {
      hits.push({ index: match.index ?? 0, target: href, isImage: false });
    }
  }

  return hits;
}

function stripAngle(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('<') && trimmed.endsWith('>')) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function extractAttribute(tag: string, name: string): string | null {
  const pattern = new RegExp(
    `\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
    'i'
  );
  const match = pattern.exec(tag);
  if (!match) {
    return null;
  }
  return match[1] ?? match[2] ?? match[3] ?? null;
}

function isExternalTarget(target: string): boolean {
  const value = target.trim();
  return value.startsWith('//') || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value);
}

async function classifyReference(
  rawTarget: string,
  input: FingerprintInput
): Promise<Classification> {
  const target = rawTarget.trim();
  if (target.length === 0 || target.startsWith('#')) {
    return { kind: 'skip' };
  }
  if (isExternalTarget(target)) {
    return { kind: 'external' };
  }

  let decoded = target;
  try {
    decoded = decodeURIComponent(target);
  } catch {
    // Keep the original value when percent-encoding is malformed.
  }
  const withoutFragment = decoded.split('#')[0].split('?')[0];
  if (withoutFragment.length === 0) {
    return { kind: 'skip' };
  }
  const cleaned = withoutFragment.replace(/\\/g, '/');
  if (cleaned.startsWith('/') || /^[a-zA-Z]:\//.test(cleaned)) {
    return {
      kind: 'error',
      failure: fail('outside-repo', `不能引用仓库外的路径：${target}。`)
    };
  }

  const relative = path.posix.normalize(cleaned.replace(/^\.\//, ''));
  const absolute = path.resolve(input.projectDir, relative);
  if (!isInside(input.repoRoot, absolute)) {
    return {
      kind: 'error',
      failure: fail('outside-repo', `不能引用仓库外的路径：${target}。`)
    };
  }
  if (!isInside(input.projectDir, absolute)) {
    return {
      kind: 'error',
      failure: fail('outside-project', `不能引用项目外文件：${target}。`)
    };
  }

  let stat;
  try {
    stat = await fs.stat(absolute);
  } catch {
    return {
      kind: 'error',
      failure: fail('missing-file', `引用的文件不存在：${target}。`)
    };
  }
  if (stat.isDirectory()) {
    return {
      kind: 'error',
      failure: fail('directory', `引用指向目录而不是文件：${target}。`)
    };
  }

  const repoRelative = path.relative(input.repoRoot, absolute).replace(/\\/g, '/');
  const blob = await gitBlobSha(input.repoRoot, repoRelative, absolute);
  if (!blob.ok) {
    if (blob.missing) {
      return {
        kind: 'error',
        failure: fail('git-missing', '未找到 git。内容指纹需要 git 计算引用文件的 Blob SHA-1。')
      };
    }
    return {
      kind: 'error',
      failure: fail('git-failed', `读取引用文件的 Git Blob SHA-1 失败：${target}。`)
    };
  }
  return { kind: 'internal', relative, blob: blob.sha };
}

async function gitBlobSha(
  repoRoot: string,
  repoRelative: string,
  absolute: string
): Promise<{ ok: true; sha: string } | { ok: false; missing: boolean }> {
  const result = await runGit(repoRoot, ['hash-object', `--path=${repoRelative}`, absolute]);
  if (result.missing) {
    return { ok: false, missing: true };
  }
  if (result.code !== 0) {
    return { ok: false, missing: false };
  }
  const sha = result.stdout.trim();
  if (!/^[0-9a-f]{40}$/i.test(sha)) {
    return { ok: false, missing: false };
  }
  return { ok: true, sha: sha.toLowerCase() };
}

function isInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  );
}
