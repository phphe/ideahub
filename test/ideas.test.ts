import { describe, expect, it } from 'vitest';
import {
  appendMarkerLine,
  computeProofHash,
  formatMarkerLine,
  normalizeContent,
  parseIdeas,
  parseMarkerLine
} from '../src/core/ideas';

describe('computeProofHash', () => {
  it('hashes the project name and normalised content to 64 lowercase hex', () => {
    const hash = computeProofHash('MyGame', '第一行\n\n第二行\n');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(computeProofHash('MyGame', '第一行\n第二行'));
  });

  it('changes when the project name or content changes', () => {
    const base = computeProofHash('MyGame', '创意');
    expect(computeProofHash('OtherGame', '创意')).not.toBe(base);
    expect(computeProofHash('MyGame', '另一个创意')).not.toBe(base);
  });
});

const TIME = '2026-11-06 18:33:28 (UTC+08:00)';
const PROOF_TEXT = `Proof: ${TIME} [ideahub]`;
const PUBLISHED_TEXT = `Published: ${TIME} [ideahub]`;
const PROOF_LINE = `\`${PROOF_TEXT}\``;
const PUBLISHED_LINE = `\`${PUBLISHED_TEXT}\``;

describe('formatMarkerLine', () => {
  it('wraps both marker kinds in backticks with a space before [ideahub]', () => {
    expect(formatMarkerLine('proof', TIME)).toBe(PROOF_LINE);
    expect(formatMarkerLine('published', TIME)).toBe(PUBLISHED_LINE);
    expect(formatMarkerLine('proof', TIME)).toBe(`\`${PROOF_TEXT}\``);
  });
});

describe('parseMarkerLine', () => {
  it('matches a backtick-wrapped marker with surrounding whitespace', () => {
    expect(parseMarkerLine(`  ${PUBLISHED_LINE}  `)).toMatchObject({
      kind: 'published',
      time: TIME
    });
  });

  it('does not recognise markers without backticks', () => {
    expect(parseMarkerLine(PROOF_TEXT)).toBeNull();
    expect(parseMarkerLine(`prefix ${PROOF_LINE}`)).toBeNull();
    expect(parseMarkerLine(`${PROOF_LINE} suffix`)).toBeNull();
  });

  it('returns null for the legacy hidden marker format', () => {
    expect(parseMarkerLine('<!-- ideahub:abc date=2026-11-05 -->')).toBeNull();
  });

  it('returns null for lines without the trailing [ideahub] tag', () => {
    expect(parseMarkerLine(`\`Proof: 2026-11-06 18:33:28 (UTC+08:00)\``)).toBeNull();
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

  it('records the normalised content between markers for hashing', () => {
    const text = `第一段\n${PROOF_LINE}\n\n${PUBLISHED_LINE}\n第二段\n${PROOF_LINE}\n`;
    const parsed = parseIdeas(text);
    expect(parsed.proofMarkers[0].hashContent).toBe('第一段');
    expect(parsed.publishedMarkers[0].hashContent).toBe('');
    expect(parsed.proofMarkers[1].hashContent).toBe('第二段');
    expect(parsed.tailAfterLastMarker).toBe('');
  });

  it('allows publishing only when the last non-blank line is a proof marker', () => {
    expect(parseIdeas(`创意\n${PROOF_LINE}\n`).canPublish).toBe(true);
    expect(parseIdeas(`创意\n${PROOF_LINE}\n\n  \n`).canPublish).toBe(true);
    expect(parseIdeas(`创意\n${PROOF_LINE}\n新增\n`).canPublish).toBe(false);
    expect(parseIdeas(`创意\n${PROOF_LINE}\n${PUBLISHED_LINE}\n`).canPublish).toBe(false);
    expect(parseIdeas('创意\n').canPublish).toBe(false);
    expect(parseIdeas('').canPublish).toBe(false);
  });

  it('treats markers without backticks as ordinary content', () => {
    const text = `创意\n${PROOF_TEXT}\n`;
    const parsed = parseIdeas(text);
    expect(parsed.markers).toHaveLength(0);
    expect(parsed.hasUnsealedContent).toBe(true);
    expect(parsed.canPublish).toBe(false);
    expect(normalizeContent(parsed.unsealedText)).toBe(`创意\n${PROOF_TEXT}`);
  });

  it('does not reset the proof boundary for an unquoted marker', () => {
    const text = `旧内容\n${PROOF_LINE}\n新增内容\n${PROOF_TEXT}\n`;
    const parsed = parseIdeas(text);
    expect(parsed.proofMarkers).toHaveLength(1);
    expect(parsed.hasUnsealedContent).toBe(true);
    expect(normalizeContent(parsed.unsealedText)).toBe(`新增内容\n${PROOF_TEXT}`);
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
