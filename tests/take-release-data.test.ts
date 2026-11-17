import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { commitSummary, SUBJECT_MAX_LENGTH } from '../scripts/commit-summary.ts';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

// The script copies into the checkout it lives in, so each scenario runs a copy inside a scratch repo root.
const SCRIPT = resolve('scripts/take-release-data');

let root: string;
let artifact: string;

function write(base: string, path: string, content: string): void {
  mkdirSync(join(base, path, '..'), { recursive: true });
  writeFileSync(join(base, path), content);
}

function run(locale?: string): { code: number; stderr: string } {
  const child = Bun.spawnSync(['bash', join(root, 'scripts/take-release-data'), artifact], {
    stderr: 'pipe',
    env: locale === undefined ? process.env : { ...process.env, LC_ALL: locale },
  });
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

  test('validates the commit message and does not copy it', () => {
    write(artifact, 'commit-message.txt', 'Follow Web control center web-v0.4.1\n');
    expect(run().code).toBe(0);
    expect(existsSync(join(root, 'commit-message.txt'))).toBe(false);
    write(artifact, 'commit-message.txt', 'Record ecosystem changelog\n');
    expect(run().code).toBe(0);
  });

  test.each([
    ['a second line', 'Follow web\nextra\n'],
    ['another subject', 'Delete everything\n'],
    ['a control character', 'Follow web\u001b[31m\n'],
    ['an oversize subject', `Follow ${'x'.repeat(100)}\n`],
    ['a body without the blank line', 'Follow 2 releases\n- a\n- b\n'],
    ['a body line that is not a release', 'Follow 2 releases\n\nrm -rf\n'],
    ['a body after Record', 'Record ecosystem changelog\n\n- a\n'],
    ['an oversize body line', `Follow 2 releases\n\n- ${'x'.repeat(200)}\n- b\n`],
    ['an oversize body', `Follow 99 releases\n\n${'- a\n'.repeat(65)}`],
    ['an empty file', ''],
  ])('refuses a commit message with %s and copies nothing', (_label, content) => {
    write(artifact, 'commit-message.txt', content);
    const result = run();
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('commit-message.txt');
    expect(readFileSync(join(root, 'releases.config.json'), 'utf8')).toBe('old');
  });

  test('accepts a non-ASCII subject whatever the caller locale is', () => {
    write(artifact, 'commit-message.txt', 'Follow Šafář review v0.5.1\n');
    expect(run('C').code).toBe(0);
    expect(run('POSIX').code).toBe(0);
  });

  test('the subject bound of the script equals the producer constant', () => {
    const script = readFileSync(SCRIPT, 'utf8');
    expect(script).toContain(`subject_max_length=${SUBJECT_MAX_LENGTH}`);
  });

  test('the real commit message of every product moving in one run is accepted', () => {
    const config = JSON.parse(readFileSync(resolve('releases.config.json'), 'utf8')) as {
      products: { id: string; name: string; tagPrefix: string; version: string }[];
    };
    expect(config.products.length).toBeGreaterThanOrEqual(8);
    const moved = config.products.map((entry) => ({
      product: entry.id,
      moved: `${entry.name} ${entry.tagPrefix}${entry.version}`,
    }));
    for (const count of [1, config.products.length - 1, config.products.length]) {
      const message = commitSummary(moved.slice(0, count), []);
      expect(message.split('\n')[0].length).toBeLessThanOrEqual(SUBJECT_MAX_LENGTH);
      write(artifact, 'commit-message.txt', `${message}\n`);
      expect(run().code).toBe(0);
    }
    expect(commitSummary(moved, [])).toContain(`Follow ${moved.length} releases\n\n- `);
  });
});
