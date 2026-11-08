import { findFrontMatter } from './front-matter';
import { MARKER_PATTERN } from './ideas';
import { parseMarkerTime } from './proof-time';
import { PROOF_FILE_HEADER, PROOF_FILE_VERSION } from './release-config';

/**
 * Section 7.8: markers inside the generated proof file use 2 `#`, while
 * `ideas.md` markers stay at 6 `#` (see `MARKER_PATTERN`). The checker side
 * reads proof files with this pattern only.
 */
export const PROOF_FILE_MARKER_PATTERN = /^## `Proof:\s*(.+?)\s*\[ideahub\]`[ \t]*$/;

export interface ProofBlockSource {
  time: string | null;
  /** Original `###### \`Proof: ... [ideahub]\`` line. */
  markerLine: string;
  /** Text sealed by this proof marker (written before it). */
  rawText: string;
}

/**
 * Section 7.8: split `ideas.md` into proof blocks, ignoring front matter.
 * A proof marker seals the text *before* it (7.1), so each block's raw text is
 * the buffer accumulated since the previous proof marker. `Published:` marker
 * lines are metadata: they never reach the proof file and never affect the
 * hash (7.2 already excluded them).
 */
export function extractProofBlocks(text: string): ProofBlockSource[] {
  const lines = text.split(/\r?\n/);
  const frontMatter = findFrontMatter(text);
  const blocks: Array<{ time: string | null; markerLine: string; lines: string[] }> = [];
  let buffer: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    if (frontMatter && index >= frontMatter.startLine && index <= frontMatter.endLine) {
      continue;
    }
    const match = MARKER_PATTERN.exec(lines[index]);
    if (!match) {
      buffer.push(lines[index]);
      continue;
    }
    const time = match[2].trim() || null;
    if (match[1] === 'Proof') {
      blocks.push({ time, markerLine: lines[index], lines: buffer });
      buffer = [];
      continue;
    }
    // `Published:` markers are metadata: they stay in `ideas.md` but are never
    // copied into the proof file.
    continue;
  }

  if (blocks.length > 0 && buffer.length > 0) {
    blocks[blocks.length - 1].lines.push(...buffer);
  }

  return blocks.map((block) => ({
    time: block.time,
    markerLine: block.markerLine,
    rawText: block.lines.join('\n')
  }));
}

/** Section 7.8: ascending proof time; ties keep the original order. */
export function sortProofBlocks<T extends { time: string | null }>(blocks: T[]): T[] {
  return blocks
    .map((block, index) => ({ block, index }))
    .sort((left, right) => {
      const leftTime = parseMarkerTime(left.block.time)?.instant.getTime() ?? Infinity;
      const rightTime = parseMarkerTime(right.block.time)?.instant.getTime() ?? Infinity;
      if (leftTime !== rightTime) {
        return leftTime - rightTime;
      }
      return left.index - right.index;
    })
    .map((entry) => entry.block);
}

export interface ProofFileBlock {
  time: string | null;
  markerLine: string;
  /** Text with `🔏` already inserted, blank lines preserved. */
  text: string;
  files: Record<string, string>;
  externalLinks: string[];
}

/**
 * Section 7.8: developer-configurable proof file version and header copy.
 * Defaults come from 6.7 (`proofFileVersion` / `proofFileHeader`).
 */
export interface ProofFileOptions {
  version?: string;
  header?: string;
}

/**
 * Section 7.8: proof file content. Front matter carries the configured
 * version; the configured header copy (with `<project-url>` replaced by the
 * project's real remote URL) is followed by the stats list and a `---`
 * separator. Proof markers use 2 `#` here; `Published:` lines never appear.
 */
export function renderProofFile(
  blocks: ProofFileBlock[],
  projectUrl: string,
  options: ProofFileOptions = {}
): string {
  const version = options.version ?? PROOF_FILE_VERSION;
  const configuredHeader = options.header ?? PROOF_FILE_HEADER;

  const ordered = sortProofBlocks(blocks);
  const fileSet = new Set<string>();
  const externalSet = new Set<string>();
  for (const block of ordered) {
    for (const key of Object.keys(block.files)) {
      fileSet.add(key);
    }
    for (const link of block.externalLinks) {
      externalSet.add(link);
    }
  }

  const first = ordered[0]?.time ?? 'Unknown';
  const last = ordered[ordered.length - 1]?.time ?? 'Unknown';
  const span = ordered.length === 0 ? 'No proofs recorded' : `${first} → ${last}`;

  const parts: string[] = ['---', `version: ${JSON.stringify(version)}`, '---', ''];

  const header = configuredHeader
    .replace(/\r\n?/g, '\n')
    .split('<project-url>')
    .join(projectUrl)
    .trim();
  if (header.length > 0) {
    parts.push(header, '');
  }

  parts.push(
    `- Time span: \`${span}\``,
    `- Proofs: ${ordered.length}`,
    `- Referenced files: ${fileSet.size}`,
    `- External links (unique): ${externalSet.size}`,
    '',
    '---',
    ''
  );

  const body = ordered
    .map((block) => {
      const markerLine = toProofFileMarker(block.markerLine);
      const text = trimBlock(block.text);
      return text.length > 0 ? `${markerLine}\n\n${text}` : markerLine;
    })
    .join('\n\n');

  if (body.length > 0) {
    parts.push(body, '');
  }

  return parts.join('\n');
}

/** Section 7.8: proof-file markers are 2 `#`; `ideas.md` keeps 6 `#`. */
function toProofFileMarker(markerLine: string): string {
  return markerLine.replace(/^###### /, '## ');
}

/** Trims the block ends while preserving blank lines inside the block. */
function trimBlock(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(/^\s*\n|\n\s*$/g, '').trim();
}
