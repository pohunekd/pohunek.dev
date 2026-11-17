#!/usr/bin/env bun
// Renders the whitelisted docs of every source in docs-sync.config.json at its product's pinned ref into
// src/content/docs/<routePrefix>/ and extracts install prompts into src/data/generated/. Generated output is never committed.
// With --keep-going (follow-release's verify job) every product's sync runs on its own: a failing
// product is reported in failed-sync.json and the other products still sync.
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parseDocsSyncConfig, type DocsSyncConfig, type ProductDocs } from './lib/docs-config.ts';
import { findProduct, parseReleasesConfig, tagOf, type Product } from './lib/releases-config.ts';
import { cloneSource, DocsSyncError, openLocalSource, type DocsSource } from './lib/docs-source.ts';
import {
  buildDocPage,
  createLinkTargets,
  extractInstallPrompt,
  planPages,
  type BuiltPage,
} from './lib/docs-transform.ts';
import { recordFailedSync } from './lib/failed-sync.ts';

export interface CliArgs {
  readonly product?: string;
  readonly source?: string;
  readonly ref?: string;
  readonly keepGoing?: boolean;
}

const REPO_ROOT = resolve(dirname(import.meta.path), '..');
const USAGE = 'usage: sync-docs.ts [--product <id> [--source <checkout>] [--ref <tag>]] [--keep-going]';

export function parseArgs(argv: readonly string[]): CliArgs {
  let keepGoing = false;
  const rest: string[] = [];
  for (const arg of argv) {
    if (arg === '--keep-going') {
      keepGoing = true;
    } else {
      rest.push(arg);
    }
  }
  const values: Record<string, string> = {};
  for (let i = 0; i < rest.length; i += 2) {
    const flag = rest[i];
    const value = rest[i + 1];
    if (flag !== '--product' && flag !== '--source' && flag !== '--ref') {
      throw new DocsSyncError(`unknown argument "${flag}"; ${USAGE}`);
    }
    if (value === undefined || value.startsWith('--')) {
      throw new DocsSyncError(`${flag} needs a value`);
    }
    values[flag.slice(2)] = value;
  }
  // A checkout or a ref belongs to one repository, so it names the product it is read for.
  if ((values.source !== undefined || values.ref !== undefined) && values.product === undefined) {
    throw new DocsSyncError(`--source and --ref need --product; ${USAGE}`);
  }
  return { product: values.product, source: values.source, ref: values.ref, keepGoing };
}

async function readJsonFile(relativePath: string): Promise<unknown> {
  const path = join(REPO_ROOT, relativePath);
  const file = Bun.file(path);
  if (!(await file.exists())) {
    throw new DocsSyncError(`missing ${relativePath} at ${path}`);
  }
  return file.json();
}

async function writeFileAtomic(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, content, 'utf8');
  await rename(temporary, path);
}

async function buildPages(
  source: DocsSource,
  config: DocsSyncConfig,
  docs: ProductDocs,
  repository: string,
  ref: string,
): Promise<{ pages: BuiltPage[]; files: string[] }> {
  const files = await source.listFiles();
  const planned = planPages(docs.pages, files);
  const routes = new Map(planned.map((page) => [page.sourcePath, page.route]));
  const targets = createLinkTargets({
    files,
    routes,
    repository,
    ref,
    githubUrl: config.githubUrl,
    rawUrl: config.rawUrl,
    routePrefix: docs.routePrefix,
  });

  const pages: BuiltPage[] = [];
  for (const page of planned) {
    const text = await source.readText(page.sourcePath);
    pages.push(
      buildDocPage({
        sourcePath: page.sourcePath,
        text,
        planned: page,
        editUrl: `${config.githubUrl}/${repository}/blob/${docs.editBranch}/${page.sourcePath}`,
        targets,
      }),
    );
  }
  return { pages, files };
}

async function publish(pages: readonly BuiltPage[], stagingDir: string, outputDir: string): Promise<void> {
  await rm(stagingDir, { recursive: true, force: true });
  for (const page of pages) {
    const relative = page.route === '' ? 'index.md' : `${page.route}.md`;
    await writeFileAtomic(join(stagingDir, relative), page.content);
  }
  // The output is swapped in only after every page is written, so an interrupted run never leaves a partial tree.
  await rm(outputDir, { recursive: true, force: true });
  await mkdir(dirname(outputDir), { recursive: true });
  await rename(stagingDir, outputDir);
}

/** Syncs one product into its own route prefix; the output of every other product is left as it is. */
async function syncProduct(config: DocsSyncConfig, docs: ProductDocs, pin: Product, args: CliArgs): Promise<void> {
  const ref = args.ref ?? tagOf(pin);
  // Keyed by product as well as ref: two products may release the same tag name.
  const cacheRoot = join(REPO_ROOT, config.cacheDir, docs.product);
  const cloneDir = join(cacheRoot, ref.replace(/[^A-Za-z0-9._-]/g, '_'));
  const stagingDir = join(cacheRoot, 'staging');
  const outputDir = join(REPO_ROOT, config.contentRoot, docs.routePrefix);

  const source =
    args.source !== undefined
      ? await openLocalSource(resolve(args.source), ref)
      : await cloneSource({
          repositoryUrl: `${config.githubUrl}/${pin.repository}.git`,
          ref,
          cloneDir,
        });

  try {
    console.error(`sync-docs: ${docs.product}: reading ${source.description}`);
    const { pages, files } = await buildPages(source, config, docs, pin.repository, ref);
    const installPrompt = docs.installPrompt;
    const prompt =
      installPrompt === undefined
        ? undefined
        : {
            path: join(REPO_ROOT, config.generatedDir, installPrompt.output),
            text: extractInstallPrompt(await source.readText(installPrompt.readme), installPrompt.heading),
          };

    await publish(pages, stagingDir, outputDir);
    if (prompt !== undefined) {
      await writeFileAtomic(prompt.path, prompt.text);
    }

    for (const page of pages) {
      console.error(`  /${docs.routePrefix}/${page.route === '' ? '' : `${page.route}/`}  <- ${page.sourcePath}`);
      for (const warning of page.warnings) {
        console.error(`    warning: ${warning}`);
      }
    }
    const warnings = pages.reduce((count, page) => count + page.warnings.length, 0);
    console.error(
      `sync-docs: ${docs.product}: ${pages.length} pages from ${files.length} files at ${ref}, ${warnings} unresolved link warning(s)`,
    );
  } finally {
    if (args.source === undefined) {
      await rm(cloneDir, { recursive: true, force: true });
    }
  }
}

export async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const releases = parseReleasesConfig(await readJsonFile('releases.config.json'));
  const config = parseDocsSyncConfig(
    await readJsonFile('docs-sync.config.json'),
    releases.products.map((product) => product.id),
  );
  const selected =
    args.product === undefined ? config.sources : config.sources.filter((docs) => docs.product === args.product);
  if (selected.length === 0) {
    throw new DocsSyncError(`docs-sync.config.json has no source for product "${args.product}"`);
  }
  const failedFile = args.keepGoing === true ? join(REPO_ROOT, 'failed-sync.json') : undefined;
  for (const docs of selected) {
    try {
      await syncProduct(config, docs, findProduct(releases, docs.product), args);
    } catch (error) {
      if (failedFile === undefined) {
        throw error;
      }
      const reason = error instanceof Error ? error.message : String(error);
      await recordFailedSync(failedFile, { script: 'sync-docs', product: docs.product, reason });
      console.error(`sync-docs: ${docs.product}: FAILED ${reason}`);
    }
  }
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    if (error instanceof DocsSyncError) {
      console.error(`sync-docs: ${error.message}`);
    } else {
      console.error(error);
    }
    process.exit(1);
  }
}
