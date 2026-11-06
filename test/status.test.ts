import { describe, expect, it } from 'vitest';
import { computeProofHash } from '../src/core/ideas';
import { summarizeProject } from '../src/core/status';

const TIME = '2026-11-06 18:33:28 (UTC+08:00)';
const PROOF = `Proof: ${TIME} [ideahub]`;
const PUBLISHED = `Published: ${TIME} [ideahub]`;

describe('summarizeProject badges', () => {
  it('reports zero proofs and no content flags for an empty file', () => {
    expect(summarizeProject('EmptyGame', '')).toMatchObject({
      proofCount: 0,
      publishedCount: 0,
      hasNewContent: false,
      canPublish: false
    });
  });

  it('counts multiple proofs and derives one hash tag per proof', () => {
    const text = `第一段\n${PROOF}\n第二段\n${PROOF}\n`;
    const summary = summarizeProject('MyGame', text);
    expect(summary.proofCount).toBe(2);
    expect(summary.proofTags).toHaveLength(2);
    expect(summary.proofTags[0]).toBe(
      `ideahub-${computeProofHash('MyGame', '第一段')}`
    );
    expect(summary.proofTags[1]).toBe(
      `ideahub-${computeProofHash('MyGame', '第二段')}`
    );
  });

  it('flags 有新内容 only when content after the last proof is non-blank', () => {
    expect(summarizeProject('MyGame', `创意\n${PROOF}\n`).hasNewContent).toBe(false);
    expect(summarizeProject('MyGame', `创意\n${PROOF}\n\n  \n`).hasNewContent).toBe(false);
    expect(summarizeProject('MyGame', `创意\n${PROOF}\n新增\n`).hasNewContent).toBe(true);
  });

  it('counts Published markers, including zero', () => {
    expect(summarizeProject('MyGame', `创意\n${PROOF}\n`).publishedCount).toBe(0);
    expect(
      summarizeProject('MyGame', `创意\n${PROOF}\n${PUBLISHED}\n新增\n${PROOF}\n${PUBLISHED}\n`)
        .publishedCount
    ).toBe(2);
  });

  it('is 可发布 only when the last non-blank line is a proof marker', () => {
    expect(summarizeProject('MyGame', `创意\n${PROOF}\n`).canPublish).toBe(true);
    expect(summarizeProject('MyGame', `创意\n${PROOF}\n\n  `).canPublish).toBe(true);
    expect(summarizeProject('MyGame', `创意\n${PROOF}\n新增\n`).canPublish).toBe(false);
    expect(summarizeProject('MyGame', `创意\n${PROOF}\n${PUBLISHED}\n`).canPublish).toBe(false);
    expect(summarizeProject('MyGame', '创意\n').canPublish).toBe(false);
  });
});
