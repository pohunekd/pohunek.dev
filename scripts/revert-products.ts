#!/usr/bin/env bun
// Reverts every product named in failed-sync.json to the base commit: its entry in
// releases.config.json and its src/data/changelog/<product>.json. The verify job runs this after
// the --keep-going syncs, so a product whose docs failed at the new pin builds with its old pin
// (whose previously synced output is already in the tree) while the products that passed keep
// their new pins. Usage: revert-products <base-commit>.
// Each listed path comes from git show, never from a subprocess pipe; a failure aborts (exit 1)
// without writing, and files that are already at the base content are left untouched.
import { join, resolve } from 'node:path';
import { readFailedSync } from './lib/failed-sync.ts';
import { parseProductChangelog } from './lib/changelog.ts';
import { findProduct, parseReleasesConfig, renderWithVersion } from './lib/releases-config.ts';

const REPO_ROOT = resolve(new URL('..', import.meta.url).pathname);
const FAILED_FILE = join(REPO_ROOT, 'failed-sync.json');
const CONFIG_FILE = 'releases.config.json';

async function gitShow(commit: string, path: string): Promise<string | undefined> {
  const proc = Bun.spawn(['git', 'show', `${commit}:${path}`], {
    cwd: REPO_ROOT,
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
    // A changelog the base commit has no file for yet (a brand-new product) counts as empty.
    if (stderr.includes('exists on disk, but not in')) {
      return undefined;
    }
    throw new Error(`git show ${commit}:${path} failed: ${stderr.trim()}`);
  }
  return stdout;
}

/** Every path the revert may touch, validated against the parsed configs. */
async function plannedPaths(commit: string, products: readonly string[]): Promise<string[]> {
  const unique = [...new Set(products)].sort();
  if (unique.length === 0) {
    return [];
  }
  const raw = await gitShow(commit, CONFIG_FILE);
  if (raw === undefined) {
    throw new Error(`base commit ${commit} has no ${CONFIG_FILE}`);
  }
  const config = parseReleasesConfig(JSON.parse(raw));
  const paths = [CONFIG_FILE];
  for (const product of unique) {
    findProduct(config, product);
    paths.push(join(config.changelogDir, `${product}.json`));
  }
  return paths;
}

export async function revertProducts(commit: string): Promise<string[]> {
  const failures = await readFailedSync(FAILED_FILE);
  const paths = await plannedPaths(
    commit,
    failures.map((failure) => failure.product),
  );
  const wanted = new Map<string, string | undefined>();
  for (const path of paths) {
    wanted.set(path, await gitShow(commit, path));
  }
  // Rebuild the working config from the base commit's copy, then move only the failed products
  // back to their base pins. Every other product keeps the pin the collect job wrote.
  const products = [...new Set(failures.map((failure) => failure.product))].sort();
  const baseRaw = JSON.parse(wanted.get(CONFIG_FILE) as string) as Record<string, unknown>;
  const baseConfig = parseReleasesConfig(baseRaw);
  let working = JSON.parse(await Bun.file(join(REPO_ROOT, CONFIG_FILE)).text()) as Record<string, unknown>;
  parseReleasesConfig(working);
  for (const product of products) {
    working = JSON.parse(renderWithVersion(working, product, findProduct(baseConfig, product).version));
  }
  parseReleasesConfig(working);
  const changelogPaths = paths.filter((path) => path !== CONFIG_FILE);
  for (const path of changelogPaths) {
    const content = wanted.get(path);
    if (content !== undefined) {
      parseProductChangelog(JSON.parse(content), path);
    }
  }
  const reverted: string[] = [];
  const currentConfig = await Bun.file(join(REPO_ROOT, CONFIG_FILE)).text();
  const nextConfig = `${JSON.stringify(working, null, 2)}\n`;
  if (currentConfig !== nextConfig) {
    await Bun.write(join(REPO_ROOT, CONFIG_FILE), nextConfig);
    reverted.push(CONFIG_FILE);
  }
  for (const path of changelogPaths) {
    const file = Bun.file(join(REPO_ROOT, path));
    const current = (await file.exists()) ? await file.text() : undefined;
    const content = wanted.get(path);
    if (current === content || (current === undefined && content === undefined)) {
      continue;
    }
    if (content === undefined) {
      const { rm } = await import('node:fs/promises');
      await rm(join(REPO_ROOT, path), { force: true });
    } else {
      await Bun.write(join(REPO_ROOT, path), content);
    }
    reverted.push(path);
  }
  return products;
}

async function main(): Promise<void> {
  const [commit] = process.argv.slice(2);
  if (commit === undefined || process.argv.length !== 3) {
    console.error('usage: revert-products <base-commit>');
    process.exit(1);
  }
  try {
    const products = await revertProducts(commit);
    if (products.length === 0) {
      console.error('revert-products: every failed product is already at the base commit');
    } else {
      console.error(`revert-products: ${products.join(', ')} back to ${commit}`);
    }
  } catch (error) {
    console.error(`revert-products: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

if (import.meta.main) {
  await main();
}
