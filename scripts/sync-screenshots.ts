#!/usr/bin/env bun
// Pulls the Android screenshot set at the pinned ref into src/assets/screenshots/android/ and writes
// the module that surfaces.ts imports. Both outputs are generated and never committed.
// With --keep-going a failing sync is reported in failed-sync.json instead of aborting.
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { parseDocsSyncConfig } from './lib/docs-config.ts';
import { findProduct, parseReleasesConfig, tagOf } from './lib/releases-config.ts';
import { cloneSource, DocsSyncError, openLocalSource, type DocsSource } from './lib/docs-source.ts';
import { recordFailedSync } from './lib/failed-sync.ts';
import {
  parseScreenshotManifest,
  renderScreenshotModule,
  verifyShotImage,
  type ScreenshotManifest,
} from './lib/screenshot-manifest.ts';

export interface CliArgs {
  readonly source?: string;
  readonly ref?: string;
  readonly keepGoing?: boolean;
}

const REPO_ROOT = resolve(dirname(import.meta.path), '..');
/** The product in releases.config.json whose screenshot set this site renders. */
const SCREENSHOT_PRODUCT = 'android';
const IMAGES_DIR = 'src/assets/screenshots/android';
const MODULE_PATH = 'android-screenshots.ts';
const CACHE_DIR = '.cache/screenshots-sync';

const USAGE = 'usage: sync-screenshots.ts [--source <checkout>] [--ref <tag>] [--keep-going]';

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
    if (flag !== '--source' && flag !== '--ref') {
      throw new DocsSyncError(`unknown argument "${flag}"; ${USAGE}`);
    }
    if (value === undefined || value.startsWith('--')) {
      throw new DocsSyncError(`${flag} needs a value`);
    }
    values[flag.slice(2)] = value;
  }
  return { source: values.source, ref: values.ref, keepGoing };
}

async function readJsonFile(root: string, relativePath: string): Promise<unknown> {
  const path = join(root, relativePath);
  const file = Bun.file(path);
  if (!(await file.exists())) {
    throw new DocsSyncError(`missing ${relativePath} at ${path}`);
  }
  return file.json();
}

async function readManifest(source: DocsSource, manifestPath: string, where: string): Promise<ScreenshotManifest> {
  const files = await source.listFiles();
  if (!files.includes(manifestPath)) {
    throw new DocsSyncError(`${where}: ${manifestPath} does not exist at this ref, so there is no screenshot set to render`);
  }
  return parseScreenshotManifest(await source.readText(manifestPath), where);
}

/** Reads and verifies every image of the manifest; nothing is written until all of them pass. */
async function readImages(
  source: DocsSource,
  manifest: ScreenshotManifest,
  manifestPath: string,
  where: string,
): Promise<Map<string, Uint8Array>> {
  const manifestDir = dirname(manifestPath);
  const files = new Set(await source.listFiles());
  const images = new Map<string, Uint8Array>();
  for (const shot of manifest.shots) {
    const path = `${manifestDir}/${shot.file}`;
    if (!files.has(path)) {
      throw new DocsSyncError(`${where}: the manifest lists ${shot.file} but ${path} does not exist at this ref`);
    }
    const bytes = await source.readBytes(path);
    verifyShotImage(shot, bytes, where);
    images.set(shot.id, bytes);
  }
  return images;
}

async function writeFileAtomic(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, content, 'utf8');
  await rename(temporary, path);
}

async function publish(
  manifest: ScreenshotManifest,
  images: ReadonlyMap<string, Uint8Array>,
  stagingDir: string,
  outputDir: string,
  modulePath: string,
): Promise<void> {
  await rm(stagingDir, { recursive: true, force: true });
  await mkdir(stagingDir, { recursive: true });
  for (const shot of manifest.shots) {
    await writeFile(join(stagingDir, `${shot.id}.png`), images.get(shot.id) as Uint8Array);
  }
  const moduleSource = renderScreenshotModule(manifest.shots, relative(dirname(modulePath), outputDir));
  // The image directory is swapped in only after every image is written, so it never holds a partial set.
  await rm(outputDir, { recursive: true, force: true });
  await mkdir(dirname(outputDir), { recursive: true });
  await rename(stagingDir, outputDir);
  await writeFileAtomic(modulePath, moduleSource);
}

export async function main(argv: readonly string[] = process.argv.slice(2), root: string = REPO_ROOT): Promise<void> {
  const args = parseArgs(argv);
  const releases = parseReleasesConfig(await readJsonFile(root, 'releases.config.json'));
  const docsConfig = parseDocsSyncConfig(
    await readJsonFile(root, 'docs-sync.config.json'),
    releases.products.map((product) => product.id),
  );
  const failedFile = args.keepGoing === true ? join(root, 'failed-sync.json') : undefined;
  const cacheRoot = join(root, CACHE_DIR);
  let cloneDir: string | undefined;
  // Everything that depends on the product (pin lookup, clone, manifest) sits inside the try, so
  // under --keep-going any failure of this product is recorded instead of aborting the run.
  try {
    const pin = findProduct(releases, SCREENSHOT_PRODUCT);
    if (pin.screenshotManifest === undefined) {
      throw new DocsSyncError(`releases.config.json product "${SCREENSHOT_PRODUCT}" has no screenshotManifest`);
    }
    const manifestPath = pin.screenshotManifest;
    const ref = args.ref ?? tagOf(pin);
    const where = `${pin.repository} at ref "${ref}"`;
    cloneDir = join(cacheRoot, ref.replace(/[^A-Za-z0-9._-]/g, '_'));
    const source =
      args.source !== undefined
        ? await openLocalSource(resolve(args.source), ref)
        : await cloneSource({
            repositoryUrl: `${docsConfig.githubUrl}/${pin.repository}.git`,
            ref,
            cloneDir,
          });
    console.error(`sync-screenshots: reading ${source.description}`);
    const manifest = await readManifest(source, manifestPath, where);
    const images = await readImages(source, manifest, manifestPath, where);
    await publish(
      manifest,
      images,
      join(cacheRoot, 'staging'),
      join(root, IMAGES_DIR),
      join(root, docsConfig.generatedDir, MODULE_PATH),
    );
    for (const shot of manifest.shots) {
      console.error(`  ${IMAGES_DIR}/${shot.id}.png  <- ${shot.file} (${shot.width}x${shot.height})`);
    }
    console.error(`sync-screenshots: ${manifest.shots.length} screenshots (app tree ${manifest.appTree}) at ${ref}`);
  } catch (error) {
    if (failedFile === undefined) {
      throw error;
    }
    const reason = error instanceof Error ? error.message : String(error);
    await recordFailedSync(failedFile, { script: 'sync-screenshots', product: SCREENSHOT_PRODUCT, reason });
    console.error(`sync-screenshots: ${SCREENSHOT_PRODUCT}: FAILED ${reason}`);
  } finally {
    if (args.source === undefined && cloneDir !== undefined) {
      await rm(cloneDir, { recursive: true, force: true });
    }
  }
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    if (error instanceof DocsSyncError) {
      console.error(`sync-screenshots: ${error.message}`);
    } else {
      console.error(error);
    }
    process.exit(1);
  }
}
