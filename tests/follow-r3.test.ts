import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { main as followMain, type GithubAsset, type GithubRelease, type ReleaseFetcher } from '../scripts/follow-releases.ts';
import { outputLines } from '../scripts/follow-outcomes.ts';
import { commitSummary, parseMoved } from '../scripts/commit-summary.ts';
import { parseFailedProducts, readFailedSync } from '../scripts/lib/failed-sync.ts';
import { revertProducts } from '../scripts/revert-products.ts';
import { main as syncDocs } from '../scripts/sync-docs.ts';
import { main as syncMedia } from '../scripts/sync-media.ts';

let scratch: string;

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'follow-r3-'));
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

const RELEASE = {
  tag: 'web-v0.4.1',
  version: '0.4.1',
  publishedAt: '2026-11-16T10:00:00Z',
  prerelease: false,
  url: 'https://example.invalid/web-v0.4.1',
  source: 'release-notes',
  markdown: 'notes',
};

function product(id: string, version: string): Record<string, unknown> {
  return {
    id,
    name: id,
    repository: `example/${id}`,
    tagPrefix: `${id}-v`,
    version,
    prerelease: false,
    attested: false,
    assets: [`${id}-{version}.tar.gz`],
  };
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function git(cwd: string, ...args: string[]): string {
  const result = Bun.spawnSync(
    ['git', '-c', 'user.name=test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', ...args],
    { cwd, stdout: 'pipe', stderr: 'pipe' },
  );
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(' ')}: ${result.stderr.toString()}`);
  }
  return result.stdout.toString();
}

function config(versions: Record<string, string>): Record<string, unknown> {
  return {
    apiUrl: 'https://api.example.invalid',
    changelogDir: 'changelog',
    products: Object.entries(versions).map(([id, version]) => product(id, version)),
  };
}

describe('revert-products puts failed products back on the base commit', () => {
  /** Base commit: web and companion at 0.4.0, web has a changelog, companion has none. The tree then moves both. */
  function scratchRepo(): string {
    const root = join(scratch, 'repo');
    mkdirSync(root);
    git(root, 'init', '--quiet');
    writeJson(join(root, 'releases.config.json'), config({ web: '0.4.0', companion: '0.4.0' }));
    writeJson(join(root, 'changelog', 'web.json'), { product: 'web', releases: [] });
    git(root, 'add', '.');
    git(root, 'commit', '--quiet', '-m', 'base');
    writeJson(join(root, 'releases.config.json'), config({ web: '0.4.1', companion: '0.4.1' }));
    writeJson(join(root, 'changelog', 'web.json'), { product: 'web', releases: [RELEASE] });
    writeJson(join(root, 'changelog', 'companion.json'), {
      product: 'companion',
      releases: [{ ...RELEASE, tag: 'companion-v0.4.1' }],
    });
    return root;
  }

  const versionsOf = (root: string): Record<string, string> =>
    Object.fromEntries(
      (JSON.parse(readFileSync(join(root, 'releases.config.json'), 'utf8')).products as { id: string; version: string }[]).map(
        (entry) => [entry.id, entry.version],
      ),
    );

  test('the failed product goes back to its base pin and changelog, the other keeps its new state', async () => {
    const root = scratchRepo();
    const result = await revertProducts(root, 'HEAD', '["web"]');
    expect(result.products).toEqual(['web']);
    expect(versionsOf(root)).toEqual({ web: '0.4.0', companion: '0.4.1' });
    expect(JSON.parse(readFileSync(join(root, 'changelog', 'web.json'), 'utf8'))).toEqual({ product: 'web', releases: [] });
    expect(existsSync(join(root, 'changelog', 'companion.json'))).toBe(true);
  });

  test('a changelog the base commit has no file for is removed', async () => {
    const root = scratchRepo();
    await revertProducts(root, 'HEAD', '["companion"]');
    expect(versionsOf(root)).toEqual({ web: '0.4.1', companion: '0.4.0' });
    expect(existsSync(join(root, 'changelog', 'companion.json'))).toBe(false);
    expect(JSON.parse(readFileSync(join(root, 'changelog', 'web.json'), 'utf8')).releases).toHaveLength(1);
  });

  test('an empty list changes nothing', async () => {
    const root = scratchRepo();
    expect((await revertProducts(root, 'HEAD', '')).changed).toEqual([]);
    expect(versionsOf(root)).toEqual({ web: '0.4.1', companion: '0.4.1' });
  });

  test('an unknown product is refused before anything is written', async () => {
    const root = scratchRepo();
    await expect(revertProducts(root, 'HEAD', '["web","evil"]')).rejects.toThrow('unknown product "evil"');
    expect(versionsOf(root)).toEqual({ web: '0.4.1', companion: '0.4.1' });
  });
});

describe('publish-side validation of the failed product list', () => {
  const known = ['web', 'companion'];

  test('accepts empty text and known ids', () => {
    expect(parseFailedProducts('', known)).toEqual([]);
    expect(parseFailedProducts('["web"]', known)).toEqual(['web']);
  });

  test('refuses an unknown id', () => {
    expect(() => parseFailedProducts('["web","../etc"]', known)).toThrow('unknown product');
  });

  test('refuses an oversize list', () => {
    expect(() => parseFailedProducts(JSON.stringify(['web'.padEnd(5000, 'x')]), known)).toThrow('characters long');
    expect(() => parseFailedProducts('["web","companion","web"]', known)).toThrow('names 3 products');
  });

  test('refuses a repeated id, non-strings, non-arrays and non-JSON', () => {
    expect(() => parseFailedProducts('["web","web"]', known)).toThrow('twice');
    expect(() => parseFailedProducts('[1]', known)).toThrow('array of product ids');
    expect(() => parseFailedProducts('{"web":1}', known)).toThrow('array of product ids');
    expect(() => parseFailedProducts('web', known)).toThrow('not JSON');
  });
});

describe('commit summary', () => {
  test('leaves out the products that were reverted', () => {
    const moved = parseMoved('[{"product":"web","moved":"Web v1"},{"product":"companion","moved":"Desktop companion v2"}]');
    expect(commitSummary(moved, ['web'])).toBe('Follow Desktop companion v2');
    expect(commitSummary(moved, ['web', 'companion'])).toBe('Record ecosystem changelog');
    expect(commitSummary([], [])).toBe('Record ecosystem changelog');
  });
});

describe('sync --keep-going with a fake source failing for one product', () => {
  /** Two local git repositories behind a file:// URL; only the first one holds the pinned tag. */
  function scratchSite(): string {
    const root = join(scratch, 'site');
    const remotes = join(scratch, 'remotes');
    mkdirSync(root);
    for (const [id, tagged] of [['good', true], ['broken', false]] as const) {
      const repo = join(remotes, 'example', `${id}.git`);
      mkdirSync(repo, { recursive: true });
      git(repo, 'init', '--quiet', '-b', 'main');
      writeFileSync(join(repo, 'README.md'), `# ${id}\n\nHello from ${id}.\n`);
      git(repo, 'add', '.');
      git(repo, 'commit', '--quiet', '-m', 'init');
      if (tagged) {
        git(repo, 'tag', `${id}-v1.0.0`);
      }
    }
    writeJson(join(root, 'releases.config.json'), config({ good: '1.0.0', broken: '1.0.0' }));
    writeJson(join(root, 'docs-sync.config.json'), {
      contentRoot: 'content',
      generatedDir: 'generated',
      cacheDir: '.cache/docs-sync',
      githubUrl: `file://${remotes}`,
      rawUrl: 'https://raw.example.invalid',
      sources: ['good', 'broken'].map((id) => ({
        product: id,
        routePrefix: id,
        editBranch: 'main',
        pages: [{ source: 'README.md', route: 'readme' }],
      })),
    });
    return root;
  }

  test('the other product syncs and failed-sync.json names the failing one', async () => {
    const root = scratchSite();
    await syncDocs(['--keep-going'], root);
    expect(existsSync(join(root, 'content', 'good', 'readme.md'))).toBe(true);
    expect(existsSync(join(root, 'content', 'broken'))).toBe(false);
    const failures = await readFailedSync(join(root, 'failed-sync.json'));
    expect(failures.map((failure) => [failure.script, failure.product])).toEqual([['sync-docs', 'broken']]);
  });

  test('without --keep-going the failure aborts the run', async () => {
    const root = scratchSite();
    await expect(syncDocs([], root)).rejects.toThrow();
    expect(existsSync(join(root, 'failed-sync.json'))).toBe(false);
  });

  test('a clone failure of android under --keep-going is recorded, not thrown', async () => {
    const root = join(scratch, 'media-site');
    mkdirSync(root);
    const android = { ...product('android', '1.0.0'), mediaManifest: 'media/manifest.json' };
    writeJson(join(root, 'releases.config.json'), { ...config({}), products: [android] });
    writeJson(join(root, 'docs-sync.config.json'), {
      contentRoot: 'content',
      generatedDir: 'generated',
      cacheDir: '.cache/docs-sync',
      githubUrl: `file://${join(scratch, 'no-remotes')}`,
      rawUrl: 'https://raw.example.invalid',
      sources: [{ product: 'android', routePrefix: 'android', editBranch: 'main', pages: [{ source: 'README.md', route: 'readme' }] }],
    });
    await syncMedia(['--keep-going'], root);
    const failures = await readFailedSync(join(root, 'failed-sync.json'));
    expect(failures.map((failure) => [failure.script, failure.product])).toEqual([['sync-media', 'android']]);
    await expect(syncMedia([], root)).rejects.toThrow();
  });
});

describe('follow-releases main maps outcomes to output lines and the exit status', () => {
  function fakeGithub(): ReleaseFetcher {
    const releaseFor = (id: string, digest: string): GithubRelease => {
      const name = `${id}-0.4.1.tar.gz`;
      const bytes = new TextEncoder().encode(`asset ${id}`);
      const hex = createHash('sha256').update(bytes).digest('hex');
      return {
        tagName: `${id}-v0.4.1`,
        draft: false,
        prerelease: false,
        publishedAt: '2026-11-16T10:00:00Z',
        htmlUrl: `https://example.invalid/${id}-v0.4.1`,
        body: 'notes',
        assets: [
          { name, downloadUrl: `https://example.invalid/${name}`, digest: `sha256:${digest === '' ? hex : digest}` },
          { name: `${name}.sha256`, downloadUrl: `https://example.invalid/${name}.sha256`, digest: undefined },
        ],
      };
    };
    return {
      async listReleases(repository: string): Promise<GithubRelease[]> {
        const id = repository.split('/')[1];
        // companion's digest does not match its bytes: its asset check fails.
        return [releaseFor(id, id === 'companion' ? '0'.repeat(64) : '')];
      },
      async downloadAsset(asset: GithubAsset): Promise<Uint8Array> {
        const id = asset.name.split('-0.4.1')[0];
        const bytes = new TextEncoder().encode(`asset ${id}`);
        if (asset.name.endsWith('.sha256')) {
          const hex = createHash('sha256').update(bytes).digest('hex');
          return new TextEncoder().encode(`${hex}  ${asset.name.replace(/\.sha256$/, '')}\n`);
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

  function scratchSiteRoot(): string {
    const root = join(scratch, 'follow-site');
    mkdirSync(root);
    writeJson(join(root, 'releases.config.json'), config({ web: '0.4.0', companion: '0.4.0' }));
    writeJson(join(root, 'docs-sync.config.json'), { githubUrl: 'https://github.com' });
    mkdirSync(join(root, 'changelog'));
    return root;
  }

  test('one product passes, one fails: exit status 2, the output lines are valid, only the first pin moves', async () => {
    const root = scratchSiteRoot();
    const lines: string[] = [];
    const status = await followMain({ argv: [], root, github: fakeGithub(), write: (line) => lines.push(line) });
    expect(status).toBe(2);
    expect(lines.map((line) => JSON.parse(line).product)).toEqual(['web', 'companion']);

    const output = outputLines(status === 2, lines);
    for (const line of output) {
      expect(line).toMatch(/^[a-z_]+=[^\n]*$/);
    }
    expect(output[0]).toBe('failed=true');
    expect(output).toContain('failed_products=["companion"]');
    expect(output.find((line) => line.startsWith('moved_products='))).toContain('"product":"web"');

    const pins = Object.fromEntries(
      (JSON.parse(readFileSync(join(root, 'releases.config.json'), 'utf8')).products as { id: string; version: string }[]).map(
        (entry) => [entry.id, entry.version],
      ),
    );
    expect(pins).toEqual({ web: '0.4.1', companion: '0.4.0' });
  });

  test('every product passing exits 0', async () => {
    const root = scratchSiteRoot();
    const github = fakeGithub();
    const status = await followMain({
      argv: ['--product', 'web'],
      root,
      github,
      write: () => undefined,
    });
    expect(status).toBe(0);
  });
});
