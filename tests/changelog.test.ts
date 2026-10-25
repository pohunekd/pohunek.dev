import { readdirSync } from 'node:fs';
import { describe, expect, test } from 'bun:test';
import {
  extractChangelogBlock,
  parseProductChangelog,
  pullCandidates,
  renderGeneratedMarkdown,
} from '../scripts/lib/changelog.ts';
import { parseReleasesConfig } from '../scripts/lib/releases-config.ts';

// The notes block of the contract fixture `single/expected-0.37.0` (zajca/pohunek#1588).
const SECTION = [
  '### Added',
  '',
  '- Tailscale can carry the connection between hosts as an opt-in overlay. ([#12](https://github.com/example/app/issues/12))',
  '',
  '### Fixed',
  '',
  '- `pohunek attach --dump` no longer cuts the last screen line. ([#9](https://github.com/example/app/issues/9))',
].join('\n');
const NOTES = `<!-- pohunek-changelog:start -->\n${SECTION}\n<!-- pohunek-changelog:end -->\n`;

describe('extractChangelogBlock', () => {
  test('returns the section between the markers and ignores the body after them', () => {
    const body = `${NOTES}\nSigned APK built from commit abc.\n\nVerify with sha256sum -c.`;
    expect(extractChangelogBlock(body)).toBe(SECTION);
  });

  test('accepts CRLF line endings', () => {
    expect(extractChangelogBlock(NOTES.replaceAll('\n', '\r\n'))).toBe(SECTION);
  });

  test('returns undefined for a body without markers', () => {
    expect(extractChangelogBlock('Pohunek Companion 0.1.6 for x86_64 Linux.')).toBeUndefined();
    expect(extractChangelogBlock('')).toBeUndefined();
  });

  test.each([
    ['a lone start marker', '<!-- pohunek-changelog:start -->\n- x\n'],
    ['a lone end marker', '- x\n<!-- pohunek-changelog:end -->\n'],
    ['markers in the wrong order', '<!-- pohunek-changelog:end -->\n- x\n<!-- pohunek-changelog:start -->\n'],
    ['a repeated block', `${NOTES}${NOTES}`],
  ])('rejects %s', (_label, body) => {
    expect(() => extractChangelogBlock(body)).toThrow('malformed changelog markers');
  });

  test('rejects an empty block', () => {
    expect(() =>
      extractChangelogBlock('<!-- pohunek-changelog:start -->\n\n<!-- pohunek-changelog:end -->'),
    ).toThrow('empty changelog block');
  });
});

describe('pullCandidates', () => {
  test('reads merge and squash subjects in commit order without repeats', () => {
    expect(
      pullCandidates([
        'Merge pull request #1585 from zajca/zajca/rel037-fragment-wording\n\nState the macOS limit',
        'Release 0.1.6 (#231)',
        'Fix review findings: overlay-neutral wording',
        'Parse --known-hosts as one JSON word (#229)\n\nbody (#5)',
        'Merge pull request #1585 from zajca/again',
        'Release v0.37.0',
      ]),
    ).toEqual([1585, 231, 229]);
  });
});

describe('renderGeneratedMarkdown', () => {
  const url = 'https://github.com';

  test('lists pull requests with links and drops release preparation', () => {
    const markdown = renderGeneratedMarkdown(
      [
        { number: 229, title: 'Parse --known-hosts as\none JSON word' },
        { number: 231, title: 'Release 0.1.6' },
      ],
      'pohunekd/pohunek-companion',
      url,
      'v0.1.5',
    );
    expect(markdown).toBe(
      '- Parse --known-hosts as one JSON word ([#229](https://github.com/pohunekd/pohunek-companion/pull/229))',
    );
  });

  test('names the first release and an empty range', () => {
    expect(renderGeneratedMarkdown([], 'a/b', url, undefined)).toBe('First release.');
    expect(renderGeneratedMarkdown([{ number: 2, title: 'Release 1.0.1' }], 'a/b', url, 'v1.0.0')).toBe(
      'No pull requests merged since v1.0.0.',
    );
  });
});

describe('parseProductChangelog', () => {
  const release = {
    tag: 'v0.1.6',
    version: '0.1.6',
    publishedAt: '2026-10-25T13:54:29Z',
    prerelease: false,
    url: 'https://github.com/pohunekd/pohunek-companion/releases/tag/v0.1.6',
    source: 'generated',
    markdown: '- x',
  };

  test('accepts a valid file', () => {
    expect(parseProductChangelog({ product: 'companion', releases: [release] }, 'f').releases).toHaveLength(1);
  });

  test('rejects an unknown source, a bad date and a non-GitHub URL', () => {
    expect(() => parseProductChangelog({ product: 'c', releases: [{ ...release, source: 'x' }] }, 'f')).toThrow(
      'source must be',
    );
    expect(() => parseProductChangelog({ product: 'c', releases: [{ ...release, publishedAt: 'soon' }] }, 'f')).toThrow(
      'not a date',
    );
    expect(() =>
      parseProductChangelog({ product: 'c', releases: [{ ...release, url: 'https://evil.example/' }] }, 'f'),
    ).toThrow('GitHub URL');
  });

  test('every committed changelog file is valid, belongs to its product and ends at the pin', async () => {
    const config = parseReleasesConfig(await Bun.file('releases.config.json').json());
    const files = readdirSync(config.changelogDir).sort();
    expect(files).toEqual(config.products.map((product) => `${product.id}.json`).sort());
    for (const product of config.products) {
      const path = `${config.changelogDir}/${product.id}.json`;
      const changelog = parseProductChangelog(await Bun.file(path).json(), path);
      expect(changelog.product).toBe(product.id);
      expect(changelog.releases[0]?.version).toBe(product.version);
    }
  });
});
