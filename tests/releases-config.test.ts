import { describe, expect, test } from 'bun:test';
import {
  assetNames,
  compareVersions,
  parseReleasesConfig,
  renderWithVersion,
  tagOf,
  versionOfTag,
  type Product,
} from '../scripts/lib/releases-config.ts';

function product(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'plugin',
    name: 'pohunek-work plugin',
    repository: 'zajca/pohunek-work',
    tagPrefix: 'plugin-v',
    version: '0.7.1',
    prerelease: false,
    attested: true,
    signerWorkflow: '.github/workflows/release.yml',
    assets: ['pohunek-work-plugin-{version}-noarch.tar.gz'],
    ...overrides,
  };
}

function config(products: unknown[] = [product()]): Record<string, unknown> {
  return { $comment: 'x', apiUrl: 'https://api.github.com', changelogDir: 'src/data/changelog', products };
}

describe('parseReleasesConfig', () => {
  test('accepts the committed configuration', async () => {
    const parsed = parseReleasesConfig(await Bun.file('releases.config.json').json());
    expect(parsed.products.map((entry) => entry.id)).toEqual([
      'pohunek',
      'companion',
      'android',
      'plugin',
      'launchers',
      'web',
    ]);
  });

  test('fails on a missing key instead of inventing a default', () => {
    const raw = product();
    delete raw.attested;
    expect(() => parseReleasesConfig(config([raw]))).toThrow('attested must be true or false');
  });

  test('rejects an unknown key', () => {
    expect(() => parseReleasesConfig(config([product({ channel: 'beta' })]))).toThrow('unknown key "channel"');
  });

  test('rejects a pre-release pin on a product that follows stable releases only', () => {
    expect(() => parseReleasesConfig(config([product({ version: '0.8.0-pre.1' })]))).toThrow(
      'is a pre-release but prerelease is false',
    );
  });

  test.each(['plugin-', 'V', 'plugin_v', 'Plugin-v'])('rejects tag prefix %p', (tagPrefix) => {
    expect(() => parseReleasesConfig(config([product({ tagPrefix })]))).toThrow('tagPrefix');
  });

  test('rejects an asset name without the version placeholder or with a path', () => {
    expect(() => parseReleasesConfig(config([product({ assets: ['plugin.tar.gz'] })]))).toThrow('{version}');
    expect(() => parseReleasesConfig(config([product({ assets: ['../{version}.tar.gz'] })]))).toThrow('{version}');
  });

  test('rejects two products with one id or one tag space', () => {
    expect(() => parseReleasesConfig(config([product(), product()]))).toThrow('lists product "plugin" twice');
    expect(() => parseReleasesConfig(config([product(), product({ id: 'other' })]))).toThrow(
      'two products use tag prefix',
    );
  });

  test('binds attestations to a release workflow path', () => {
    expect(() => parseReleasesConfig(config([product({ signerWorkflow: undefined })]))).toThrow('signerWorkflow must be');
    expect(() => parseReleasesConfig(config([product({ signerWorkflow: 'release.yml' })]))).toThrow('signerWorkflow must be');
    expect(() =>
      parseReleasesConfig(config([product({ attested: false })])),
    ).toThrow('signerWorkflow is only valid when attested is true');
  });

  test('requires an https API URL', () => {
    expect(() => parseReleasesConfig({ ...config(), apiUrl: 'http://api.github.com' })).toThrow('https URL');
  });
});

describe('compareVersions', () => {
  test('orders numerically and puts a pre-release before its stable release', () => {
    expect(compareVersions('0.10.0', '0.9.9')).toBeGreaterThan(0);
    expect(compareVersions('0.1.0-pre.3', '0.1.0')).toBeLessThan(0);
    expect(compareVersions('0.1.0-pre.10', '0.1.0-pre.9')).toBeGreaterThan(0);
    expect(compareVersions('0.1.0-pre.9', '0.0.9')).toBeGreaterThan(0);
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
  });

  test.each(['v1.2.3', '1.2', '1.2.3-rc.1', '01.2.3', '1.2.3-pre.01'])('rejects %p', (version) => {
    expect(() => compareVersions(version, '1.0.0')).toThrow('X.Y.Z or X.Y.Z-pre.N');
  });
});

describe('tags and assets', () => {
  const plugin = parseReleasesConfig(config()).products[0] as Product;
  const android = parseReleasesConfig(
    config([
      product({
        id: 'android',
        tagPrefix: 'v',
        version: '0.1.0-pre.3',
        prerelease: true,
        attested: false,
        signerWorkflow: undefined,
        assets: ['a-{version}.apk'],
      }),
    ]),
  ).products[0] as Product;

  test('reads the version of a tag of the product only', () => {
    expect(versionOfTag(plugin, 'plugin-v0.7.3')).toBe('0.7.3');
    expect(versionOfTag(plugin, 'web-v0.7.3')).toBeUndefined();
    expect(versionOfTag(plugin, 'plugin-v0.7')).toBeUndefined();
    expect(versionOfTag(android, 'v0.1.0-pre.4')).toBe('0.1.0-pre.4');
  });

  test('ignores a pre-release tag of a product that follows stable releases only', () => {
    expect(versionOfTag(plugin, 'plugin-v0.8.0-pre.1')).toBeUndefined();
  });

  test('builds tag and asset names from the pin', () => {
    expect(tagOf(plugin)).toBe('plugin-v0.7.1');
    expect(assetNames(plugin, '0.7.3')).toEqual(['pohunek-work-plugin-0.7.3-noarch.tar.gz']);
  });
});

describe('renderWithVersion', () => {
  test('replaces one product version and keeps the rest', () => {
    const raw = config([product(), product({ id: 'web', tagPrefix: 'web-v', version: '0.3.1' })]);
    const rendered = JSON.parse(renderWithVersion(raw, 'web', '0.3.2'));
    expect(rendered.products.map((entry: { version: string }) => entry.version)).toEqual(['0.7.1', '0.3.2']);
    expect(Object.keys(rendered)).toEqual(['$comment', 'apiUrl', 'changelogDir', 'products']);
  });

  test('fails for an unknown product', () => {
    expect(() => renderWithVersion(config(), 'nope', '1.0.0')).toThrow('has no product "nope"');
  });
});
