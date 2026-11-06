import { createHash } from 'node:crypto';
import { DocsSyncError, type DocsSource } from './docs-source.ts';

/** Schema of docs/media/manifest.json in the Android repository that this parser understands. */
export const MEDIA_MANIFEST_SCHEMA = 1;

/** Site path prefix the synced files are served under; the files live in public/ at the same path. */
export const MEDIA_URL_PREFIX = '/media/android';

export interface MediaFile {
  readonly file: string;
  readonly type: string;
  readonly codecs: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface MediaManifest {
  readonly schema: number;
  readonly appTree: string;
  readonly device: string;
  /** File name of the poster image; always one of `files`. */
  readonly poster: string;
  readonly width: number;
  readonly height: number;
  readonly durationMs: number;
  readonly alt: string;
  /** One line per scene: the text alternative shown next to the video. */
  readonly description: readonly string[];
  readonly files: readonly MediaFile[];
}

/** What the page needs to render the video; urls are site paths, sources keep manifest order. */
export interface AndroidMedia {
  readonly poster: string;
  readonly width: number;
  readonly height: number;
  readonly durationMs: number;
  readonly alt: string;
  readonly description: readonly string[];
  readonly sources: readonly { readonly src: string; readonly type: string; readonly codecs: string }[];
}

type JsonObject = Record<string, unknown>;

const FILE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*\.(webm|mp4|png)$/;
const APP_TREE_PATTERN = /^[0-9a-f]{40}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

/** The only file types the site serves, by extension. */
const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  webm: 'video/webm',
  mp4: 'video/mp4',
  png: 'image/png',
};

function asObject(value: unknown, where: string): JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new DocsSyncError(`${where} must be a JSON object`);
  }
  return value as JsonObject;
}

function requireString(obj: JsonObject, key: string, where: string): string {
  const value = obj[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new DocsSyncError(`${where}.${key} must be a non-empty string`);
  }
  return value;
}

function requirePattern(obj: JsonObject, key: string, pattern: RegExp, where: string): string {
  const value = requireString(obj, key, where);
  if (!pattern.test(value)) {
    throw new DocsSyncError(`${where}.${key} "${value}" does not match ${pattern}`);
  }
  return value;
}

function requirePositiveInteger(obj: JsonObject, key: string, where: string): number {
  const value = obj[key];
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new DocsSyncError(`${where}.${key} must be a positive integer`);
  }
  return value;
}

function extensionOf(file: string): string {
  return file.slice(file.lastIndexOf('.') + 1);
}

function parseFile(raw: unknown, index: number, where: string): MediaFile {
  const here = `${where} files[${index}]`;
  const obj = asObject(raw, here);
  const file = requirePattern(obj, 'file', FILE_PATTERN, here);
  const type = requireString(obj, 'type', here);
  const expected = MIME_BY_EXTENSION[extensionOf(file)];
  if (type !== expected) {
    throw new DocsSyncError(`${here}.type "${type}" must be "${expected}" for ${file}`);
  }
  return {
    file,
    type,
    codecs: requireString(obj, 'codecs', here),
    bytes: requirePositiveInteger(obj, 'bytes', here),
    sha256: requirePattern(obj, 'sha256', SHA256_PATTERN, here),
  };
}

/**
 * Parses and validates a media manifest. `where` names the manifest (path and ref) in every error.
 * An unknown schema, a disallowed file name, duplicate files and a poster that is missing or not a
 * listed PNG all throw, so a player is never produced from a document this parser does not fully understand.
 */
export function parseMediaManifest(text: string, where: string): MediaManifest {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new DocsSyncError(`${where} is not valid JSON`);
  }
  const obj = asObject(raw, where);
  if (obj.schema !== MEDIA_MANIFEST_SCHEMA) {
    throw new DocsSyncError(
      `${where} has schema ${JSON.stringify(obj.schema)}, this site reads schema ${MEDIA_MANIFEST_SCHEMA}`,
    );
  }

  const filesRaw = obj.files;
  if (!Array.isArray(filesRaw) || filesRaw.length === 0) {
    throw new DocsSyncError(`${where}.files must be a non-empty array`);
  }
  const files = filesRaw.map((file, index) => parseFile(file, index, where));
  const seen = new Set<string>();
  for (const { file } of files) {
    if (seen.has(file)) {
      throw new DocsSyncError(`${where} lists file "${file}" more than once`);
    }
    seen.add(file);
  }

  const poster = requirePattern(obj, 'poster', FILE_PATTERN, where);
  const posterFile = files.find((file) => file.file === poster);
  if (posterFile === undefined) {
    throw new DocsSyncError(`${where}.poster "${poster}" is not listed in files`);
  }
  if (posterFile.type !== MIME_BY_EXTENSION.png) {
    throw new DocsSyncError(`${where}.poster "${poster}" must be a PNG image`);
  }
  if (!files.some((file) => file.type.startsWith('video/'))) {
    throw new DocsSyncError(`${where}.files lists no video`);
  }

  const descriptionRaw = obj.description;
  if (
    !Array.isArray(descriptionRaw) ||
    descriptionRaw.length === 0 ||
    descriptionRaw.some((line) => typeof line !== 'string' || line.length === 0)
  ) {
    throw new DocsSyncError(`${where}.description must be a non-empty array of non-empty strings`);
  }

  return {
    schema: MEDIA_MANIFEST_SCHEMA,
    appTree: requirePattern(obj, 'appTree', APP_TREE_PATTERN, where),
    device: requireString(obj, 'device', where),
    poster,
    width: requirePositiveInteger(obj, 'width', where),
    height: requirePositiveInteger(obj, 'height', where),
    durationMs: requirePositiveInteger(obj, 'durationMs', where),
    alt: requireString(obj, 'alt', where),
    description: descriptionRaw as string[],
    files,
  };
}

/** The manifest at the ref, or null ("no video") when the ref has none, as with every release made before the video existed. */
export async function loadMediaManifest(
  source: DocsSource,
  manifestPath: string,
  where: string,
): Promise<MediaManifest | null> {
  if (!(await source.listFiles()).includes(manifestPath)) {
    return null;
  }
  return parseMediaManifest(await source.readText(manifestPath), where);
}

/** Throws when the file bytes differ from what the manifest promises (size or digest). */
export function verifyMediaFile(entry: MediaFile, bytes: Uint8Array, where: string): void {
  if (bytes.length !== entry.bytes) {
    throw new DocsSyncError(`${where}: ${entry.file} is ${bytes.length} bytes, the manifest lists ${entry.bytes}`);
  }
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (digest !== entry.sha256) {
    throw new DocsSyncError(`${where}: ${entry.file} has sha256 ${digest}, the manifest lists ${entry.sha256}`);
  }
}

export function mediaUrl(file: string): string {
  return `${MEDIA_URL_PREFIX}/${file}`;
}

export function toAndroidMedia(manifest: MediaManifest): AndroidMedia {
  return {
    poster: mediaUrl(manifest.poster),
    width: manifest.width,
    height: manifest.height,
    durationMs: manifest.durationMs,
    alt: manifest.alt,
    description: manifest.description,
    sources: manifest.files
      .filter((file) => file.type.startsWith('video/'))
      .map((file) => ({ src: mediaUrl(file.file), type: file.type, codecs: file.codecs })),
  };
}

/** Source of the generated module; `media` is null when the pinned release carries no video. */
export function renderMediaModule(media: AndroidMedia | null, typesImportPath: string): string {
  return [
    '// Generated by scripts/sync-media.ts; do not edit.',
    `import type { AndroidMedia } from '${typesImportPath}';`,
    '',
    `export const androidMedia: AndroidMedia | null = ${JSON.stringify(media, null, 2)};`,
    '',
  ].join('\n');
}
