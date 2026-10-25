import { describe, expect, test } from 'bun:test';
import { parseDocsSyncConfig } from '../scripts/lib/docs-config.ts';

function validConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    editBranch: 'main',
    routePrefix: 'docs',
    contentRoot: 'src/content/docs',
    generatedDir: 'src/data/generated',
    cacheDir: '.cache/docs-sync',
    githubUrl: 'https://github.com',
    rawUrl: 'https://raw.githubusercontent.com',
    pages: [
      { source: 'docs/install.md', route: 'install' },
      { source: 'docs/knowledge/concepts/**/*.md', routeBase: 'docs/knowledge' },
    ],
    installPrompt: { readme: 'README.md', heading: '## Install with an agent', output: 'install-prompt.txt' },
    ...overrides,
  };
}

describe('parseDocsSyncConfig', () => {
  test('accepts a complete configuration', () => {
    const config = parseDocsSyncConfig(validConfig());
    expect(config.routePrefix).toBe('docs');
    expect(config.pages).toHaveLength(2);
    expect(config.installPrompt.output).toBe('install-prompt.txt');
  });

  test('fails when a required key is missing instead of inventing a default', () => {
    const raw = validConfig();
    delete raw.cacheDir;
    expect(() => parseDocsSyncConfig(raw)).toThrow('cacheDir must be a non-empty string');
  });

  test('fails on an empty pages list', () => {
    expect(() => parseDocsSyncConfig(validConfig({ pages: [] }))).toThrow('pages must be a non-empty array');
  });

  test('requires exactly one of route or routeBase', () => {
    expect(() => parseDocsSyncConfig(validConfig({ pages: [{ source: 'docs/a.md' }] }))).toThrow(
      'exactly one of "route" or "routeBase"',
    );
    expect(() =>
      parseDocsSyncConfig(validConfig({ pages: [{ source: 'docs/a.md', route: 'a', routeBase: 'docs' }] })),
    ).toThrow('exactly one of "route" or "routeBase"');
  });

  test('rejects a glob source paired with an explicit route', () => {
    expect(() =>
      parseDocsSyncConfig(validConfig({ pages: [{ source: 'docs/*.md', route: 'x' }] })),
    ).toThrow('use "routeBase" for globs');
  });

  test('rejects a routeBase that does not contain the source', () => {
    expect(() =>
      parseDocsSyncConfig(validConfig({ pages: [{ source: 'docs/knowledge/a/*.md', routeBase: 'docs/other' }] })),
    ).toThrow('must live under routeBase');
  });

  test('fails when the install prompt section is missing', () => {
    expect(() => parseDocsSyncConfig(validConfig({ installPrompt: undefined }))).toThrow(
      'installPrompt must be a JSON object',
    );
  });
});
