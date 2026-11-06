import { createHash } from 'node:crypto';

export type MarkerKind = 'proof' | 'published';

/**
 * Section 7.1: a marker line must be fully wrapped in backticks, e.g.
 * `` `Proof: ... [ideahub]` ``. Only whitespace may surround the backticks.
 * Lines without backticks are ordinary content and are not recognised.
 */
export const MARKER_PATTERN = /^\s*`(Proof|Published):\s*(.+?)\s*\[ideahub\]`\s*$/;

export interface ParsedMarker {
  kind: MarkerKind;
  line: number;
  /** Time text as written, e.g. `2026-11-06 18:33:28 (UTC+08:00)`. */
  time: string | null;
  /** Normalised content between the previous marker and this marker. */
  hashContent: string;
}

export interface ParsedIdeas {
  markers: ParsedMarker[];
  proofMarkers: ParsedMarker[];
  publishedMarkers: ParsedMarker[];
  /** Non-blank content after the last `Proof:` marker, excluding markers. */
  unsealedText: string;
  hasUnsealedContent: boolean;
  /** Non-blank content after the last marker of any kind, excluding markers. */
  tailAfterLastMarker: string;
  /** True when the last non-blank line is a `Proof:` marker. */
  canPublish: boolean;
}

export function formatMarkerLine(kind: MarkerKind, timeText: string): string {
  return `\`${kind === 'proof' ? 'Proof' : 'Published'}: ${timeText} [ideahub]\``;
}

export function markerLabel(kind: MarkerKind): string {
  return kind === 'proof' ? 'Proof' : 'Published';
}

export function parseMarkerLine(line: string): ParsedMarker | null {
  const match = MARKER_PATTERN.exec(line);
  if (!match) {
    return null;
  }
  return {
    kind: match[1] === 'Proof' ? 'proof' : 'published',
    line: 0,
    time: match[2].trim() || null,
    hashContent: ''
  };
}

/**
 * Parses a Markdown file into markers and the content after the latest
 * `Proof:` marker. `Published:` markers never reset the boundary.
 */
export function parseIdeas(text: string): ParsedIdeas {
  const lines = text.split(/\r?\n/);
  const markers: ParsedMarker[] = [];
  let buffer: string[] = [];
  let intervalBuffer: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const marker = parseMarkerLine(lines[index]);
    if (marker) {
      markers.push({
        ...marker,
        line: index,
        hashContent: normalizeContent(intervalBuffer.join('\n'))
      });
      intervalBuffer = [];
      if (marker.kind === 'proof') {
        buffer = [];
      }
      continue;
    }
    buffer.push(lines[index]);
    intervalBuffer.push(lines[index]);
  }

  const unsealedText = buffer.join('\n');
  const tailAfterLastMarker = normalizeContent(intervalBuffer.join('\n'));
  const lastNonEmptyLine = [...lines].reverse().find((line) => line.trim().length > 0) ?? '';
  const lastMarker = parseMarkerLine(lastNonEmptyLine);
  return {
    markers,
    proofMarkers: markers.filter((marker) => marker.kind === 'proof'),
    publishedMarkers: markers.filter((marker) => marker.kind === 'published'),
    unsealedText,
    hasUnsealedContent: normalizeContent(unsealedText).length > 0,
    tailAfterLastMarker,
    canPublish: lastMarker?.kind === 'proof'
  };
}

/**
 * Section 7.3: SHA-256 over the project name and the normalised content
 * sealed by a proof marker. The result is the release tag suffix.
 */
export function computeProofHash(project: string, content: string): string {
  return createHash('sha256').update(`${project}\n${normalizeContent(content)}`).digest('hex');
}

/**
 * Appends the marker on its own line, adding a leading newline when the
 * existing content does not already end with one.
 */
export function appendMarkerLine(text: string, markerLine: string): string {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  if (text.length === 0) {
    return `${markerLine}${eol}`;
  }
  const needsNewline = !text.endsWith('\n') && !text.endsWith('\r');
  return `${text}${needsNewline ? eol : ''}${markerLine}${eol}`;
}

/** Section 7.2: blank-line removal used only to detect meaningful content. */
export function normalizeContent(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .join('\n')
    .trim();
}
