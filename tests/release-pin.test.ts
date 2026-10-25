import { describe, expect, test } from 'bun:test';
import { compareReleaseTags, parseReleaseTag, planPinBump, renderPinFile } from '../scripts/lib/release-pin.ts';

describe('parseReleaseTag', () => {
  test('accepts a stable vX.Y.Z tag', () => {
    expect(parseReleaseTag('v0.37.0')).toEqual([0, 37, 0]);
  });

  test.each(['0.37.0', 'v0.37', 'v0.37.0-rc.1', 'v0.37.0+build', 'v01.2.3', 'main', 'v0.37.0\n'])(
    'rejects %p',
    (tag) => {
      expect(() => parseReleaseTag(tag)).toThrow('release tag must look like vX.Y.Z');
    },
  );
});

describe('compareReleaseTags', () => {
  test('compares numerically, not lexically', () => {
    expect(compareReleaseTags('v0.10.0', 'v0.9.9')).toBeGreaterThan(0);
    expect(compareReleaseTags('v1.0.0', 'v0.99.99')).toBeGreaterThan(0);
    expect(compareReleaseTags('v0.35.2', 'v0.37.0')).toBeLessThan(0);
    expect(compareReleaseTags('v0.37.0', 'v0.37.0')).toBe(0);
  });
});

describe('planPinBump', () => {
  test('moves the pin forward to a newer release', () => {
    expect(planPinBump('v0.35.2', 'v0.37.0')).toEqual({ kind: 'bump', from: 'v0.35.2', to: 'v0.37.0' });
  });

  test('leaves the pin alone when it already matches', () => {
    expect(planPinBump('v0.37.0', 'v0.37.0')).toEqual({ kind: 'unchanged' });
  });

  test('refuses to move the pin back', () => {
    expect(() => planPinBump('v0.37.0', 'v0.36.0')).toThrow('refusing to move the pin back');
  });

  test('fails when the current pin is not a release tag', () => {
    expect(() => planPinBump('main', 'v0.37.0')).toThrow('got "main"');
  });
});

describe('renderPinFile', () => {
  test('replaces only ref and keeps key order and formatting', () => {
    const raw = { $comment: 'x', repository: 'zajca/pohunek', ref: 'v0.35.2' };
    expect(renderPinFile(raw, 'v0.37.0')).toBe(
      '{\n  "$comment": "x",\n  "repository": "zajca/pohunek",\n  "ref": "v0.37.0"\n}\n',
    );
  });
});
