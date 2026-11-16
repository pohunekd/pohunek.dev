import { describe, expect, test } from 'bun:test';
import type { StarlightRouteData } from '@astrojs/starlight/route-data';
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
