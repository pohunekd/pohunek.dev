import { describe, expect, test } from 'bun:test';
import { parseDocsSyncConfig } from '../scripts/lib/docs-config.ts';
import { parseReleasesConfig } from '../scripts/lib/releases-config.ts';

const PRODUCTS = ['pohunek', 'autoreview'];

function pohunekSource(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    product: 'pohunek',
    routePrefix: 'docs',
    editBranch: 'main',
    pages: [
      { source: 'docs/install.md', route: 'install' },
      { source: 'docs/knowledge/concepts/**/*.md', routeBase: 'docs/knowledge' },
    ],
    installPrompt: { readme: 'README.md', heading: '## Install with an agent', output: 'install-prompt.txt' },
    ...overrides,
  };
}

function autoreviewSource(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    product: 'autoreview',
    routePrefix: 'autoreview',
    editBranch: 'main',
    pages: [{ source: 'docs/policy.md', route: 'policy' }],
    ...overrides,
  };
}

function validConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    contentRoot: 'src/content/docs',
    generatedDir: 'src/data/generated',
    cacheDir: '.cache/docs-sync',
    githubUrl: 'https://github.com',
    rawUrl: 'https://raw.githubusercontent.com',
    sources: [pohunekSource()],
    ...overrides,
  };
}

function withPages(pages: unknown[]): Record<string, unknown> {
  return validConfig({ sources: [pohunekSource({ pages })] });
}

describe('parseDocsSyncConfig', () => {
  test('accepts a complete configuration', () => {
    const config = parseDocsSyncConfig(validConfig(), PRODUCTS);
    expect(config.sources).toHaveLength(1);
    expect(config.sources[0].routePrefix).toBe('docs');
    expect(config.sources[0].pages).toHaveLength(2);
    expect(config.sources[0].installPrompt?.output).toBe('install-prompt.txt');
  });

  test('accepts the committed configuration against the committed products', async () => {
    const releases = parseReleasesConfig(await Bun.file('releases.config.json').json());
    const config = parseDocsSyncConfig(
      await Bun.file('docs-sync.config.json').json(),
      releases.products.map((product) => product.id),
    );
    expect(config.sources.find((source) => source.product === 'pohunek')?.routePrefix).toBe('docs');
  });

  test('accepts a second product with its own route prefix and no install prompt', () => {
    const config = parseDocsSyncConfig(validConfig({ sources: [pohunekSource(), autoreviewSource()] }), PRODUCTS);
    expect(config.sources.map((source) => [source.product, source.routePrefix])).toEqual([
      ['pohunek', 'docs'],
      ['autoreview', 'autoreview'],
    ]);
    expect(config.sources[1].installPrompt).toBeUndefined();
  });

  test('fails when a required key is missing instead of inventing a default', () => {
    const raw = validConfig();
    delete raw.cacheDir;
    expect(() => parseDocsSyncConfig(raw, PRODUCTS)).toThrow('cacheDir must be a non-empty string');
    const source = pohunekSource();
    delete source.editBranch;
    expect(() => parseDocsSyncConfig(validConfig({ sources: [source] }), PRODUCTS)).toThrow(
      'sources[0].editBranch must be a non-empty string',
    );
  });

  test('fails on an empty sources or pages list', () => {
    expect(() => parseDocsSyncConfig(validConfig({ sources: [] }), PRODUCTS)).toThrow(
      'sources must be a non-empty array',
    );
    expect(() => parseDocsSyncConfig(withPages([]), PRODUCTS)).toThrow('pages must be a non-empty array');
  });

  test('rejects a product that releases.config.json does not list', () => {
    expect(() => parseDocsSyncConfig(validConfig(), ['autoreview'])).toThrow(
      'sources[0].product "pohunek" is not a product of releases.config.json',
    );
  });

  test('rejects two sources for one product or one route prefix', () => {
    expect(() =>
      parseDocsSyncConfig(validConfig({ sources: [pohunekSource(), pohunekSource({ routePrefix: 'other' })] }), PRODUCTS),
    ).toThrow('lists product "pohunek" twice');
    expect(() =>
      parseDocsSyncConfig(validConfig({ sources: [pohunekSource(), autoreviewSource({ routePrefix: 'docs' })] }), PRODUCTS),
    ).toThrow('two sources use routePrefix "docs"');
  });

  test.each(['docs/autoreview', 'Docs', '', '../docs'])('rejects route prefix %p', (routePrefix) => {
    expect(() =>
      parseDocsSyncConfig(validConfig({ sources: [pohunekSource(), autoreviewSource({ routePrefix })] }), PRODUCTS),
    ).toThrow('routePrefix');
  });

  test('rejects two sources writing one install prompt', () => {
    const installPrompt = { readme: 'README.md', heading: '## Install', output: 'install-prompt.txt' };
    expect(() =>
      parseDocsSyncConfig(validConfig({ sources: [pohunekSource(), autoreviewSource({ installPrompt })] }), PRODUCTS),
    ).toThrow('two sources write the install prompt "install-prompt.txt"');
  });

  test('requires exactly one of route or routeBase', () => {
    expect(() => parseDocsSyncConfig(withPages([{ source: 'docs/a.md' }]), PRODUCTS)).toThrow(
      'exactly one of "route" or "routeBase"',
    );
    expect(() =>
      parseDocsSyncConfig(withPages([{ source: 'docs/a.md', route: 'a', routeBase: 'docs' }]), PRODUCTS),
    ).toThrow('exactly one of "route" or "routeBase"');
  });

  test('rejects a glob source paired with an explicit route', () => {
    expect(() => parseDocsSyncConfig(withPages([{ source: 'docs/*.md', route: 'x' }]), PRODUCTS)).toThrow(
      'use "routeBase" for globs',
    );
  });

  test('rejects a routeBase that does not contain the source', () => {
    expect(() =>
      parseDocsSyncConfig(withPages([{ source: 'docs/knowledge/a/*.md', routeBase: 'docs/other' }]), PRODUCTS),
    ).toThrow('must live under routeBase');
  });

  test('fails when an install prompt section is incomplete', () => {
    expect(() =>
      parseDocsSyncConfig(
        validConfig({ sources: [pohunekSource({ installPrompt: { readme: 'README.md', output: 'x.txt' } })] }),
        PRODUCTS,
      ),
    ).toThrow('installPrompt.heading must be a non-empty string');
  });
});
