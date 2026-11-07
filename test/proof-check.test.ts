import { describe, expect, it } from 'vitest';
import {
  describeMissingProofReleases,
  findMissingProofReleases
} from '../src/core/proof-check';

describe('findMissingProofReleases', () => {
  it('passes when every proof tag exists on an immutable release', () => {
    const missing = findMissingProofReleases(
      [
        { time: '2026-11-01 10:00:00 (UTC+08:00)', tag: 'ideahub-a' },
        { time: '2026-11-07 09:54:51 (UTC+08:00)', tag: 'ideahub-b' }
      ],
      [
        { tagName: 'ideahub-a', immutable: true },
        { tagName: 'ideahub-b', immutable: true }
      ]
    );
    expect(missing).toEqual([]);
  });

  it('fails for a missing release or an explicitly mutable release', () => {
    const missing = findMissingProofReleases(
      [
        { time: '2026-11-01 10:00:00 (UTC+08:00)', tag: 'ideahub-a' },
        { time: '2026-11-07 09:54:51 (UTC+08:00)', tag: 'ideahub-b' }
      ],
      [
        { tagName: 'ideahub-a', immutable: false },
        { tagName: 'other', immutable: true }
      ]
    );
    expect(missing.map((item) => item.time)).toEqual([
      '2026-11-01 10:00:00 (UTC+08:00)',
      '2026-11-07 09:54:51 (UTC+08:00)'
    ]);
  });
});

describe('describeMissingProofReleases', () => {
  it('lists the raw proof timestamps without distinguishing the cause', () => {
    const message = describeMissingProofReleases([
      { time: '2026-11-07 09:54:51 (UTC+08:00)' }
    ]);
    expect(message).toContain('发布已阻止');
    expect(message).toContain('- 2026-11-07 09:54:51 (UTC+08:00)');
  });
});
