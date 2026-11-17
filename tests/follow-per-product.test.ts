import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  followEach,
  sanitizeCell,
  sha256Hex,
  verifyAssets,
  writeSummary,
  type Followed,
  type GithubAsset,
  type GithubRelease,
} from '../scripts/follow-releases.ts';
import type { Product } from '../scripts/lib/releases-config.ts';

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

function fetcherFor(releases: readonly GithubRelease[]) {
  const bodies = new Map<string, Uint8Array>();
  for (const entry of releases) {
    for (const asset of entry.assets) {
      const name = asset.name.replace(/\.sha256$/, '');
      const version = /(\d+\.\d+\.\d+)$/.exec(name.replace(/^pohunek-web-/, '').replace(/-linux-x86_64\.tar\.gz$/, ''))?.[1];
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

describe('writeSummary', () => {
  test('writes a per-product table with failures marked', async () => {
    const summary = join(scratch, 'summary.md');
    process.env.GITHUB_STEP_SUMMARY = summary;
    await writeSummary([
      { product: 'pohunek', moved: 'pohunek v0.44.0', failed: false },
      { product: 'web', failed: true, reason: 'asset x does not match\nsecond line | pipe' },
      { product: 'android', moved: undefined, failed: false },
    ]);
    const text = await Bun.file(summary).text();
    expect(text).toContain('| product | result | detail |');
    expect(text).toContain('| pohunek | moved | pohunek v0.44.0 |');
    expect(text).toContain('| web | FAILED |');
    expect(text).toContain('second line \\| pipe');
    expect(text).toContain('| android | unchanged |');
  });

  test('does nothing without GITHUB_STEP_SUMMARY', async () => {
    await writeSummary([{ product: 'a', failed: true, reason: 'x' }]);
  });

  test('sanitizes table cells', () => {
    expect(sanitizeCell('a|b\nc')).toBe('a\\|b c');
  });
});
