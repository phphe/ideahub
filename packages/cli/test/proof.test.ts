import { describe, expect, it } from 'vitest';
import { parseProofFile } from '../src/proof';

const MARKER = '## 🔏 `Proof: 2026-11-01 10:00:00 (UTC+08:00) [ideahub]`';

function proofFile(block: string, header = '> - Proofs: 1'): string {
  return [
    '---',
    'version: "1"',
    '---',
    '',
    header,
    '',
    '---',
    '',
    MARKER,
    '',
    block,
    ''
  ].join('\n');
}

describe('parseProofFile', () => {
  it('reads the version, header and one block', () => {
    const parsed = parseProofFile(proofFile('🔏[doc](a.md)'));
    expect(parsed.problems).toEqual([]);
    expect(parsed.version).toBe('1');
    expect(parsed.blocks).toHaveLength(1);
    expect(parsed.blocks[0].timeText).toBe('2026-11-01 10:00:00 (UTC+08:00)');
    expect(parsed.blocks[0].text.trim()).toBe('🔏[doc](a.md)');
  });

  it('fails when there is no proof block', () => {
    const parsed = parseProofFile('---\nversion: "1"\n---\n\n> - Proofs: 0\n\n---\n');
    expect(parsed.problems.map((problem) => problem.severity)).toContain('FAIL');
    expect(parsed.problems.map((problem) => problem.message).join('\n')).toContain('empty proof');
  });

  it('fails on a malformed locked marker', () => {
    const text = proofFile('x').replace(MARKER, '## 🔏 Proof without backticks');
    const parsed = parseProofFile(text);
    expect(parsed.problems.map((problem) => problem.message).join('\n')).toContain('Invalid proof marker syntax');
  });

  it('fails on stray content between the separator and the first marker', () => {
    const text = proofFile('x').replace('\n---\n\n' + MARKER, '\n---\n\nstray\n\n' + MARKER);
    const parsed = parseProofFile(text);
    expect(parsed.problems.map((problem) => problem.message).join('\n')).toContain('Unexpected content');
  });

  it('ignores the reserved character in the header region', () => {
    const parsed = parseProofFile(proofFile('x', '> A marker begins with `🔏Proof:`'));
    expect(parsed.problems).toEqual([]);
  });

  it('fails when front matter is missing', () => {
    const parsed = parseProofFile(`> header\n\n---\n\n${MARKER}\n\nx\n`);
    expect(parsed.problems.map((problem) => problem.message).join('\n')).toContain('front matter');
  });
});
