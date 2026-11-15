import { findFrontMatter, PROOF_FILE_MARKER_PATTERN } from '@ideahub/core';

/**
 * Section 13.3: proof file structure.
 *
 * The proof file is `front matter` + `header (free-form)` + `standalone ---`
 * + proof blocks. Block boundaries are unambiguous because a user's own text
 * can never contain `🔏`; only generated markers and file references carry it.
 */

export type ProofProblemSeverity = 'FAIL' | 'ERROR';

export interface ProofProblem {
  severity: ProofProblemSeverity;
  message: string;
}

export interface ParsedProofBlock {
  /** Marker line as written, e.g. `## 🔏 \`Proof: ...\``. */
  markerLine: string;
  /** Marker time text, e.g. `2026-11-01 10:00:00 (UTC+08:00)`. */
  timeText: string | null;
  /** Block content, excluding the marker line and the next marker. */
  text: string;
}

export interface ParsedProofFile {
  version: string | null;
  blocks: ParsedProofBlock[];
  problems: ProofProblem[];
}

const SEPARATOR = '---';

function stripScalar(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

export function parseProofFile(text: string): ParsedProofFile {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const problems: ProofProblem[] = [];
  const frontMatter = findFrontMatter(text);

  let version: string | null = null;
  let searchFrom = 0;
  if (!frontMatter) {
    problems.push({ severity: 'FAIL', message: 'The proof file has no front matter.' });
  } else {
    searchFrom = frontMatter.endLine + 1;
    for (let index = frontMatter.startLine + 1; index < frontMatter.endLine; index += 1) {
      const match = /^version\s*:\s*(.*)$/.exec(lines[index]);
      if (match) {
        version = stripScalar(match[1]);
        break;
      }
    }
    if (version === null) {
      problems.push({ severity: 'FAIL', message: 'The proof file front matter has no version.' });
    }
  }

  const markers: Array<{ index: number; match: RegExpExecArray }> = [];
  for (let index = searchFrom; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.startsWith('## 🔏')) {
      const match = PROOF_FILE_MARKER_PATTERN.exec(line);
      if (!match) {
        problems.push({
          severity: 'FAIL',
          message: `Invalid proof marker syntax (line ${index + 1}): ${line}`
        });
        continue;
      }
      markers.push({ index, match });
    }
  }

  if (markers.length === 0) {
    problems.push({ severity: 'FAIL', message: 'The proof file contains no proof blocks (empty proof).' });
    return { version, blocks: [], problems };
  }

  let separatorIndex = -1;
  for (let index = markers[0].index - 1; index >= searchFrom; index -= 1) {
    if (lines[index].trim() === SEPARATOR) {
      separatorIndex = index;
      break;
    }
  }
  if (separatorIndex < 0) {
    problems.push({
      severity: 'FAIL',
      message: 'Could not find the standalone --- line separating the header from the proof blocks.'
    });
  } else {
    for (let index = separatorIndex + 1; index < markers[0].index; index += 1) {
      if (lines[index].trim().length > 0) {
        problems.push({
          severity: 'FAIL',
          message: `Unexpected content between the separator and the first proof marker (line ${index + 1}).`
        });
        break;
      }
    }
  }

  const blocks: ParsedProofBlock[] = markers.map((marker, position) => {
    const end = position + 1 < markers.length ? markers[position + 1].index : lines.length;
    return {
      markerLine: lines[marker.index],
      timeText: marker.match[1].trim() || null,
      text: lines.slice(marker.index + 1, end).join('\n')
    };
  });

  return { version, blocks, problems };
}
