import { describe, expect, test } from 'bun:test';
import type { ChangelogRelease } from '../scripts/lib/changelog.ts';
import type { Product } from '../scripts/lib/releases-config.ts';
import type { TimelineEntry } from '../src/data/changelog.ts';
import { renderAtomFeed, renderChangelogText } from '../src/lib/changelog-feed.ts';

const product: Product = {
  id: 'companion',
  name: 'Desktop <companion>',
  repository: 'pohunekd/pohunek-companion',
  tagPrefix: 'v',
  version: '0.1.6',
  prerelease: false,
  attested: true,
  assets: ['a-{version}.tar.gz'],
};

function entry(version: string, source: ChangelogRelease['source'], publishedAt: string): TimelineEntry {
  return {
    product,
    release: {
      tag: `v${version}`,
      version,
      publishedAt,
      prerelease: false,
      url: `https://github.com/pohunekd/pohunek-companion/releases/tag/v${version}`,
      source,
      markdown: '- Fix & ship',
    },
    html: '<ul>\n<li>Fix &#x26; ship</li>\n</ul>',
  };
}

const entries = [
  entry('0.1.6', 'release-notes', '2026-10-25T13:54:29Z'),
  entry('0.1.5', 'generated', '2026-10-24T06:41:33Z'),
];
const options = { siteUrl: 'https://pohunek.dev', title: 'pohunek ecosystem changelog', limit: 1 };

describe('renderAtomFeed', () => {
  const feed = renderAtomFeed(entries, options);

  test('keeps the newest entries up to the limit', () => {
    expect(feed.match(/<entry>/g)).toHaveLength(1);
    expect(feed).toContain('<updated>2026-10-25T13:54:29Z</updated>');
  });

  test('escapes titles and content', () => {
    expect(feed).toContain('<title>Desktop &lt;companion&gt; v0.1.6</title>');
    expect(feed).toContain('<content type="html">&lt;ul&gt;\n&lt;li&gt;Fix &amp;#x26; ship&lt;/li&gt;');
    expect(feed).not.toContain('<ul>');
  });

  test('links each entry to its anchor on the product page', () => {
    expect(feed).toContain('href="https://pohunek.dev/changelog/companion/#companion-0.1.6"');
  });

  test('marks generated entries', () => {
    const generated = renderAtomFeed(entries.slice(1), options);
    expect(generated).toContain('not curated');
  });

  test('drops characters XML 1.0 does not allow', () => {
    const broken = { ...entries[0], html: '<p>a\u0008b\uD800c 😀</p>' };
    const xml = renderAtomFeed([broken], options);
    expect(xml).toContain('&lt;p&gt;abc 😀&lt;/p&gt;');
  });

  test('is well-formed for an empty timeline', () => {
    expect(renderAtomFeed([], options)).toContain('<updated>1970-01-01T00:00:00.000Z</updated>');
  });
});

describe('renderChangelogText', () => {
  test('lists every release with its date, URL and recorded Markdown', () => {
    const text = renderChangelogText(entries, 'pohunek ecosystem changelog');
    expect(text).toStartWith('# pohunek ecosystem changelog\n\n## Desktop <companion> v0.1.6 - 2026-10-25\n');
    expect(text).toContain('## Desktop <companion> v0.1.5 - 2026-10-24 (generated from pull request titles, not curated)');
    expect(text).toContain('- Fix & ship');
  });
});
