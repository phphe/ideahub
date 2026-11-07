import { describe, expect, it } from 'vitest';
import { extractProofBlocks, renderProofFile } from '../src/core/proof-file';

const PROOF_EARLY = '###### `Proof: 2026-11-01 10:00:00 (UTC+08:00) [ideahub]`';
const PROOF_LATE = '###### `Proof: 2026-11-07 09:54:51 (UTC+08:00) [ideahub]`';
const PUBLISHED = '###### `Published: 2026-11-07 10:00:00 (UTC+08:00) [ideahub]`';

describe('extractProofBlocks', () => {
  it('skips front matter and seals the text before each proof marker', () => {
    const text = [
      '---',
      'tags: ["游戏"]',
      '---',
      '',
      '第一段',
      PROOF_EARLY,
      '第二段',
      PROOF_LATE,
      PUBLISHED,
      ''
    ].join('\n');

    const blocks = extractProofBlocks(text);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].time).toBe('2026-11-01 10:00:00 (UTC+08:00)');
    expect(blocks[0].rawText).toContain('第一段');
    expect(blocks[0].rawText).not.toContain('游戏');
    expect(blocks[1].rawText).toContain('第二段');
    // The trailing Published marker belongs to the last block but is excluded
    // from the hash by normalisation.
    expect(blocks[1].rawText).toContain(PUBLISHED);
  });
});

describe('renderProofFile', () => {
  it('writes front matter, English copy, counts and ascending marker-first blocks', () => {
    const proofFile = renderProofFile('MyGame', [
      {
        time: '2026-11-07 09:54:51 (UTC+08:00)',
        markerLine: PROOF_LATE,
        text: `🔏![图](./b.png)\n\n${PUBLISHED}`,
        files: { 'b.png': 'sha-b' },
        externalLinks: ['https://example.com/a']
      },
      {
        time: '2026-11-01 10:00:00 (UTC+08:00)',
        markerLine: PROOF_EARLY,
        text: '第一段\n\n🔏[文档](a.md)',
        files: { 'a.md': 'sha-a', 'b.png': 'sha-b' },
        externalLinks: ['https://example.com/a', 'https://example.com/c']
      }
    ]);

    expect(proofFile.startsWith('---\nversion: "0"\n---\n')).toBe(true);
    expect(proofFile).toContain('# Ideas Proof — MyGame');
    expect(proofFile).toContain('This file is the IdeaHub proof file');
    expect(proofFile).toContain('Do not trust this file directly');
    expect(proofFile).toContain('npx ideahub check <project-url>');
    expect(proofFile).toContain(
      '- Time span: `2026-11-01 10:00:00 (UTC+08:00) → 2026-11-07 09:54:51 (UTC+08:00)`'
    );
    expect(proofFile).toContain('- Proofs: 2');
    expect(proofFile).toContain('- Referenced files: 2');
    expect(proofFile).toContain('- External links (unique): 2');

    // Ascending order: the early marker comes first.
    expect(proofFile.indexOf(PROOF_EARLY)).toBeLessThan(proofFile.indexOf(PROOF_LATE));
    // Markers moved to the head of their block, text follows them.
    expect(proofFile.indexOf(PROOF_EARLY)).toBeLessThan(proofFile.indexOf('第一段'));
    expect(proofFile.indexOf(PROOF_LATE)).toBeLessThan(proofFile.indexOf('🔏![图]'));
    // Published metadata stays inside its block; emoji is preserved.
    expect(proofFile.indexOf(PROOF_LATE)).toBeLessThan(proofFile.indexOf(PUBLISHED));
    expect(proofFile).toContain('🔏[文档](a.md)');
    expect(proofFile).toContain('🔏![图](./b.png)');
  });
});
