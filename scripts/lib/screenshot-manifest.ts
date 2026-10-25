import { createHash } from 'node:crypto';
import { DocsSyncError } from './docs-source.ts';

/** Schema of docs/screenshots/manifest.json in the Android repository that this parser understands. */
export const MANIFEST_SCHEMA = 1;

export interface ScreenshotShot {
  readonly id: string;
  readonly file: string;
  readonly caption: string;
  readonly alt: string;
  readonly width: number;
  readonly height: number;
  readonly sha256: string;
}

export interface ScreenshotManifest {
  readonly schema: number;
  readonly appTree: string;
  readonly device: string;
  readonly shots: readonly ScreenshotShot[];
}

type JsonObject = Record<string, unknown>;

// These patterns mirror scripts/check-screenshots in the Android repository, which gates its release tags.
const ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const FILE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*\.png$/;
const APP_TREE_PATTERN = /^[0-9a-f]{40}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PNG_IHDR_END = 24;

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

function requirePixels(obj: JsonObject, key: string, where: string): number {
  const value = obj[key];
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new DocsSyncError(`${where}.${key} must be a positive integer`);
  }
  return value;
}

function parseShot(raw: unknown, index: number, where: string): ScreenshotShot {
  const here = `${where} shots[${index}]`;
  const obj = asObject(raw, here);
  return {
    id: requirePattern(obj, 'id', ID_PATTERN, here),
    file: requirePattern(obj, 'file', FILE_PATTERN, here),
    caption: requireString(obj, 'caption', here),
    alt: requireString(obj, 'alt', here),
    width: requirePixels(obj, 'width', here),
    height: requirePixels(obj, 'height', here),
    sha256: requirePattern(obj, 'sha256', SHA256_PATTERN, here),
  };
}

/**
 * Parses and validates a screenshot manifest. `where` names the manifest (path and ref) in every
 * error. An unknown schema, an empty shot list and duplicate ids or files all throw, so a
 * gallery is never produced from a document this parser does not fully understand.
 */
export function parseScreenshotManifest(text: string, where: string): ScreenshotManifest {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new DocsSyncError(`${where} is not valid JSON`);
  }
  const obj = asObject(raw, where);
  if (obj.schema !== MANIFEST_SCHEMA) {
    throw new DocsSyncError(
      `${where} has schema ${JSON.stringify(obj.schema)}, this site reads schema ${MANIFEST_SCHEMA}`,
    );
  }

  const shotsRaw = obj.shots;
  if (!Array.isArray(shotsRaw) || shotsRaw.length === 0) {
    throw new DocsSyncError(`${where}.shots must be a non-empty array`);
  }
  const shots = shotsRaw.map((shot, index) => parseShot(shot, index, where));

  for (const key of ['id', 'file'] as const) {
    const seen = new Set<string>();
    for (const shot of shots) {
      if (seen.has(shot[key])) {
        throw new DocsSyncError(`${where} lists ${key} "${shot[key]}" more than once`);
      }
      seen.add(shot[key]);
    }
  }

  return {
    schema: MANIFEST_SCHEMA,
    appTree: requirePattern(obj, 'appTree', APP_TREE_PATTERN, where),
    device: requireString(obj, 'device', where),
    shots,
  };
}

/** Reads the pixel size from the IHDR chunk, or null when the bytes are not a PNG. */
export function readPngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < PNG_IHDR_END || PNG_SIGNATURE.some((byte, index) => bytes[index] !== byte)) {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/** Throws when the image bytes differ from what the manifest promises (digest, format or size). */
export function verifyShotImage(shot: ScreenshotShot, bytes: Uint8Array, where: string): void {
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (digest !== shot.sha256) {
    throw new DocsSyncError(`${where}: ${shot.file} has sha256 ${digest}, the manifest lists ${shot.sha256}`);
  }
  const size = readPngSize(bytes);
  if (size === null) {
    throw new DocsSyncError(`${where}: ${shot.file} is not a PNG image`);
  }
  if (size.width !== shot.width || size.height !== shot.height) {
    throw new DocsSyncError(
      `${where}: ${shot.file} is ${size.width}x${size.height}, the manifest lists ${shot.width}x${shot.height}`,
    );
  }
}

/**
 * Source of the generated module that imports every image and exports the gallery in manifest
 * order. `assetsImportDir` is the import path of the image directory relative to the module.
 */
export function renderScreenshotModule(shots: readonly ScreenshotShot[], assetsImportDir: string): string {
  const imports = shots.map((shot, index) => `import shot${index} from '${assetsImportDir}/${shot.id}.png';`);
  const entries = shots.map(
    (shot, index) =>
      `  { image: shot${index}, caption: ${JSON.stringify(shot.caption)}, alt: ${JSON.stringify(shot.alt)} },`,
  );
  return [
    '// Generated by scripts/sync-screenshots.ts; do not edit.',
    ...imports,
    '',
    'export const androidScreenshots = [',
    ...entries,
    '] as const;',
    '',
  ].join('\n');
}
