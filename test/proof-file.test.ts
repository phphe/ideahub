import { describe, expect, it } from 'vitest';
import {
  PROOF_FILE_MARKER_PATTERN,
  extractProofBlocks,
  renderProofFile,
  type ProofFileBlock
} from '../src/core/proof-file';

const PROOF_EARLY = '###### `Proof: 2026-11-01 10:00:00 (UTC+08:00) [ideahub]`';
const PROOF_LATE = '###### `Proof: 2026-11-07 09:54:51 (UTC+08:00) [ideahub]`';
const PUBLISHED = '###### `Published: 2026-11-07 10:00:00 (UTC+08:00) [ideahub]`';
const PROJECT_URL = 'https://github.com/owner/repo/tree/main/MyGame';

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
    // `Published:` stays metadata only: it never enters the proof file.
    expect(blocks[1].rawText).not.toContain(PUBLISHED);
  });

  it('keeps ideas.md proof markers at 6 #', () => {
    const blocks = extractProofBlocks(`第一段\n${PROOF_EARLY}\n`);

    expect(blocks[0].markerLine).toBe(PROOF_EARLY);
    expect(blocks[0].markerLine.startsWith('###### ')).toBe(true);
  });
});

describe('renderProofFile', () => {
  const blocks: ProofFileBlock[] = [
    {
      time: '2026-11-07 09:54:51 (UTC+08:00)',
      markerLine: PROOF_LATE,
      text: '🔏![图](./b.png)',
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
  ];

  it('writes the configured version, header with <project-url> replaced, stats and ---', () => {
    const proofFile = renderProofFile(blocks, PROJECT_URL, {
      version: '1',
      header: 'Read the original at <project-url>.\n\nVerify with `npx ideahub check <project-url>`.'
    });

    expect(proofFile.startsWith('---\nversion: "1"\n---\n')).toBe(true);
    expect(proofFile).not.toContain('<project-url>');
    expect(proofFile).toContain(`Read the original at ${PROJECT_URL}.`);
    expect(proofFile).toContain(`Verify with \`npx ideahub check ${PROJECT_URL}\`.`);
    expect(proofFile).toContain(
      '- Time span: `2026-11-01 10:00:00 (UTC+08:00) → 2026-11-07 09:54:51 (UTC+08:00)`'
    );
    expect(proofFile).toContain('- Proofs: 2');
    expect(proofFile).toContain('- Referenced files: 2');
    expect(proofFile).toContain('- External links (unique): 2');

    // Front matter opens/closes with `---`, plus the standalone separator after
    // the stats list.
    const separatorCount = proofFile.split('\n').filter((line) => line === '---').length;
    expect(separatorCount).toBe(3);
    expect(proofFile).toContain(
      '- External links (unique): 2\n\n---\n\n## `Proof: 2026-11-01 10:00:00 (UTC+08:00) [ideahub]`'
    );
  });

  it('omits the header when it is missing, empty or blank', () => {
    for (const options of [undefined, {}, { header: '' }, { header: '   \n ' }]) {
      const proofFile = renderProofFile(blocks, PROJECT_URL, options);
      expect(proofFile.startsWith('---\nversion: "0"\n---\n\n- Time span:')).toBe(true);
      expect(proofFile).not.toContain('This file is the IdeaHub proof file');
      expect(proofFile).not.toContain('Do not trust this file directly');
    }
  });

  it('writes 2 # markers that the proof-file parser recognizes and drops Published', () => {
    const proofFile = renderProofFile(blocks, PROJECT_URL, { header: 'Proofs below.' });

    expect(proofFile).not.toContain('######');
    expect(proofFile).not.toContain(PUBLISHED);
    expect(proofFile).not.toContain('Published:');

    const markerLines = proofFile
      .split('\n')
      .filter((line) => line.startsWith('## `Proof:'));
    expect(markerLines).toHaveLength(2);
    for (const line of markerLines) {
      expect(PROOF_FILE_MARKER_PATTERN.test(line)).toBe(true);
    }

    // Ascending order and markers moved to the head of each block.
    const early = proofFile.indexOf('## `Proof: 2026-11-01 10:00:00 (UTC+08:00) [ideahub]`');
    const late = proofFile.indexOf('## `Proof: 2026-11-07 09:54:51 (UTC+08:00) [ideahub]`');
    expect(early).toBeLessThan(late);
    expect(early).toBeLessThan(proofFile.indexOf('第一段'));
    expect(late).toBeLessThan(proofFile.indexOf('🔏![图]'));
    expect(proofFile).toContain('🔏[文档](a.md)');
    expect(proofFile).toContain('🔏![图](./b.png)');
  });

  it('does not recognize ideas.md 6 # markers on the proof-file side', () => {
    expect(PROOF_FILE_MARKER_PATTERN.test(PROOF_EARLY)).toBe(false);
    const match = PROOF_FILE_MARKER_PATTERN.exec(
      '## `Proof: 2026-11-01 10:00:00 (UTC+08:00) [ideahub]`'
    );
    expect(match?.[1]).toBe('2026-11-01 10:00:00 (UTC+08:00)');
  });
});
