import { createHash } from 'node:crypto';

/** Section 7.1: `<!-- ideahub:<sha256> date=YYYY-MM-DD -->`. */
export const MARKER_PATTERN =
  /^\s*<!--\s*ideahub:([0-9a-f]{64})(?:\s+date=(\d{4}-\d{2}-\d{2}))?\s*-->\s*$/;

export interface ParsedMarker {
  id: string;
  line: number;
  /** Local generation date from `date=`, or null when the field is absent. */
  date: string | null;
  contentHash: string;
  valid: boolean;
}

export interface ParsedIdeas {
  markers: ParsedMarker[];
  /** Raw text after the last marker (or the whole file when there is none). */
  unsealedText: string;
  hasUnsealedContent: boolean;
  /** False when any existing marker no longer matches the content it seals. */
  integrityOk: boolean;
}

/**
 * Implements section 7.2: drop blank/whitespace-only lines, unify newlines,
 * then trim the whole text.
 */
export function normalizeContent(raw: string): string {
  const unified = raw.replace(/\r\n?/g, '\n');
  const lines = unified.split('\n').filter((line) => line.trim().length > 0);
  return lines.join('\n').trim();
}

/**
 * Section 7.3 requires the project folder name and normalized new content.
 * The exact joining format is not specified; a newline separator is used.
 */
export function computeProofHash(projectName: string, content: string): string {
  const normalized = normalizeContent(content);
  return createHash('sha256').update(`${projectName}\n${normalized}`, 'utf8').digest('hex');
}

export function parseIdeas(text: string, projectName: string): ParsedIdeas {
  const unified = text.replace(/\r\n?/g, '\n');
  const lines = unified.split('\n');
  const markers: ParsedMarker[] = [];
  let buffer: string[] = [];

  lines.forEach((line, index) => {
    const match = MARKER_PATTERN.exec(line);
    if (match) {
      const content = buffer.join('\n');
      const contentHash = computeProofHash(projectName, content);
      markers.push({
        id: match[1],
        line: index,
        date: match[2] ?? null,
        contentHash,
        valid: contentHash === match[1]
      });
      buffer = [];
    } else {
      buffer.push(line);
    }
  });

  const unsealedText = buffer.join('\n');
  return {
    markers,
    unsealedText,
    hasUnsealedContent: normalizeContent(unsealedText).length > 0,
    integrityOk: markers.every((marker) => marker.valid)
  };
}

/**
 * Appends the marker after the existing content without rewriting the body.
 * `date` is the local generation date (`YYYY-MM-DD`) and is display-only.
 */
export function appendMarker(text: string, hash: string, date: string): string {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const marker = `<!-- ideahub:${hash} date=${date} -->`;
  if (text.length === 0) {
    return `${marker}${eol}`;
  }
  const needsNewline = !text.endsWith('\n') && !text.endsWith('\r');
  return `${text}${needsNewline ? eol : ''}${marker}${eol}`;
}
