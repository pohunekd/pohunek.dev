#!/usr/bin/env bun
// Renders the whitelisted pohunek docs at the pinned ref into src/content/docs/<routePrefix>/
// and extracts the install prompt into src/data/generated/. Generated output is never committed.
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parseDocsSyncConfig, type DocsSyncConfig } from './lib/docs-config.ts';
import { findProduct, parseReleasesConfig, tagOf } from './lib/releases-config.ts';
import { cloneSource, DocsSyncError, openLocalSource, type DocsSource } from './lib/docs-source.ts';
import {
  buildDocPage,
  createLinkTargets,
  extractInstallPrompt,
  planPages,
  type BuiltPage,
} from './lib/docs-transform.ts';

interface CliArgs {
  readonly source?: string;
  readonly ref?: string;
}

const REPO_ROOT = resolve(dirname(import.meta.path), '..');
/** The product in releases.config.json whose docs this site renders. */
const DOCS_PRODUCT = 'pohunek';

function parseArgs(argv: readonly string[]): CliArgs {
  const values: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag !== '--source' && flag !== '--ref') {
      throw new DocsSyncError(`unknown argument "${flag}"; usage: sync-docs.ts [--source <checkout>] [--ref <tag>]`);
    }
    if (value === undefined || value.startsWith('--')) {
      throw new DocsSyncError(`${flag} needs a value`);
    }
    values[flag.slice(2)] = value;
  }
  return { source: values.source, ref: values.ref };
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
  repository: string,
  ref: string,
): Promise<{ pages: BuiltPage[]; files: string[] }> {
  const files = await source.listFiles();
  const planned = planPages(config.pages, files);
  const routes = new Map(planned.map((page) => [page.sourcePath, page.route]));
  const targets = createLinkTargets({
    files,
    routes,
    repository,
    ref,
    githubUrl: config.githubUrl,
    rawUrl: config.rawUrl,
    routePrefix: config.routePrefix,
  });

  const pages: BuiltPage[] = [];
  for (const page of planned) {
    const text = await source.readText(page.sourcePath);
    pages.push(
      buildDocPage({
        sourcePath: page.sourcePath,
        text,
        planned: page,
        editUrl: `${config.githubUrl}/${repository}/blob/${config.editBranch}/${page.sourcePath}`,
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

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const config = parseDocsSyncConfig(await readJsonFile('docs-sync.config.json'));
  const pin = findProduct(parseReleasesConfig(await readJsonFile('releases.config.json')), DOCS_PRODUCT);
  const ref = args.ref ?? tagOf(pin);

  const cacheRoot = join(REPO_ROOT, config.cacheDir);
  const cloneDir = join(cacheRoot, ref.replace(/[^A-Za-z0-9._-]/g, '_'));
  const stagingDir = join(cacheRoot, 'staging');
  const outputDir = join(REPO_ROOT, config.contentRoot, config.routePrefix);

  const source =
    args.source !== undefined
      ? await openLocalSource(resolve(args.source), ref)
      : await cloneSource({
          repositoryUrl: `${config.githubUrl}/${pin.repository}.git`,
          ref,
          cloneDir,
        });

  try {
    console.error(`sync-docs: reading ${source.description}`);
    const { pages, files } = await buildPages(source, config, pin.repository, ref);
    const prompt = extractInstallPrompt(
      await source.readText(config.installPrompt.readme),
      config.installPrompt.heading,
    );

    await publish(pages, stagingDir, outputDir);
    await writeFileAtomic(join(REPO_ROOT, config.generatedDir, config.installPrompt.output), prompt);

    for (const page of pages) {
      console.error(`  /${config.routePrefix}/${page.route === '' ? '' : `${page.route}/`}  <- ${page.sourcePath}`);
      for (const warning of page.warnings) {
        console.error(`    warning: ${warning}`);
      }
    }
    const warnings = pages.reduce((count, page) => count + page.warnings.length, 0);
    console.error(
      `sync-docs: ${pages.length} pages from ${files.length} files at ${ref}, ${warnings} unresolved link warning(s)`,
    );
  } finally {
    if (args.source === undefined) {
      await rm(cloneDir, { recursive: true, force: true });
    }
  }
}

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
