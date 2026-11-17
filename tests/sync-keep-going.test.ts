import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { parseArgs as parseDocsArgs } from '../scripts/sync-docs.ts';
import { parseArgs as parseScreenshotsArgs } from '../scripts/sync-screenshots.ts';
import { parseArgs as parseMediaArgs } from '../scripts/sync-media.ts';
import { readFailedSync, recordFailedSync } from '../scripts/lib/failed-sync.ts';

let scratch: string;

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'sync-keep-going-'));
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe('--keep-going argument parsing', () => {
  test('sync-docs accepts --keep-going anywhere and keeps the other flags', () => {
    expect(parseDocsArgs(['--keep-going'])).toEqual({
      product: undefined,
      source: undefined,
      ref: undefined,
      keepGoing: true,
    });
    expect(parseDocsArgs(['--keep-going', '--product', 'web'])).toEqual({
      product: 'web',
      source: undefined,
      ref: undefined,
      keepGoing: true,
    });
    expect(parseDocsArgs(['--product', 'web'])).toMatchObject({ product: 'web', keepGoing: false });
  });

  test('sync-screenshots and sync-media accept --keep-going', () => {
    expect(parseScreenshotsArgs(['--keep-going'])).toMatchObject({ keepGoing: true });
    expect(parseScreenshotsArgs([])).toMatchObject({ keepGoing: false });
    expect(parseMediaArgs(['--keep-going'])).toMatchObject({ keepGoing: true });
    expect(parseMediaArgs([])).toMatchObject({ keepGoing: false });
  });
});

describe('failed-sync.json round trip', () => {
  test('a missing file means no product failed', async () => {
    expect(await readFailedSync(join(scratch, 'failed-sync.json'))).toEqual([]);
  });

  test('failures append as JSON lines', async () => {
    const path = join(scratch, 'failed-sync.json');
    await recordFailedSync(path, { script: 'sync-docs', product: 'web', reason: 'boom' });
    await recordFailedSync(path, { script: 'sync-media', product: 'android', reason: 'bam' });
    expect(await readFailedSync(path)).toEqual([
      { script: 'sync-docs', product: 'web', reason: 'boom' },
      { script: 'sync-media', product: 'android', reason: 'bam' },
    ]);
  });
});
