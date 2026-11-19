import { describe, expect, it } from 'vitest';
import { describeReleaseImmutability } from '../src/immutability';

describe('describeReleaseImmutability', () => {
  it('confirms immutable releases', () => {
    expect(describeReleaseImmutability(true)).toContain('confirmed immutable');
  });

  it('warns about mutable releases', () => {
    expect(describeReleaseImmutability(false)).toContain('release is mutable');
  });

  it('reports unknown when the field is missing', () => {
    expect(describeReleaseImmutability(undefined)).toContain('unknown');
  });
});
