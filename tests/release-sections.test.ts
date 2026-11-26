import { describe, expect, test } from 'bun:test';
import { splitRelease } from '../src/lib/release-sections.ts';

describe('splitRelease', () => {
  test('splits a curated body at its Full changelog heading and summarizes the intro', () => {
    const body = [
      'Pohunek 0.45 lets plugins bring their own sign-in steps. It also keeps the assistant in step.',
      '',
      "### What's new",
      '',
      '**Plugins.** Setup entries.',
      '',
      '### Full changelog',
      '',
      '#### Added',
      '',
      '- One ([#1](https://example.com/1))',
      '- Two',
    ].join('\n');
    const sections = splitRelease(body, 'release-notes');
    expect(sections.summary).toBe('Pohunek 0.45 lets plugins bring their own sign-in steps. It also keeps the assistant in step.');
    expect(sections.lead).toContain("What's new");
    expect(sections.lead).not.toContain('Full changelog');
    expect(sections.full).toContain('#### Added');
    expect(sections.fullCount).toBe(2);
  });

  test('keeps a body without the heading whole and summarizes its first bullet without issue links', () => {
    const body = '### Added\n\n- A **fresh** install offers `Try the demo` ([#12](https://example.com/12)).\n- Other';
    const sections = splitRelease(body, 'release-notes');
    expect(sections.summary).toBe('A fresh install offers Try the demo.');
    expect(sections.full).toBeUndefined();
    expect(sections.lead).toBe(body);
  });

  test('summarizes a generated body by its pull request count', () => {
    expect(splitRelease('- one (#1)\n- two (#2)', 'generated').summary).toBe('2 merged pull requests');
    expect(splitRelease('- one (#1)', 'generated').summary).toBe('1 merged pull request');
  });

  test('cuts a long first sentence at a word boundary', () => {
    const sections = splitRelease(`${'word '.repeat(80)}end.`, 'release-notes');
    expect(sections.summary.length).toBeLessThanOrEqual(220);
    expect(sections.summary.endsWith('…')).toBe(true);
  });

  test('keeps underscores inside identifiers', () => {
    expect(splitRelease('- A `version_probe` with _emphasis_ here.', 'release-notes').summary).toBe(
      'A version_probe with emphasis here.',
    );
  });

  test('does not split a version number into sentences', () => {
    expect(splitRelease('Pohunek 0.44 is about agents.', 'release-notes').summary).toBe('Pohunek 0.44 is about agents.');
  });
});
