import { createHash } from 'node:crypto';
import { describe, expect, test } from 'bun:test';
import type { DocsSource } from '../scripts/lib/docs-source.ts';
import {
  loadMediaManifest,
  parseMediaManifest,
  renderMediaModule,
  toAndroidMedia,
  verifyMediaFile,
  type MediaFile,
} from '../scripts/lib/media-manifest.ts';

const WHERE = 'owner/repo at ref "v1.0.0" docs/media/manifest.json';

function digest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function validFile(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    file: 'demo.webm',
    type: 'video/webm',
    codecs: 'vp9',
    bytes: 2_000_000,
    sha256: 'a'.repeat(64),
    ...overrides,
  };
}

const POSTER = { file: 'poster.png', type: 'image/png', codecs: 'png', bytes: 90_000, sha256: 'c'.repeat(64) };

function manifestObject(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: 1,
    appTree: 'b'.repeat(40),
    device: '720x1600x320',
    poster: 'poster.png',
    width: 720,
    height: 1600,
    durationMs: 30_000,
    alt: 'The app scrolling its session list.',
    description: ['The list shows sessions that need you.', 'Scrolling hides the bar.'],
    files: [validFile(), validFile({ file: 'demo.mp4', type: 'video/mp4', codecs: 'avc1.640028' }), POSTER],
    ...overrides,
  };
}

function manifestText(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify(manifestObject(overrides));
}

describe('parseMediaManifest', () => {
  test('accepts a valid manifest and keeps the file order', () => {
    const manifest = parseMediaManifest(manifestText(), WHERE);
    expect(manifest.poster).toBe('poster.png');
    expect(manifest.durationMs).toBe(30_000);
    expect(manifest.files.map((file) => file.file)).toEqual(['demo.webm', 'demo.mp4', 'poster.png']);
  });

  test('rejects an unknown schema', () => {
    expect(() => parseMediaManifest(manifestText({ schema: 2 }), WHERE)).toThrow(
      `${WHERE} has schema 2, this site reads schema 1`,
    );
  });

  test('rejects a disallowed extension or a path outside the media directory', () => {
    for (const file of ['demo.gif', 'demo.mov', 'demo', '../demo.webm', 'nested/demo.webm']) {
      expect(() => parseMediaManifest(manifestText({ files: [validFile({ file }), POSTER] }), WHERE)).toThrow(
        'files[0].file',
      );
    }
  });

  test('rejects a type that does not match the extension', () => {
    expect(() => parseMediaManifest(manifestText({ files: [validFile({ type: 'video/mp4' }), POSTER] }), WHERE)).toThrow(
      'files[0].type "video/mp4" must be "video/webm" for demo.webm',
    );
  });

  test('rejects a duplicate file', () => {
    expect(() => parseMediaManifest(manifestText({ files: [validFile(), validFile(), POSTER] }), WHERE)).toThrow(
      'lists file "demo.webm" more than once',
    );
  });

  test('rejects a missing poster, one not listed in files and one that is not a PNG', () => {
    expect(() => parseMediaManifest(manifestText({ poster: undefined }), WHERE)).toThrow(`${WHERE}.poster`);
    expect(() => parseMediaManifest(manifestText({ poster: 'other.png' }), WHERE)).toThrow(
      'poster "other.png" is not listed in files',
    );
    expect(() => parseMediaManifest(manifestText({ files: [validFile(), POSTER], poster: 'demo.webm' }), WHERE)).toThrow(
      `${WHERE}.poster`,
    );
  });

  test('rejects a manifest without a video', () => {
    expect(() => parseMediaManifest(manifestText({ files: [POSTER] }), WHERE)).toThrow('lists no video');
  });

  test('rejects a malformed digest, size or description', () => {
    expect(() => parseMediaManifest(manifestText({ files: [validFile({ sha256: 'xyz' }), POSTER] }), WHERE)).toThrow(
      'files[0].sha256',
    );
    expect(() => parseMediaManifest(manifestText({ files: [validFile({ bytes: 0 }), POSTER] }), WHERE)).toThrow(
      'files[0].bytes must be a positive integer',
    );
    expect(() => parseMediaManifest(manifestText({ description: [] }), WHERE)).toThrow('description must be');
  });
});

describe('loadMediaManifest', () => {
  function source(files: string[], texts: Record<string, string> = {}): DocsSource {
    return {
      description: 'fake',
      listFiles: async () => files,
      readText: async (path) => texts[path] as string,
      readBytes: async () => new Uint8Array(),
    };
  }

  test('gives "no video" when the ref has no media manifest', async () => {
    const loaded = await loadMediaManifest(source(['docs/screenshots/manifest.json']), 'docs/media/manifest.json', WHERE);
    expect(loaded).toBeNull();
  });

  test('parses the manifest when the ref has one', async () => {
    const path = 'docs/media/manifest.json';
    const loaded = await loadMediaManifest(source([path], { [path]: manifestText() }), path, WHERE);
    expect(loaded?.files).toHaveLength(3);
  });
});

describe('verifyMediaFile', () => {
  const bytes = new TextEncoder().encode('video bytes');
  const entry = validFile({ bytes: bytes.length, sha256: digest(bytes) }) as unknown as MediaFile;

  test('accepts a file that matches size and digest', () => {
    expect(() => verifyMediaFile(entry, bytes, WHERE)).not.toThrow();
  });

  test('rejects a different size and names the file', () => {
    expect(() => verifyMediaFile(entry, new Uint8Array(3), WHERE)).toThrow(`${WHERE}: demo.webm is 3 bytes`);
  });

  test('rejects changed bytes of the same size and names the file', () => {
    const changed = new TextEncoder().encode('video bytez');
    expect(() => verifyMediaFile(entry, changed, WHERE)).toThrow(`${WHERE}: demo.webm has sha256`);
  });
});

describe('media module', () => {
  test('lists the videos as site paths and the poster', () => {
    const media = toAndroidMedia(parseMediaManifest(manifestText(), WHERE));
    expect(media.poster).toBe('/media/android/poster.png');
    expect(media.sources).toEqual([
      { src: '/media/android/demo.webm', type: 'video/webm', codecs: 'vp9' },
      { src: '/media/android/demo.mp4', type: 'video/mp4', codecs: 'avc1.640028' },
    ]);
  });

  test('exports null when there is no video', () => {
    expect(renderMediaModule(null, '../x')).toContain('androidMedia: AndroidMedia | null = null;');
  });
});
