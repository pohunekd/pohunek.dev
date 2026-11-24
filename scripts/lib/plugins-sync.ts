/**
 * Build-time sync of the /plugins/ page: fetch the signed official plugin index, keep the raw
 * document as the committed snapshot and write the module the page imports.
 *
 * A failed fetch or an unreadable document falls back to the committed snapshot and says so on the
 * page; when neither is usable the sync fails the build. It never renders an empty list silently.
 */
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import {
  buildPluginView,
  parsePluginIndex,
  parsePluginSnapshot,
  renderPluginViewModule,
  type PluginIndexView,
  type PluginPresentationMap,
  type PluginSnapshot,
} from './plugins.ts';

/** The signed index v2 document, the same URL the daemon and `pohunek plugin install` read. */
export const OFFICIAL_INDEX_URL =
  'https://github.com/pohunekd/pohunek-plugin-index/releases/latest/download/official-index-v2.json';

/** Largest accepted document: the package crate's index limit, with headroom for the envelope. */
export const MAX_INDEX_BYTES = 1024 * 1024;

/** Longest one fetch may take. */
const FETCH_TIMEOUT_MS = 30_000;

export interface SyncOptions {
  readonly root: string;
  /** URL of the signed index; defaults to the official one. */
  readonly url?: string;
  /** Read a local index document instead of fetching; for tests and previews. */
  readonly indexFile?: string;
  /** Write the fetched document as the committed snapshot. */
  readonly updateSnapshot?: boolean;
  /** The committed snapshot, relative to the root unless absolute. */
  readonly snapshotPath?: string;
  /** The generated module, relative to the root unless absolute. */
  readonly modulePath?: string;
  readonly presentation: PluginPresentationMap;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => Date;
}

export interface SyncResult {
  readonly view: PluginIndexView;
  readonly snapshotWritten: boolean;
  /** Set when the live index could not be used; the view is then the snapshot. */
  readonly fallbackReason?: string;
}

const DEFAULT_SNAPSHOT_PATH = 'src/data/plugins.snapshot.json';
const DEFAULT_MODULE_PATH = 'src/data/generated/plugins.ts';
const TYPES_PATH = 'scripts/lib/plugins.ts';

/** The import path of the view type, relative to the generated module. */
function typesImportPath(root: string, modulePath: string): string {
  return relative(dirname(modulePath), join(root, TYPES_PATH))
    .replace(/\.ts$/, '')
    .split(sep)
    .join('/');
}

async function readText(path: string, what: string): Promise<string> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    throw new Error(`cannot read the ${what} at ${path}: ${(error as Error).message}`);
  }
}

async function writeAtomic(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, content, 'utf8');
  await rename(temporary, path);
}

async function fetchDocument(url: string, fetchImpl: typeof fetch): Promise<string> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers: { accept: 'application/json' },
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (error) {
    throw new Error(`cannot fetch ${url}: ${(error as Error).message}`);
  }
  if (!response.ok) {
    throw new Error(`cannot fetch ${url}: HTTP ${response.status}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0) {
    throw new Error(`the index at ${url} is empty`);
  }
  if (bytes.byteLength > MAX_INDEX_BYTES) {
    throw new Error(`the index at ${url} is larger than ${MAX_INDEX_BYTES} bytes`);
  }
  return new TextDecoder().decode(bytes);
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Runs the sync: a live index and a committed snapshot are the two inputs, and the build fails only
 * when neither can be rendered. The snapshot is written on a successful fetch only when asked to (or
 * when the repository has none yet), so a build never dirties a tracked file.
 */
export async function syncPlugins(options: SyncOptions): Promise<SyncResult> {
  const url = options.url ?? OFFICIAL_INDEX_URL;
  const snapshotPath = resolve(options.root, options.snapshotPath ?? DEFAULT_SNAPSHOT_PATH);
  const modulePath = resolve(options.root, options.modulePath ?? DEFAULT_MODULE_PATH);
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? ((): Date => new Date());

  let snapshotReason: string | undefined;
  if (options.indexFile !== undefined) {
    const text = await readText(options.indexFile, 'index document');
    let document: unknown;
    try {
      document = JSON.parse(text);
    } catch (error) {
      throw new Error(`${options.indexFile} is not valid JSON: ${(error as Error).message}`);
    }
    const index = parsePluginIndex(document, options.indexFile);
    const view = buildPluginView(index, {
      source: options.indexFile,
      fetchedAt: now().toISOString(),
      stale: false,
      presentation: options.presentation,
    });
    await writeAtomic(modulePath, renderPluginViewModule(view, typesImportPath(options.root, modulePath)));
    return { view, snapshotWritten: false };
  }

  try {
    const text = await fetchDocument(url, fetchImpl);
    let document: unknown;
    try {
      document = JSON.parse(text);
    } catch (error) {
      throw new Error(`the index at ${url} is not valid JSON: ${(error as Error).message}`);
    }
    const index = parsePluginIndex(document, url);
    const fetchedAt = now().toISOString();
    const snapshot: PluginSnapshot = { source: url, fetchedAt, document };
    const snapshotWritten = options.updateSnapshot === true || !(await exists(snapshotPath));
    if (snapshotWritten) {
      const stored = { source: snapshot.source, fetched_at: snapshot.fetchedAt, document: snapshot.document };
      await writeAtomic(snapshotPath, `${JSON.stringify(stored, null, 2)}\n`);
    }
    const view = buildPluginView(index, {
      source: url,
      fetchedAt,
      stale: false,
      presentation: options.presentation,
    });
    await writeAtomic(modulePath, renderPluginViewModule(view, typesImportPath(options.root, modulePath)));
    return { view, snapshotWritten };
  } catch (error) {
    snapshotReason = (error as Error).message;
  }

  let snapshot: PluginSnapshot;
  try {
    const text = await readText(snapshotPath, 'committed index snapshot');
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch (error) {
      throw new Error(`${snapshotPath} is not valid JSON: ${(error as Error).message}`);
    }
    snapshot = parsePluginSnapshot(raw, snapshotPath);
  } catch (error) {
    throw new Error(
      `${snapshotReason ?? 'the live index is unavailable'}; the fallback snapshot is unusable: ${(error as Error).message}`,
    );
  }

  const index = parsePluginIndex(snapshot.document, `${snapshotPath}: document`);
  const view = buildPluginView(index, {
    source: snapshot.source,
    fetchedAt: snapshot.fetchedAt,
    stale: true,
    presentation: options.presentation,
  });
  await writeAtomic(modulePath, renderPluginViewModule(view, typesImportPath(options.root, modulePath)));
  return { view, snapshotWritten: false, fallbackReason: snapshotReason };
}
