import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

// The script copies into the checkout it lives in, so each scenario runs a copy inside a scratch repo root.
const SCRIPT = resolve('scripts/take-release-data');

let root: string;
let artifact: string;

function write(base: string, path: string, content: string): void {
  mkdirSync(join(base, path, '..'), { recursive: true });
  writeFileSync(join(base, path), content);
}

function run(): { code: number; stderr: string } {
  const child = Bun.spawnSync(['bash', join(root, 'scripts/take-release-data'), artifact], { stderr: 'pipe' });
  return { code: child.exitCode, stderr: child.stderr.toString() };
}

beforeEach(() => {
  const base = mkdtempSync(join(tmpdir(), 'take-release-data-'));
  root = join(base, 'repo');
  artifact = join(base, 'artifact');
  mkdirSync(join(root, 'scripts'), { recursive: true });
  cpSync(SCRIPT, join(root, 'scripts/take-release-data'));
  write(root, 'releases.config.json', 'old');
  write(root, 'src/data/changelog/web.json', 'old web');
  write(artifact, 'releases.config.json', 'new');
  write(artifact, 'src/data/changelog/web.json', 'new web');
  write(artifact, 'src/data/changelog/android.json', 'new android');
});

afterEach(() => {
  rmSync(join(root, '..'), { recursive: true, force: true });
});

describe('take-release-data', () => {
  test('copies the config and the changelog files', () => {
    expect(run().code).toBe(0);
    expect(readFileSync(join(root, 'releases.config.json'), 'utf8')).toBe('new');
    expect(readFileSync(join(root, 'src/data/changelog/web.json'), 'utf8')).toBe('new web');
    expect(readFileSync(join(root, 'src/data/changelog/android.json'), 'utf8')).toBe('new android');
  });

  test.each([
    ['a file outside the data paths', '.github/workflows/deploy.yml'],
    ['a git file', '.git/config'],
    ['a dotfile in the changelog directory', 'src/data/changelog/.hidden.json'],
    ['a nested changelog file', 'src/data/changelog/a/b.json'],
    ['a name with a space', 'src/data/changelog/we b.json'],
  ])('refuses %s and copies nothing', (_label, path) => {
    write(artifact, path, 'x');
    const result = run();
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('refusing');
    expect(readFileSync(join(root, 'releases.config.json'), 'utf8')).toBe('old');
    expect(existsSync(join(root, path))).toBe(false);
  });

  test('refuses a symlink and copies nothing', () => {
    rmSync(join(artifact, 'src/data/changelog/web.json'));
    symlinkSync('/etc/passwd', join(artifact, 'src/data/changelog/web.json'));
    const result = run();
    expect(result.stderr).toContain('refusing symlink');
    expect(readFileSync(join(root, 'src/data/changelog/web.json'), 'utf8')).toBe('old web');
  });

  test('requires the config file', () => {
    rmSync(join(artifact, 'releases.config.json'));
    expect(run().stderr).toContain('no releases.config.json');
  });
});
