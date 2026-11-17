#!/usr/bin/env bun
// Puts every product named in FAILED_SYNC_PRODUCTS (a JSON array of product ids) back on its
// base-commit state: its pin in releases.config.json and its src/data/changelog/<product>.json, both
// read with `git show <base>:<path>`. Every other product keeps what the working tree holds.
// The publish job runs this on collect's artifact and the verify job runs it before the build, so both
// see the same tree. It imports no npm package, so it may run where no dependency is installed
// (`bun --no-install`). Usage: revert-products <base-commit>; run it inside the checkout.
// The product list is validated against the base commit's config before anything is written.
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { parseProductChangelog } from './lib/changelog.ts';
import { parseFailedProducts } from './lib/failed-sync.ts';
import { findProduct, parseReleasesConfig, renderWithVersion } from './lib/releases-config.ts';

const CONFIG_FILE = 'releases.config.json';
/** The message git prints for a path the commit does not hold. */
const MISSING_AT_COMMIT = /exists on disk, but not in|does not exist in/;

async function gitShow(root: string, commit: string, path: string): Promise<string | undefined> {
  const proc = Bun.spawn(['git', 'show', `${commit}:${path}`], {
    cwd: root,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) {
    if (MISSING_AT_COMMIT.test(stderr)) {
      return undefined;
    }
    throw new Error(`git show ${commit}:${path} failed: ${stderr.trim()}`);
  }
  return stdout;
}

async function writeAtomic(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, content, 'utf8');
  await rename(temporary, path);
}

async function readIfExists(path: string): Promise<string | undefined> {
  const file = Bun.file(path);
  return (await file.exists()) ? file.text() : undefined;
}

/** Reverts the listed products to `commit`; returns the files it changed. Nothing is written when a check fails. */
export async function revertProducts(
  root: string,
  commit: string,
  rawProducts: string,
): Promise<{ products: string[]; changed: string[] }> {
  const baseRaw = await gitShow(root, commit, CONFIG_FILE);
  if (baseRaw === undefined) {
    throw new Error(`base commit ${commit} has no ${CONFIG_FILE}`);
  }
  const baseConfig = parseReleasesConfig(JSON.parse(baseRaw));
  const products = parseFailedProducts(
    rawProducts,
    baseConfig.products.map((product) => product.id),
  );
  if (products.length === 0) {
    return { products, changed: [] };
  }

  let working = JSON.parse(await Bun.file(join(root, CONFIG_FILE)).text()) as Record<string, unknown>;
  parseReleasesConfig(working);
  const changelogs = new Map<string, string | undefined>();
  for (const id of products) {
    working = JSON.parse(renderWithVersion(working, id, findProduct(baseConfig, id).version));
    const path = join(baseConfig.changelogDir, `${id}.json`);
    const content = await gitShow(root, commit, path);
    if (content !== undefined) {
      parseProductChangelog(JSON.parse(content), path);
    }
    changelogs.set(path, content);
  }
  parseReleasesConfig(working);

  const changed: string[] = [];
  const nextConfig = `${JSON.stringify(working, null, 2)}\n`;
  if ((await readIfExists(join(root, CONFIG_FILE))) !== nextConfig) {
    await writeAtomic(join(root, CONFIG_FILE), nextConfig);
    changed.push(CONFIG_FILE);
  }
  for (const [path, content] of changelogs) {
    if ((await readIfExists(join(root, path))) === content) {
      continue;
    }
    if (content === undefined) {
      await rm(join(root, path), { force: true });
    } else {
      await writeAtomic(join(root, path), content);
    }
    changed.push(path);
  }
  return { products, changed };
}

if (import.meta.main) {
  const [commit] = process.argv.slice(2);
  if (commit === undefined || process.argv.length !== 3) {
    console.error('usage: revert-products <base-commit>   (product ids as a JSON array in FAILED_SYNC_PRODUCTS)');
    process.exit(1);
  }
  try {
    const { products, changed } = await revertProducts(process.cwd(), commit, process.env.FAILED_SYNC_PRODUCTS ?? '');
    console.error(
      products.length === 0
        ? 'revert-products: no failed product'
        : `revert-products: ${products.join(', ')} back to ${commit} (${changed.length} file(s) changed)`,
    );
  } catch (error) {
    console.error(`revert-products: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
