import { createHash } from 'node:crypto';

export const MARKER_PATTERN = /^\s*<!--ideahub id:([0-9a-f]{64})-->\s*$/;

export interface ParsedMarker {
  id: string;
  line: number;
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
 */
export function appendMarker(text: string, hash: string): string {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const marker = `<!--ideahub id:${hash}-->`;
  if (text.length === 0) {
    return `${marker}${eol}`;
  }
  const needsNewline = !text.endsWith('\n') && !text.endsWith('\r');
  return `${text}${needsNewline ? eol : ''}${marker}${eol}`;
}
