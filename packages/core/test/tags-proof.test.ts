import { describe, expect, it } from 'vitest';
import { parseIdeas, formatMarkerLine } from '../src/ideas';
import { parseTags, updateTags } from '../src/front-matter';
import { summarizeProject } from '../src/status';

const PROOF = formatMarkerLine('proof', '2026-01-01 00:00:00 (UTC+08:00)');

describe('front matter and proof isolation', () => {
  it('does not treat tags alone as new content', () => {
    const parsed = parseIdeas('---\ntags:\n  - 游戏\n---\n');
    expect(parsed.hasUnsealedContent).toBe(false);
    expect(parsed.canPublish).toBe(false);
    expect(parsed.proofMarkers).toEqual([]);
  });

  it('keeps real body content after the front matter', () => {
    const parsed = parseIdeas('---\ntags: [游戏]\n---\n\n正文\n');
    expect(parsed.hasUnsealedContent).toBe(true);
    expect(parsed.canPublish).toBe(false);
  });

  it('keeps the sealed hash unchanged when tags are added later', () => {
    const before = parseIdeas(`正文\n${PROOF}\n`);
    const after = parseIdeas(updateTags(`正文\n${PROOF}\n`, ['游戏', '写作']));
    expect(after.proofMarkers[0].hashContent).toBe(before.proofMarkers[0].hashContent);
    expect(after.hasUnsealedContent).toBe(false);
    expect(after.canPublish).toBe(true);
  });

  it('does not change hasNewContent or canPublish after editing tags', () => {
    const base = '正文\n更多内容\n';
    const before = parseIdeas(base);
    const after = parseIdeas(updateTags(base, ['游戏']));
    expect(after.hasUnsealedContent).toBe(before.hasUnsealedContent);
    expect(after.canPublish).toBe(before.canPublish);
  });

  it('keeps proof tags stable across a tag edit', () => {
    const base = `正文\n${PROOF}\n`;
    const withTags = updateTags(base, ['游戏']);
    expect(parseTags(withTags)).toEqual(['游戏']);
    const before = summarizeProject('demo', base);
    const after = summarizeProject('demo', withTags);
    expect(after.proofTags).toEqual(before.proofTags);
    expect(after.hasNewContent).toBe(before.hasNewContent);
    expect(after.canPublish).toBe(before.canPublish);
    expect(after.tags).toEqual(['游戏']);
  });

  it('reports tags on the project summary and keeps tag-only files empty', () => {
    const summary = summarizeProject('demo', '---\ntags:\n  - 游戏\n---\n');
    expect(summary.tags).toEqual(['游戏']);
    expect(summary.hasNewContent).toBe(false);
    expect(summary.canPublish).toBe(false);
    expect(summary.proofCount).toBe(0);
  });
});
