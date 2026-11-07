import { findFrontMatter } from './front-matter';
import { MARKER_PATTERN } from './ideas';
import { parseMarkerTime } from './proof-time';

export interface ProofBlockSource {
  time: string | null;
  /** Original `###### \`Proof: ... [ideahub]\`` line. */
  markerLine: string;
  /** Text sealed by this proof marker (written before it), plus trailing metadata. */
  rawText: string;
}

/**
 * Section 7.8: split `ideas.md` into proof blocks, ignoring front matter.
 * A proof marker seals the text *before* it (7.1), so each block's raw text is
 * the buffer accumulated since the previous proof marker. Trailing content
 * after the last proof marker (the `Published:` metadata written by publish)
 * is attached to the last block; it never affects the hash because 7.2
 * excludes `Published:` lines.
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
    // `Published:` markers stay in the buffer: metadata excluded from the
    // hash but required in the proof file.
    buffer.push(lines[index]);
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

export interface ProofFileBlock {
  time: string | null;
  markerLine: string;
  /** Text with `🔏` already inserted, blank lines preserved. */
  text: string;
  files: Record<string, string>;
  externalLinks: string[];
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

/**
 * Section 7.8: proof file content. All copy added by the extension is
 * English; front matter only contains `version: "0"`.
 */
export function renderProofFile(project: string, blocks: ProofFileBlock[]): string {
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

  const header = [
    '---',
    'version: "0"',
    '---',
    '',
    `# Ideas Proof — ${project}`,
    '',
    `This file is the IdeaHub proof file for the project \`${project}\`. It was generated from the author's \`ideas.md\` when the project was published and lists every recorded proof in chronological order. Each block keeps the original proof marker, the sealed text and the referenced project files so the history can be verified later. Links and images that point to files inside this project are prefixed with ${EMOJI_LIST_MARK}.`,
    '',
    `- Time span: \`${span}\``,
    `- Proofs: ${ordered.length}`,
    `- Referenced files: ${fileSet.size}`,
    `- External links (unique): ${externalSet.size}`,
    '',
    '> **Do not trust this file directly.** A proof file can be edited after it is published. Only treat a proof as valid when this command verifies the whole file against the immutable releases:',
    '>',
    '> `npx ideahub check <project-url>`',
    '>',
    '> If the command does not pass, the content may have been modified.',
    ''
  ].join('\n');

  const body = ordered
    .map((block) => {
      const text = trimBlock(block.text);
      return text.length > 0 ? `${block.markerLine}\n\n${text}` : block.markerLine;
    })
    .join('\n\n');

  return `${header}\n${body}\n`;
}

const EMOJI_LIST_MARK = '🔏';

/** Trims the block ends while preserving blank lines inside the block. */
function trimBlock(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(/^\s*\n|\n\s*$/g, '').trim();
}
