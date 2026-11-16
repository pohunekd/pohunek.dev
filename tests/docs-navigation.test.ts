import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { StarlightRouteData } from '@astrojs/starlight/route-data';
import { syncedSidebar, syncedSlugs } from '../src/config/synced-sidebar.mjs';
import { productNavigation } from '../src/lib/docs-navigation.ts';

type Entry = StarlightRouteData['sidebar'][number];
type Link = NonNullable<StarlightRouteData['pagination']['prev']>;

function link(href: string, isCurrent = false): Link {
  return { type: 'link', label: href, href, isCurrent, badge: undefined, attrs: {} };
}

function group(label: string, entries: Entry[]): Entry {
  return { type: 'group', label, entries, collapsed: false, badge: undefined };
}

const sidebar: Entry[] = [
  link('/docs/'),
  group('Safety', [link('/docs/safety/trust-model/', true)]),
  link('/autoreview/features/'),
  group('Concepts', [group('Nested', [link('/autoreview/concepts/how-it-works/')])]),
];

describe('productNavigation', () => {
  test('keeps the top-level entries of the page product only', () => {
    const pohunek = productNavigation({ sidebar, pagination: {} }, '/docs/safety/trust-model/');
    expect(pohunek.sidebar).toEqual(sidebar.slice(0, 2));
    const autoreview = productNavigation({ sidebar, pagination: {} }, '/autoreview/features/');
    expect(autoreview.sidebar).toEqual(sidebar.slice(2));
  });

  test('drops previous and next links into another product', () => {
    const last = productNavigation(
      { sidebar, pagination: { prev: link('/docs/'), next: link('/autoreview/features/') } },
      '/docs/safety/trust-model/',
    );
    expect(last.pagination).toEqual({ prev: link('/docs/'), next: undefined });
    const first = productNavigation(
      { sidebar, pagination: { prev: link('/docs/safety/trust-model/'), next: link('/autoreview/concepts/how-it-works/') } },
      '/autoreview/features/',
    );
    expect(first.pagination).toEqual({ prev: undefined, next: link('/autoreview/concepts/how-it-works/') });
  });

  test('does not take a prefix that only starts like the page product', () => {
    const navigation = productNavigation({ sidebar: [link('/docsearch/')], pagination: {} }, '/docs/');
    expect(navigation.sidebar).toEqual([]);
  });
});

describe('syncedSidebar', () => {
  const listed = [
    { label: 'Overview', link: '/autoreview/' },
    { label: 'Start here', items: [{ label: 'Install', slug: 'autoreview/install' }] },
    { label: 'Concepts', items: ['autoreview/concepts/a', 'autoreview/concepts/b'] },
  ];

  test('keeps the sidebar as it is when the synced pages match it', () => {
    const warnings: string[] = [];
    const slugs = ['autoreview/concepts/a', 'autoreview/concepts/b', 'autoreview/install'];
    expect(syncedSidebar(listed, slugs, 'More pages', (message) => warnings.push(message))).toEqual(listed);
    expect(warnings).toEqual([]);
  });

  test('leaves out a listed page the release no longer has and a group left empty', () => {
    const warnings: string[] = [];
    const sidebar = syncedSidebar(listed, ['autoreview/concepts/b'], 'More pages', (message) => warnings.push(message));
    expect(sidebar).toEqual([listed[0], { label: 'Concepts', items: ['autoreview/concepts/b'] }]);
    expect(warnings).toEqual([
      'sidebar: autoreview/install is not in the synced docs; left out',
      'sidebar: autoreview/concepts/a is not in the synced docs; left out',
    ]);
  });

  test('shows unlisted pages in a trailing group', () => {
    const warnings: string[] = [];
    const slugs = ['autoreview/concepts/a', 'autoreview/concepts/b', 'autoreview/guides/new', 'autoreview/install'];
    const sidebar = syncedSidebar(listed, slugs, 'More pages', (message) => warnings.push(message));
    expect(sidebar).toEqual([...listed, { label: 'More pages', items: ['autoreview/guides/new'] }]);
    expect(warnings).toEqual(['sidebar: autoreview/guides/new is not listed; shown under "More pages"']);
  });

  test('does not add an unlisted page whose path is not a plain slug', () => {
    const warnings: string[] = [];
    const slugs = ['autoreview/concepts/a', 'autoreview/concepts/b', 'autoreview/install', 'autoreview/Odd_Name'];
    expect(syncedSidebar(listed, slugs, 'More pages', (message) => warnings.push(message))).toEqual(listed);
    expect(warnings).toEqual(['sidebar: autoreview/Odd_Name is not listed and not a plain slug; left out']);
  });
});

describe('syncedSlugs', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir !== undefined) {
      rmSync(dir, { recursive: true, force: true });
      dir = undefined;
    }
  });

  test('derives the slugs of the synced pages', () => {
    dir = mkdtempSync(join(tmpdir(), 'synced-slugs-'));
    mkdirSync(join(dir, 'autoreview', 'concepts'), { recursive: true });
    for (const file of ['index.md', 'install.md', 'guides.md', 'concepts/how-it-works.md']) {
      writeFileSync(join(dir, 'autoreview', file), '# Page\n');
    }
    expect(syncedSlugs(dir, 'autoreview')).toEqual([
      'autoreview',
      'autoreview/concepts/how-it-works',
      'autoreview/guides',
      'autoreview/install',
    ]);
  });

  test('fails when the product was never synced', () => {
    dir = mkdtempSync(join(tmpdir(), 'synced-slugs-'));
    expect(() => syncedSlugs(dir as string, 'autoreview')).toThrow('run scripts/sync-docs.ts first');
  });
});
