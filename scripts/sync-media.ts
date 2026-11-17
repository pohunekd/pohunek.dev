#!/usr/bin/env bun
// Pulls the Android demo video at the pinned ref into public/media/android/ (served from this site)
// and writes the module that surfaces.ts imports. Both outputs are generated and never committed.
// A ref without a media manifest produces "no video": the directory is removed and the module exports null.
// With --keep-going a failing sync is reported in failed-sync.json instead of aborting.
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { parseDocsSyncConfig } from './lib/docs-config.ts';
import { findProduct, parseReleasesConfig, tagOf } from './lib/releases-config.ts';
import { cloneSource, DocsSyncError, openLocalSource, type DocsSource } from './lib/docs-source.ts';
import { recordFailedSync } from './lib/failed-sync.ts';
import {
  loadMediaManifest,
  renderMediaModule,
  toAndroidMedia,
  verifyMediaFile,
  type AndroidMedia,
  type MediaManifest,
} from './lib/media-manifest.ts';

export interface CliArgs {
  readonly source?: string;
  readonly ref?: string;
  readonly keepGoing?: boolean;
}

const REPO_ROOT = resolve(dirname(import.meta.path), '..');
/** The product in releases.config.json whose demo video this site serves. */
const MEDIA_PRODUCT = 'android';
const MEDIA_DIR = 'public/media/android';
const MODULE_PATH = 'android-media.ts';
const TYPES_MODULE = 'scripts/lib/media-manifest';
const CACHE_DIR = '.cache/media-sync';

const USAGE = 'usage: sync-media.ts [--source <checkout>] [--ref <tag>] [--keep-going]';

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

/** Reads and verifies every file of the manifest; nothing is written until all of them pass. */
async function readFiles(
  source: DocsSource,
  manifest: MediaManifest,
  manifestPath: string,
  where: string,
): Promise<Map<string, Uint8Array>> {
  const manifestDir = dirname(manifestPath);
  const files = new Set(await source.listFiles());
  const contents = new Map<string, Uint8Array>();
  for (const entry of manifest.files) {
    const path = `${manifestDir}/${entry.file}`;
    if (!files.has(path)) {
      throw new DocsSyncError(`${where}: the manifest lists ${entry.file} but ${path} does not exist at this ref`);
    }
    const bytes = await source.readBytes(path);
    verifyMediaFile(entry, bytes, where);
    contents.set(entry.file, bytes);
  }
  return contents;
}

async function writeFileAtomic(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, content, 'utf8');
  await rename(temporary, path);
}

async function publish(
  media: AndroidMedia | null,
  contents: ReadonlyMap<string, Uint8Array>,
  stagingDir: string,
  outputDir: string,
  modulePath: string,
): Promise<void> {
  await rm(stagingDir, { recursive: true, force: true });
  await mkdir(stagingDir, { recursive: true });
  for (const [file, bytes] of contents) {
    await writeFile(join(stagingDir, file), bytes);
  }
  const typesImportPath = relative(dirname(modulePath), join(REPO_ROOT, TYPES_MODULE));
  const moduleSource = renderMediaModule(media, typesImportPath);
  // The directory is swapped in only after every file is written, so it never holds a partial set.
  await rm(outputDir, { recursive: true, force: true });
  if (contents.size > 0) {
    await mkdir(dirname(outputDir), { recursive: true });
    await rename(stagingDir, outputDir);
  }
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
    const pin = findProduct(releases, MEDIA_PRODUCT);
    if (pin.mediaManifest === undefined) {
      throw new DocsSyncError(`releases.config.json product "${MEDIA_PRODUCT}" has no mediaManifest`);
    }
    const manifestPath = pin.mediaManifest;
    const ref = args.ref ?? tagOf(pin);
    const where = `${pin.repository} at ref "${ref}" ${manifestPath}`;
    cloneDir = join(cacheRoot, ref.replace(/[^A-Za-z0-9._-]/g, '_'));
    const source =
      args.source !== undefined
        ? await openLocalSource(resolve(args.source), ref)
        : await cloneSource({
            repositoryUrl: `${docsConfig.githubUrl}/${pin.repository}.git`,
            ref,
            cloneDir,
          });
    console.error(`sync-media: reading ${source.description}`);
    const manifest = await loadMediaManifest(source, manifestPath, where);
    const contents = manifest === null ? new Map<string, Uint8Array>() : await readFiles(source, manifest, manifestPath, where);
    await publish(
      manifest === null ? null : toAndroidMedia(manifest),
      contents,
      join(cacheRoot, 'staging'),
      join(root, MEDIA_DIR),
      join(root, docsConfig.generatedDir, MODULE_PATH),
    );
    if (manifest === null) {
      console.error(`sync-media: ${manifestPath} does not exist at ${ref}, so the page renders without a video`);
      return;
    }
    for (const entry of manifest.files) {
      console.error(`  ${MEDIA_DIR}/${entry.file}  (${entry.type}, ${entry.bytes} bytes)`);
    }
    console.error(`sync-media: ${manifest.files.length} files (app tree ${manifest.appTree}) at ${ref}`);
  } catch (error) {
    if (failedFile === undefined) {
      throw error;
    }
    const reason = error instanceof Error ? error.message : String(error);
    await recordFailedSync(failedFile, { script: 'sync-media', product: MEDIA_PRODUCT, reason });
    console.error(`sync-media: ${MEDIA_PRODUCT}: FAILED ${reason}`);
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
      console.error(`sync-media: ${error.message}`);
    } else {
      console.error(error);
    }
    process.exit(1);
  }
}
