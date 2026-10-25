import { createHash } from 'node:crypto';
import { describe, expect, test } from 'bun:test';
import { parseScreenshotPin } from '../scripts/lib/docs-config.ts';
import {
  parseScreenshotManifest,
  readPngSize,
  renderScreenshotModule,
  verifyShotImage,
  type ScreenshotShot,
} from '../scripts/lib/screenshot-manifest.ts';

const WHERE = 'owner/repo at ref "v1.0.0"';

function pngBytes(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

function digest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function validShot(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'session-list',
    file: 'session-list.png',
    caption: 'Every session on every host.',
    alt: 'Session list in the dark theme.',
    width: 720,
    height: 1600,
    sha256: 'a'.repeat(64),
    ...overrides,
  };
}

function manifestText(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schema: 1,
    appTree: 'b'.repeat(40),
    device: '720x1600x320',
    shots: [validShot(), validShot({ id: 'settings', file: 'settings.png' })],
    ...overrides,
  });
}

describe('parseScreenshotManifest', () => {
  test('accepts a valid manifest and keeps the shot order', () => {
    const manifest = parseScreenshotManifest(manifestText(), WHERE);
    expect(manifest.device).toBe('720x1600x320');
    expect(manifest.shots.map((shot) => shot.id)).toEqual(['session-list', 'settings']);
  });

  test('names the ref when the manifest is not JSON', () => {
    expect(() => parseScreenshotManifest('{', WHERE)).toThrow(`${WHERE} is not valid JSON`);
  });

  test('rejects an unknown schema', () => {
    expect(() => parseScreenshotManifest(manifestText({ schema: 2 }), WHERE)).toThrow(
      `${WHERE} has schema 2, this site reads schema 1`,
    );
    expect(() => parseScreenshotManifest(manifestText({ schema: undefined }), WHERE)).toThrow('has schema undefined');
  });

  test('rejects an empty or missing shot list instead of rendering an empty gallery', () => {
    expect(() => parseScreenshotManifest(manifestText({ shots: [] }), WHERE)).toThrow('shots must be a non-empty array');
    expect(() => parseScreenshotManifest(manifestText({ shots: undefined }), WHERE)).toThrow(
      'shots must be a non-empty array',
    );
  });

  test('rejects a shot with a missing or malformed field', () => {
    expect(() => parseScreenshotManifest(manifestText({ shots: [validShot({ caption: '' })] }), WHERE)).toThrow(
      'shots[0].caption must be a non-empty string',
    );
    expect(() => parseScreenshotManifest(manifestText({ shots: [validShot({ sha256: 'xyz' })] }), WHERE)).toThrow(
      'shots[0].sha256',
    );
    expect(() => parseScreenshotManifest(manifestText({ shots: [validShot({ width: 720.5 })] }), WHERE)).toThrow(
      'shots[0].width must be a positive integer',
    );
    expect(() => parseScreenshotManifest(manifestText({ shots: [validShot({ id: 'Bad Id' })] }), WHERE)).toThrow(
      'shots[0].id',
    );
  });

  test('rejects a file that could leave the screenshot directory', () => {
    for (const file of ['../secret.png', 'nested/shot.png', '.hidden.png', 'shot.jpg']) {
      expect(() => parseScreenshotManifest(manifestText({ shots: [validShot({ file })] }), WHERE)).toThrow(
        'shots[0].file',
      );
    }
  });

  test('rejects a malformed appTree', () => {
    expect(() => parseScreenshotManifest(manifestText({ appTree: 'main' }), WHERE)).toThrow(`${WHERE}.appTree`);
  });

  test('rejects duplicate ids and duplicate files', () => {
    const twice = [validShot(), validShot({ file: 'other.png' })];
    expect(() => parseScreenshotManifest(manifestText({ shots: twice }), WHERE)).toThrow(
      'lists id "session-list" more than once',
    );
    const sameFile = [validShot(), validShot({ id: 'other' })];
    expect(() => parseScreenshotManifest(manifestText({ shots: sameFile }), WHERE)).toThrow(
      'lists file "session-list.png" more than once',
    );
  });
});

describe('readPngSize', () => {
  test('reads the size from the IHDR chunk', () => {
    expect(readPngSize(pngBytes(720, 1600))).toEqual({ width: 720, height: 1600 });
  });

  test('returns null for bytes that are not a PNG', () => {
    expect(readPngSize(new TextEncoder().encode('<html>not an image at all, long enough</html>'))).toBeNull();
    expect(readPngSize(new Uint8Array(4))).toBeNull();
  });
});

describe('verifyShotImage', () => {
  const bytes = pngBytes(720, 1600);
  const shot = validShot({ sha256: digest(bytes) }) as unknown as ScreenshotShot;

  test('accepts an image that matches digest and size', () => {
    expect(() => verifyShotImage(shot, bytes, WHERE)).not.toThrow();
  });

  test('rejects a changed image and names the digests', () => {
    const changed = pngBytes(720, 1600);
    changed[32] = 1;
    expect(() => verifyShotImage(shot, changed, WHERE)).toThrow(`${WHERE}: session-list.png has sha256`);
  });

  test('rejects a size that differs from the manifest', () => {
    const other = pngBytes(360, 800);
    const resized = { ...shot, sha256: digest(other) };
    expect(() => verifyShotImage(resized, other, WHERE)).toThrow(
      'session-list.png is 360x800, the manifest lists 720x1600',
    );
  });

  test('rejects bytes that are not a PNG even when the digest matches', () => {
    const text = new TextEncoder().encode('<html>this is not a png image, just text padding</html>');
    expect(() => verifyShotImage({ ...shot, sha256: digest(text) }, text, WHERE)).toThrow('is not a PNG image');
  });
});

describe('renderScreenshotModule', () => {
  test('imports every image and exports the gallery in manifest order', () => {
    const manifest = parseScreenshotManifest(manifestText(), WHERE);
    const source = renderScreenshotModule(manifest.shots, '../../assets/screenshots/android');
    expect(source).toContain("import shot0 from '../../assets/screenshots/android/session-list.png';");
    expect(source).toContain("import shot1 from '../../assets/screenshots/android/settings.png';");
    expect(source.indexOf('image: shot0')).toBeLessThan(source.indexOf('image: shot1'));
    expect(source).toContain('caption: "Every session on every host."');
  });

  test('escapes captions and alt text as string literals', () => {
    const shots = [validShot({ caption: 'He said "hi"\nnext', alt: "it's `x`" })] as unknown as ScreenshotShot[];
    const source = renderScreenshotModule(shots, '../a');
    expect(source).toContain('caption: "He said \\"hi\\"\\nnext"');
    expect(source).toContain('alt: "it\'s `x`"');
  });
});

describe('parseScreenshotPin', () => {
  const pin = {
    repository: 'pohunekd/pohunek-companion-android',
    ref: 'v0.1.0',
    manifest: 'docs/screenshots/manifest.json',
  };

  test('reads repository, ref and manifest path', () => {
    expect(parseScreenshotPin({ ...pin, $comment: 'x' })).toEqual(pin);
  });

  test('rejects a repository that is not owner/name', () => {
    expect(() => parseScreenshotPin({ ...pin, repository: 'https://github.com/a/b' })).toThrow('owner/name');
  });

  test('fails when the manifest path is missing', () => {
    expect(() => parseScreenshotPin({ ...pin, manifest: undefined })).toThrow('manifest must be a non-empty string');
  });
});
