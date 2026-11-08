export interface ProofCheckTarget {
  time: string | null;
  tag: string;
}

interface ReleaseLike {
  tagName: string;
  immutable?: boolean;
}

/**
 * Section 7.6: a proof passes when its tag exists on a release that is not
 * explicitly mutable. Missing tags and `immutable: false` are reported the
 * same way — the UI only lists timestamps.
 */
export function findMissingProofReleases<T extends ProofCheckTarget>(
  targets: T[],
  releases: ReleaseLike[]
): T[] {
  const eligible = new Set<string>();
  for (const release of releases) {
    if (release.tagName && release.immutable !== false) {
      eligible.add(release.tagName);
    }
  }
  return targets.filter((target) => !eligible.has(target.tag));
}

export function describeMissingProofReleases(
  missing: Array<{ time: string | null }>
): string {
  const lines = missing.map((target) => `- ${target.time ?? '未知时间'}`);
  return [
    '发布已阻止：以下证明在远程仓库中不存在对应的不可变 Release：',
    ...lines
  ].join('\n');
}
