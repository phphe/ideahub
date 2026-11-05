import { describe, expect, it } from 'vitest';
import {
  appendMarkerLine,
  formatMarkerLine,
  normalizeContent,
  parseIdeas,
  parseMarkerLine
} from '../src/core/ideas';

const TIME = '2026-11-06 18:33:28 (UTC+08:00)';
const PROOF_LINE = `Proof: ${TIME} [ideahub]`;
const PUBLISHED_LINE = `Published: ${TIME} [ideahub]`;

describe('formatMarkerLine', () => {
  it('formats both marker kinds with a space before [ideahub]', () => {
    expect(formatMarkerLine('proof', TIME)).toBe(PROOF_LINE);
    expect(formatMarkerLine('published', TIME)).toBe(PUBLISHED_LINE);
  });
});

describe('parseMarkerLine', () => {
  it('matches even when the marker is not at the start of the line', () => {
    expect(parseMarkerLine(`prefix ${PROOF_LINE}`)).toMatchObject({
      kind: 'proof',
      time: TIME
    });
  });

  it('allows surrounding whitespace and extracts the time text', () => {
    expect(parseMarkerLine(`  ${PUBLISHED_LINE}  `)).toMatchObject({
      kind: 'published',
      time: TIME
    });
  });

  it('returns null for the legacy hidden marker format', () => {
    expect(parseMarkerLine('<!-- ideahub:abc date=2026-11-05 -->')).toBeNull();
  });

  it('returns null for lines without the trailing [ideahub] tag', () => {
    expect(parseMarkerLine('Proof: 2026-11-06 18:33:28 (UTC+08:00)')).toBeNull();
  });
});

describe('parseIdeas', () => {
  it('treats content without markers as unsealed new content', () => {
    const parsed = parseIdeas('第一行\n\n第二行\n');
    expect(parsed.markers).toHaveLength(0);
    expect(parsed.hasUnsealedContent).toBe(true);
    expect(normalizeContent(parsed.unsealedText)).toBe('第一行\n第二行');
  });

  it('leaves no unsealed content after a proof marker', () => {
    const parsed = parseIdeas(`第一行\n\n第二行\n${PROOF_LINE}\n`);
    expect(parsed.proofMarkers).toHaveLength(1);
    expect(parsed.proofMarkers[0].time).toBe(TIME);
    expect(parsed.hasUnsealedContent).toBe(false);
  });

  it('does not reset the proof boundary after a published marker', () => {
    const text = `第一行\n${PROOF_LINE}\n新增内容\n${PUBLISHED_LINE}\n`;
    const parsed = parseIdeas(text);
    expect(parsed.publishedMarkers).toHaveLength(1);
    expect(parsed.hasUnsealedContent).toBe(true);
    expect(normalizeContent(parsed.unsealedText)).toBe('新增内容');
  });

  it('only treats content after the latest proof marker as new', () => {
    const text = `旧内容\n${PROOF_LINE}\n新增内容\n`;
    const parsed = parseIdeas(text);
    expect(parsed.proofMarkers).toHaveLength(1);
    expect(parsed.hasUnsealedContent).toBe(true);
    expect(normalizeContent(parsed.unsealedText)).toBe('新增内容');
  });

  it('recognises markers with surrounding whitespace but rejects the old format', () => {
    const parsed = parseIdeas(`abc\n  ${PROOF_LINE}  \n<!-- ideahub:deadbeef date=2026-11-05 -->\n`);
    expect(parsed.markers).toHaveLength(1);
    expect(parsed.hasUnsealedContent).toBe(true);
    expect(normalizeContent(parsed.unsealedText)).toBe(
      '<!-- ideahub:deadbeef date=2026-11-05 -->'
    );
  });
});

describe('appendMarkerLine', () => {
  it('inserts a leading newline when the content does not end with one', () => {
    expect(appendMarkerLine('abc', PROOF_LINE)).toBe(`abc\n${PROOF_LINE}\n`);
  });

  it('does not add a leading newline when the content already ends with one', () => {
    expect(appendMarkerLine('abc\n', PROOF_LINE)).toBe(`abc\n${PROOF_LINE}\n`);
  });

  it('keeps CRLF files in CRLF', () => {
    expect(appendMarkerLine('abc\r\n', PUBLISHED_LINE)).toBe(`abc\r\n${PUBLISHED_LINE}\r\n`);
    expect(appendMarkerLine('abc\r\ndef', PUBLISHED_LINE)).toBe(
      `abc\r\ndef\r\n${PUBLISHED_LINE}\r\n`
    );
  });

  it('writes a marker-only file for empty content', () => {
    expect(appendMarkerLine('', PROOF_LINE)).toBe(`${PROOF_LINE}\n`);
  });
});
