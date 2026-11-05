import { describe, expect, it } from 'vitest';
import {
  appendMarker,
  computeProofHash,
  normalizeContent,
  parseIdeas
} from '../src/core/ideas';

const DATE = '2026-11-05';

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

  it('parses a valid marker with its date and leaves no unsealed content', () => {
    const text = appendMarker(sealedText, hash, DATE);
    const parsed = parseIdeas(text, 'MyGame');
    expect(parsed.markers).toHaveLength(1);
    expect(parsed.markers[0].id).toBe(hash);
    expect(parsed.markers[0].date).toBe(DATE);
    expect(parsed.markers[0].valid).toBe(true);
    expect(parsed.hasUnsealedContent).toBe(false);
    expect(parsed.integrityOk).toBe(true);
  });

  it('accepts a marker without date and reports null', () => {
    const parsed = parseIdeas(`abc\n<!-- ideahub:${hash} -->\n`, 'MyGame');
    expect(parsed.markers[0].date).toBeNull();
  });

  it('does not recognise the legacy marker format', () => {
    const parsed = parseIdeas(`abc\n<!--ideahub id:${hash}-->\n`, 'MyGame');
    expect(parsed.markers).toHaveLength(0);
    expect(parsed.hasUnsealedContent).toBe(true);
  });

  it('keeps the hash independent from the marker date', () => {
    const first = parseIdeas(appendMarker(sealedText, hash, '2026-11-05'), 'MyGame');
    const second = parseIdeas(appendMarker(sealedText, hash, '2026-12-31'), 'MyGame');
    expect(first.markers[0].contentHash).toBe(second.markers[0].contentHash);
  });

  it('detects modified sealed content', () => {
    const text = appendMarker(sealedText, hash, DATE).replace('第二行', '第二行被修改');
    const parsed = parseIdeas(text, 'MyGame');
    expect(parsed.markers[0].valid).toBe(false);
    expect(parsed.integrityOk).toBe(false);
  });

  it('only treats content after the last marker as new', () => {
    const first = appendMarker(sealedText, hash, DATE);
    const text = `${first}新增内容\n`;
    const parsed = parseIdeas(text, 'MyGame');
    expect(parsed.markers).toHaveLength(1);
    expect(parsed.hasUnsealedContent).toBe(true);
    expect(normalizeContent(parsed.unsealedText)).toBe('新增内容');
  });
});

describe('appendMarker', () => {
  it('only appends the marker and preserves the original body', () => {
    expect(appendMarker('abc', 'a'.repeat(64), DATE)).toBe(
      `abc\n<!-- ideahub:${'a'.repeat(64)} date=${DATE} -->\n`
    );
    expect(appendMarker('abc\n', 'b'.repeat(64), DATE)).toBe(
      `abc\n<!-- ideahub:${'b'.repeat(64)} date=${DATE} -->\n`
    );
  });

  it('keeps CRLF files in CRLF', () => {
    const hash = 'c'.repeat(64);
    expect(appendMarker('abc\r\n', hash, DATE)).toBe(
      `abc\r\n<!-- ideahub:${hash} date=${DATE} -->\r\n`
    );
  });
});
