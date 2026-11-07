import { describe, expect, it } from 'vitest';
import {
  findFrontMatter,
  parseTagInput,
  parseTags,
  updateTags
} from '../src/core/front-matter';

describe('parseTags', () => {
  it('reads a block list from the optional front matter', () => {
    expect(
      parseTags('---\ntags:\n  - 游戏\n  - 写作\n---\n正文\n')
    ).toEqual(['游戏', '写作']);
  });

  it('reads an inline list, including quoted scalars', () => {
    expect(parseTags('---\ntags: [游戏, "写 作"]\n---\n')).toEqual(['游戏', '写 作']);
    expect(parseTags("---\ntags: ['游戏', \"写作\"]\n---\n")).toEqual(['游戏', '写作']);
    expect(parseTags('---\ntags: []\n---\n')).toEqual([]);
  });

  it('keeps commas and colons inside quoted items', () => {
    expect(parseTags('---\ntags: ["a,b", "c: d", e]\n---\n')).toEqual([
      'a,b',
      'c: d',
      'e'
    ]);
    expect(parseTags('---\ntags: ["a\\"b"]\n---\n')).toEqual(['a"b']);
  });

  it('returns no tags when front matter is missing or malformed', () => {
    expect(parseTags('正文\n')).toEqual([]);
    expect(parseTags('---\ntitle: x\n---\n正文\n')).toEqual([]);
    expect(parseTags('---\ntags: 游戏\n---\n')).toEqual([]);
    expect(parseTags('---\ntags: [游戏\n---\n')).toEqual([]);
    // No closing delimiter: not front matter at all.
    expect(parseTags('---\ntags:\n  - 游戏\n')).toEqual([]);
  });

  it('deduplicates case-insensitively but keeps the first spelling', () => {
    expect(parseTags('---\ntags:\n  - Game\n  - game\n---\n')).toEqual(['Game']);
  });

  it('accepts a BOM and CRLF files', () => {
    expect(findFrontMatter('\uFEFF---\r\ntags:\r\n  - 游戏\r\n---\r\n')).toEqual({
      startLine: 0,
      endLine: 3
    });
    expect(parseTags('\uFEFF---\r\ntags: [游戏]\r\n---\r\n')).toEqual(['游戏']);
  });
});

describe('parseTagInput', () => {
  it('splits on ascii, full-width and ideographic commas', () => {
    expect(parseTagInput('游戏, 写作，Game、Other')).toEqual([
      '游戏',
      '写作',
      'Game',
      'Other'
    ]);
  });

  it('does not split on semicolons, trims and drops empty items', () => {
    expect(parseTagInput('a;b , , c ')).toEqual(['a;b', 'c']);
  });

  it('deduplicates case-insensitively and keeps the first occurrence', () => {
    expect(parseTagInput('游戏, 游戏, Game, game, GAME')).toEqual(['游戏', 'Game']);
  });
});

describe('updateTags', () => {
  const original = [
    '---',
    'title: 我的项目',
    '# 这一行是用户注释',
    'tags:',
    '  - 游戏',
    '  - 写作 # 条目注释',
    'author: 我',
    '---',
    '正文'
  ].join('\n');

  it('rewrites a block list into an inline array and keeps other lines', () => {
    const updated = updateTags(original, ['写作', '游戏', '新标签']);
    expect(updated).toBe(
      [
        '---',
        'title: 我的项目',
        '# 这一行是用户注释',
        'tags: ["写作", "游戏", "新标签"]',
        'author: 我',
        '---',
        '正文'
      ].join('\n')
    );
  });

  it('writes quoted Chinese tags and keeps the key comment', () => {
    expect(updateTags('---\ntags: [a, b] # 注释\n---\n', ['游戏', '软件'])).toBe(
      '---\ntags: ["游戏", "软件"] # 注释\n---\n'
    );
  });

  it('keeps an empty tags array instead of removing the block', () => {
    expect(updateTags(original, [])).toBe(
      [
        '---',
        'title: 我的项目',
        '# 这一行是用户注释',
        'tags: []',
        'author: 我',
        '---',
        '正文'
      ].join('\n')
    );
  });

  it('adds a tags key to existing front matter without touching other keys', () => {
    expect(updateTags('---\ntitle: x\n---\n正文\n', ['游戏'])).toBe(
      '---\ntitle: x\ntags: ["游戏"]\n---\n正文\n'
    );
  });

  it('inserts front matter after the BOM and follows CRLF', () => {
    expect(updateTags('\uFEFF# 标题\r\n正文\r\n', ['游戏', '写作'])).toBe(
      '\uFEFF---\r\ntags: ["游戏", "写作"]\r\n---\r\n\r\n# 标题\r\n正文\r\n'
    );
  });

  it('does not create front matter when there is nothing to write', () => {
    expect(updateTags('正文\n', [])).toBe('正文\n');
    expect(updateTags('', [])).toBe('');
  });

  it('creates an inline front matter block for an empty file', () => {
    expect(updateTags('', ['游戏'])).toBe('---\ntags: ["游戏"]\n---\n');
  });

  it('round-trips values with commas, colons and quotes', () => {
    for (const tags of [
      ['a, b'],
      ['a: b'],
      ['游戏', '软件'],
      ['a"b']
    ]) {
      expect(parseTags(updateTags('', tags))).toEqual(tags);
    }
    expect(updateTags('', ['a, b'])).toBe('---\ntags: ["a, b"]\n---\n');
    expect(parseTags(updateTags('', []))).toEqual([]);
  });
});
