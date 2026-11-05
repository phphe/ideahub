import { describe, expect, it } from 'vitest';
import {
  appendMarker,
  computeProofHash,
  normalizeContent,
  parseIdeas
} from '../src/core/ideas';

describe('normalizeContent', () => {
  it('drops blank and whitespace-only lines, unifies newlines and trims', () => {
    expect(normalizeContent('  a\r\n\r\n \t\r\nb  \r\n')).toBe('a\nb');
  });
});

describe('computeProofHash', () => {
  it('returns a stable sha256 hex digest that includes the project name', () => {
    const hash = computeProofHash('MyGame', '第一行\n\n第二行\n');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(computeProofHash('MyGame', '第一行\r\n\r\n第二行')).toBe(hash);
    expect(computeProofHash('OtherGame', '第一行\n\n第二行\n')).not.toBe(hash);
  });
});

describe('parseIdeas', () => {
  const sealedText = '第一行\n\n第二行\n';
  const hash = computeProofHash('MyGame', sealedText);

  it('treats content without markers as unsealed new content', () => {
    const parsed = parseIdeas(sealedText, 'MyGame');
    expect(parsed.markers).toHaveLength(0);
    expect(parsed.hasUnsealedContent).toBe(true);
    expect(parsed.integrityOk).toBe(true);
  });

  it('parses a valid marker and leaves no unsealed content', () => {
    const text = appendMarker(sealedText, hash);
    const parsed = parseIdeas(text, 'MyGame');
    expect(parsed.markers).toHaveLength(1);
    expect(parsed.markers[0].id).toBe(hash);
    expect(parsed.markers[0].valid).toBe(true);
    expect(parsed.hasUnsealedContent).toBe(false);
    expect(parsed.integrityOk).toBe(true);
  });

  it('detects modified sealed content', () => {
    const text = appendMarker(sealedText, hash).replace('第二行', '第二行被修改');
    const parsed = parseIdeas(text, 'MyGame');
    expect(parsed.markers[0].valid).toBe(false);
    expect(parsed.integrityOk).toBe(false);
  });

  it('only treats content after the last marker as new', () => {
    const first = appendMarker(sealedText, hash);
    const text = `${first}新增内容\n`;
    const parsed = parseIdeas(text, 'MyGame');
    expect(parsed.markers).toHaveLength(1);
    expect(parsed.hasUnsealedContent).toBe(true);
    expect(normalizeContent(parsed.unsealedText)).toBe('新增内容');
  });
});

describe('appendMarker', () => {
  it('only appends the marker and preserves the original body', () => {
    expect(appendMarker('abc', 'a'.repeat(64))).toBe(
      `abc\n<!--ideahub id:${'a'.repeat(64)}-->\n`
    );
    expect(appendMarker('abc\n', 'b'.repeat(64))).toBe(
      `abc\n<!--ideahub id:${'b'.repeat(64)}-->\n`
    );
  });

  it('keeps CRLF files in CRLF', () => {
    const hash = 'c'.repeat(64);
    expect(appendMarker('abc\r\n', hash)).toBe(`abc\r\n<!--ideahub id:${hash}-->\r\n`);
  });
});
