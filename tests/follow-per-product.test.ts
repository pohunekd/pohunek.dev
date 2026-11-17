import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  PARTIAL_FAILURE,
  followEach,
  followProduct,
  runFollow,
  sanitizeCell,
  sha256Hex,
  verifyAssets,
  type Followed,
  type GithubAsset,
  type GithubRelease,
  type ReleaseFetcher,
} from '../scripts/follow-releases.ts';
import { parseOutcomeLines } from '../scripts/follow-outcomes.ts';
import { mergeFailures, renderReport } from '../scripts/follow-report.ts';
import { mergeSyncFailures } from '../scripts/merge-failed-sync.ts';
import { parseReleasesConfig, type Product } from '../scripts/lib/releases-config.ts';

let scratch: string;

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'follow-per-product-'));
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
  delete process.env.GITHUB_STEP_SUMMARY;
});

function product(overrides: Record<string, unknown> = {}): Product {
  return {
    id: 'web',
    name: 'Web control center',
    repository: 'zajca/pohunek-work',
    tagPrefix: 'web-v',
    version: '0.4.0',
    prerelease: false,
    attested: false,
    signerWorkflow: undefined,
    assets: ['pohunek-web-{version}-linux-x86_64.tar.gz'],
    ...overrides,
  } as Product;
}

/** Fake release with asset bytes that match its .sha256 line and GitHub digest. */
function release(version: string, body = 'notes'): GithubRelease {
  const bytes = new TextEncoder().encode(`asset ${version}`);
  const hex = createHash('sha256').update(bytes).digest('hex');
  const name = `pohunek-web-${version}-linux-x86_64.tar.gz`;
  return {
    tagName: `web-v${version}`,
    draft: false,
    prerelease: false,
    publishedAt: '2026-11-16T10:00:00Z',
    htmlUrl: `https://github.com/zajca/pohunek-work/releases/tag/web-v${version}`,
    body,
    assets: [
      { name, downloadUrl: `https://example.invalid/${name}`, digest: `sha256:${hex}` },
      {
        name: `${name}.sha256`,
        downloadUrl: `https://example.invalid/${name}.sha256`,
        digest: undefined,
      },
    ],
  };
}

/** Fake GitHub boundary: every download returns the bytes the checksums describe. */
function fetcherFor(releases: readonly GithubRelease[]): ReleaseFetcher {
  const bodies = new Map<string, Uint8Array>();
  for (const entry of releases) {
    for (const asset of entry.assets) {
      const name = asset.name.replace(/\.sha256$/, '');
      const version = /(\d+\.\d+\.\d+)$/
        .exec(name.replace(/^pohunek-web-/, '').replace(/-linux-x86_64\.tar\.gz$/, ''))?.[1];
      if (asset.name.endsWith('.sha256')) {
        const bytes = new TextEncoder().encode(`asset ${version}`);
        const hex = createHash('sha256').update(bytes).digest('hex');
        bodies.set(asset.downloadUrl, new TextEncoder().encode(`${hex}  ${name}\n`));
      } else {
        bodies.set(asset.downloadUrl, new TextEncoder().encode(`asset ${version}`));
      }
    }
  }
  return {
    async listReleases(): Promise<GithubRelease[]> {
      return [...releases];
    },
    async downloadAsset(asset: GithubAsset): Promise<Uint8Array> {
      const bytes = bodies.get(asset.downloadUrl);
      if (bytes === undefined) {
        throw new Error(`no fake bytes for ${asset.name}`);
      }
      return bytes;
    },
    async compareCommits(): Promise<[]> {
      return [];
    },
    async getPull(): Promise<undefined> {
      return undefined;
    },
  };
}

/**
 * Scratch checkout with two fake products (`web` and `companion`) sharing one fake repository:
 * the fake releases answer per tag, the assets per URL, so both products move on their own.
 */
function scratchRoot(): { root: string; releases: GithubRelease[]; bad: GithubRelease } {
  const root = mkdtempSync(join(tmpdir(), 'follow-run-'));
  cpSync(join(import.meta.dir, '..', 'releases.config.json'), join(root, 'releases.config.json'));
  cpSync(join(import.meta.dir, '..', 'src', 'data', 'changelog'), join(root, 'changelog'), { recursive: true });
  const raw = JSON.parse(readFileSync(join(root, 'releases.config.json'), 'utf8')) as Record<string, unknown>;
  raw.changelogDir = 'changelog';
  raw.products = (raw.products as Record<string, unknown>[]).slice(0, 2);
  const ids = ['web', 'companion'];
  const tags = ['web-v', 'companion-v'];
  for (const [index, entry] of (raw.products as Record<string, unknown>[]).entries()) {
    entry.id = ids[index];
    entry.name = ids[index];
    entry.repository = 'example/fake';
    entry.tagPrefix = tags[index];
    entry.version = '0.4.0';
    entry.prerelease = false;
    entry.attested = false;
    delete entry.signerWorkflow;
    delete entry.screenshotManifest;
    delete entry.mediaManifest;
    entry.assets = ['pohunek-web-{version}-linux-x86_64.tar.gz'];
  }
  writeFileSync(join(root, 'releases.config.json'), `${JSON.stringify(raw, null, 2)}\n`);
  const releases = [release('0.4.1'), release('0.4.1')].map((entry, index) =>
    index === 0
      ? entry
      : {
          ...entry,
          tagName: 'companion-v0.4.1',
          htmlUrl: entry.htmlUrl.replace('web-v0.4.1', 'companion-v0.4.1'),
        },
  );
  const bad: GithubRelease = {
    ...releases[1],
    assets: releases[1].assets.map((asset) =>
      asset.name.endsWith('.sha256') ? asset : { ...asset, digest: `sha256:${'0'.repeat(64)}` },
    ),
  };
  return { root, releases, bad };
}

describe('verifyAssets keeps the security checks', () => {
  test('accepts matching checksums and digests without network', async () => {
    const entry = product();
    const target = { version: '0.4.1', release: release('0.4.1') };
    await verifyAssets(fetcherFor([target.release]), entry, target);
  });

  test('rejects a checksum mismatch', async () => {
    const entry = product();
    const bad = release('0.4.1');
    const fetcher = fetcherFor([bad]);
    const original = fetcher.downloadAsset;
    fetcher.downloadAsset = async (asset: GithubAsset) => {
      if (!asset.name.endsWith('.sha256')) {
        return new TextEncoder().encode('tampered bytes');
      }
      return original(asset);
    };
    await expect(verifyAssets(fetcher, entry, { version: '0.4.1', release: bad })).rejects.toThrow(
      'does not match',
    );
  });

  test('rejects a digest mismatch', async () => {
    const entry = product();
    const bad: GithubRelease = {
      ...release('0.4.1'),
      assets: release('0.4.1').assets.map((asset) =>
        asset.name.endsWith('.sha256') ? asset : { ...asset, digest: `sha256:${'0'.repeat(64)}` },
      ),
    };
    await expect(
      verifyAssets(fetcherFor([bad]), entry, { version: '0.4.1', release: bad }),
    ).rejects.toThrow('the digest GitHub recorded');
  });

  test('sha256Hex matches node crypto', () => {
    expect(sha256Hex(new TextEncoder().encode('abc'))).toBe(
      createHash('sha256').update('abc').digest('hex'),
    );
  });
});

describe('followEach records per-product outcomes', () => {
  test('one product fails, the others move', async () => {
    const results = await followEach([product({ id: 'a' }), product({ id: 'b' }), product({ id: 'c' })], async (
      entry,
    ): Promise<Followed> => {
      if (entry.id === 'b') {
        throw new Error('b: boom');
      }
      return { moved: `${entry.id} moved`, recorded: 1 };
    });
    expect(results.moved).toEqual(['a moved', 'c moved']);
    expect(results.recorded).toBe(2);
    expect(results.outcomes).toEqual([
      { product: 'a', moved: 'a moved', failed: false },
      { product: 'b', failed: true, reason: 'b: boom' },
      { product: 'c', moved: 'c moved', failed: false },
    ]);
  });

  test('all fail', async () => {
    const results = await followEach([product({ id: 'a' }), product({ id: 'b' })], async (entry): Promise<Followed> => {
      throw new Error(`${entry.id} failed`);
    });
    expect(results.moved).toEqual([]);
    expect(results.recorded).toBe(0);
    expect(results.outcomes.every((outcome) => outcome.failed)).toBe(true);
  });

  test('none changed', async () => {
    const results = await followEach([product({ id: 'a' })], async () => ({ recorded: 0 }));
    expect(results.moved).toEqual([]);
    expect(results.outcomes).toEqual([{ product: 'a', moved: undefined, failed: false }]);
  });
});

describe('runFollow drives the real wiring', () => {
  test('one product passes, one fails an asset check: only the first pin moves', async () => {
    const { root, releases, bad } = scratchRoot();
    try {
      const config = parseReleasesConfig(JSON.parse(readFileSync(join(root, 'releases.config.json'), 'utf8')));
      const github: ReleaseFetcher = {
        async listReleases(): Promise<GithubRelease[]> {
          return [releases[0], bad];
        },
        async downloadAsset(asset: GithubAsset): Promise<Uint8Array> {
          return fetcherFor([releases[0], releases[1]]).downloadAsset(asset);
        },
        async compareCommits(): Promise<[]> {
          return [];
        },
        async getPull(): Promise<undefined> {
          return undefined;
        },
      };
      // The bad digest must fail even though the bytes are right, so ask for the products in order.
      const web = config.products[0];
      const companion = config.products[1];
      const first = await followProduct(github, config, 'https://github.com', root, web, [releases[0]], undefined);
      expect(first.moved).toBeDefined();
      await expect(
        followProduct(github, config, 'https://github.com', root, companion, [bad], undefined),
      ).rejects.toThrow('the digest GitHub recorded');
      const pinned = parseReleasesConfig(JSON.parse(readFileSync(join(root, 'releases.config.json'), 'utf8')));
      expect(pinned.products[0].version).toBe('0.4.1');
      expect(pinned.products[1].version).toBe('0.4.0');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('runFollow moves only the passed pin through the exported wiring', async () => {
    const { root, releases, bad } = scratchRoot();
    try {
      const config = parseReleasesConfig(JSON.parse(readFileSync(join(root, 'releases.config.json'), 'utf8')));
      const real = fetcherFor([releases[0], releases[1]]);
      const github: ReleaseFetcher = {
        async listReleases(): Promise<GithubRelease[]> {
          return [releases[0], bad];
        },
        async downloadAsset(asset: GithubAsset): Promise<Uint8Array> {
          return real.downloadAsset(asset);
        },
        async compareCommits(): Promise<[]> {
          return [];
        },
        async getPull(): Promise<undefined> {
          return undefined;
        },
      };
      const { outcomes, moved } = await runFollow({
        root,
        args: {},
        config,
        github,
        githubUrl: 'https://github.com',
      });
      expect(moved).toHaveLength(1);
      expect(outcomes.find((outcome) => outcome.product === 'web')).toEqual({
        product: 'web',
        moved: moved[0],
        failed: false,
      });
      expect(outcomes.find((outcome) => outcome.product === 'companion')?.failed).toBe(true);
      expect(PARTIAL_FAILURE).toBe(2);
      const pinned = parseReleasesConfig(JSON.parse(readFileSync(join(root, 'releases.config.json'), 'utf8')));
      expect(pinned.products.find((entry) => entry.id === 'web')?.version).toBe('0.4.1');
      expect(pinned.products.find((entry) => entry.id === 'companion')?.version).toBe('0.4.0');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('per-product plumbing', () => {
  test('outcome lines split into failed and moved products', () => {
    expect(
      parseOutcomeLines([
        '{"product":"pohunek","failed":false,"moved":"pohunek v0.44.0"}',
        '{"product":"web","failed":true,"reason":"boom"}',
        '',
      ]),
    ).toEqual({
      failedProducts: ['web'],
      failedReasons: ['boom'],
      movedProducts: ['pohunek v0.44.0'],
    });
  });

  test('sync failures merge onto the collect failures', () => {
    expect(
      mergeSyncFailures(['web'], ['boom'], ['pohunek v1'], [{ script: 'sync-docs', product: 'android', reason: 'bam' }]),
    ).toEqual({
      failedProducts: ['web', 'android'],
      failedReasons: ['boom', 'bam'],
      movedProducts: ['pohunek v1'],
      failed: true,
    });
    expect(mergeSyncFailures([], [], [], []).failed).toBe(false);
  });

  test('report renders one row per moved or failed product', () => {
    const text = renderReport({
      collectFailed: ['web'],
      collectReasons: ['boom'],
      collectMoved: ['pohunek v0.44.0', 'web v0.5.0'],
      verifyFailed: ['android'],
      verifyReasons: ['docs line 1\npipe | here'],
    });
    expect(text).toContain('| pohunek | moved | pohunek v0.44.0 |');
    expect(text).toContain('| web | FAILED | collect: boom |');
    expect(text).toContain('pipe \\| here');
  });

  test('mergeFailures throws on mismatched input lengths', () => {
    expect(() => mergeFailures({ collectFailed: ['a'], collectReasons: [], collectMoved: [], verifyFailed: [], verifyReasons: [] })).toThrow();
  });

  test('sanitizes table cells', () => {
    expect(sanitizeCell('a|b\nc')).toBe('a\\|b c');
  });
});
