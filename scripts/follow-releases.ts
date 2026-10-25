#!/usr/bin/env bun
// Moves every product pin in releases.config.json to the product's newest eligible release once the
// release's assets verify, and records the changelog of every release up to the pin.
// Usage: follow-releases.ts [--product <id> [--version <X.Y.Z>]]. Needs GH_TOKEN (read access) and gh.
// Prints one line naming the moved pins (empty when none moved) on stdout; progress goes to stderr.
// Exits 2 when some products failed (the others are still followed), 1 when nothing could run.
import { createHash } from 'node:crypto';
import { mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import {
  CHANGELOG_START,
  extractChangelogBlock,
  parseProductChangelog,
  pullCandidates,
  renderChangelogFile,
  renderGeneratedMarkdown,
  type ChangelogRelease,
  type ProductChangelog,
} from './lib/changelog.ts';
import { parseDocsSyncConfig } from './lib/docs-config.ts';
import { GithubClient, type GithubAsset, type GithubRelease } from './lib/github.ts';
import {
  assetNames,
  compareVersions,
  findProduct,
  parseReleasesConfig,
  renderWithVersion,
  versionOfTag,
  type Product,
  type ReleasesConfig,
} from './lib/releases-config.ts';

interface CliArgs {
  readonly product?: string;
  readonly version?: string;
}

interface Eligible {
  readonly version: string;
  readonly release: GithubRelease;
}

const REPO_ROOT = resolve(dirname(import.meta.path), '..');
const CONFIG_FILE = 'releases.config.json';
const SHA256_LINE = /^([0-9a-f]{64}) [ *](\S+)\n?$/;

function parseArgs(argv: readonly string[]): CliArgs {
  const values: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag !== '--product' && flag !== '--version') {
      throw new Error(`unknown argument "${flag}"; usage: follow-releases.ts [--product <id> [--version <X.Y.Z>]]`);
    }
    if (value === undefined || value.startsWith('--') || value.length === 0) {
      throw new Error(`${flag} needs a value`);
    }
    values[flag.slice(2)] = value;
  }
  if (values.version !== undefined && values.product === undefined) {
    throw new Error('--version needs --product');
  }
  return { product: values.product, version: values.version };
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`missing environment variable ${name}`);
  }
  return value;
}

async function writeFileAtomic(path: string, content: string): Promise<void> {
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, content, 'utf8');
  await rename(temporary, path);
}

/** Published releases of the product, oldest first; GitHub's pre-release flag must agree with the policy. */
function eligibleReleases(product: Product, releases: readonly GithubRelease[]): Eligible[] {
  return releases
    .flatMap((release) => {
      if (release.draft || (release.prerelease && !product.prerelease)) {
        return [];
      }
      const version = versionOfTag(product, release.tagName);
      return version === undefined ? [] : [{ version, release }];
    })
    .sort((a, b) => compareVersions(a.version, b.version));
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function findAsset(release: GithubRelease, name: string): GithubAsset {
  const asset = release.assets.find((candidate) => candidate.name === name);
  if (asset === undefined) {
    throw new Error(`${release.tagName} has no asset ${name}`);
  }
  return asset;
}

async function runGhAttestationVerify(path: string, repository: string): Promise<void> {
  const child = Bun.spawn(['gh', 'attestation', 'verify', path, '--repo', repository], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  if (code !== 0) {
    throw new Error(`gh attestation verify failed for ${path}: ${stderr.trim()}`);
  }
}

/** Every asset the site names exists, matches its .sha256 file and GitHub's digest, and is attested when required. */
async function verifyAssets(github: GithubClient, product: Product, target: Eligible): Promise<void> {
  const workDir = await mkdtemp(join(tmpdir(), `follow-releases-${product.id}-`));
  try {
    for (const name of assetNames(product, target.version)) {
      const asset = findAsset(target.release, name);
      const checksum = findAsset(target.release, `${name}.sha256`);
      const bytes = await github.downloadAsset(asset);
      const actual = sha256Hex(bytes);

      const line = SHA256_LINE.exec(new TextDecoder().decode(await github.downloadAsset(checksum)));
      if (line === null || line[2] !== name) {
        throw new Error(`${checksum.name} is not one "<sha256>  ${name}" line`);
      }
      if (line[1] !== actual) {
        throw new Error(`${name} does not match ${checksum.name}`);
      }
      if (asset.digest !== undefined && asset.digest !== `sha256:${actual}`) {
        throw new Error(`${name} does not match the digest GitHub recorded`);
      }
      if (product.attested) {
        const path = join(workDir, name);
        await writeFile(path, bytes);
        await runGhAttestationVerify(path, product.repository);
      }
      console.error(`  ${product.id} ${target.version}: ${name} verified`);
    }
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

async function generatedMarkdown(
  github: GithubClient,
  product: Product,
  githubUrl: string,
  previous: Eligible | undefined,
  current: Eligible,
): Promise<string> {
  if (previous === undefined) {
    return renderGeneratedMarkdown([], product.repository, githubUrl, undefined);
  }
  const commits = await github.compareCommits(
    product.repository,
    previous.release.tagName,
    current.release.tagName,
  );
  const shas = new Set(commits.map((commit) => commit.sha));
  const pulls = [];
  for (const number of pullCandidates(commits.map((commit) => commit.message))) {
    const pull = await github.getPull(product.repository, number);
    // A number in a subject counts only when that pull request was merged by a commit of this range.
    if (pull !== undefined && pull.merged && pull.mergeCommitSha !== undefined && shas.has(pull.mergeCommitSha)) {
      pulls.push(pull);
    }
  }
  return renderGeneratedMarkdown(pulls, product.repository, githubUrl, previous.release.tagName);
}

async function readChangelog(path: string, product: Product): Promise<ProductChangelog> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    return { product: product.id, releases: [] };
  }
  const changelog = parseProductChangelog(await file.json(), path);
  if (changelog.product !== product.id) {
    throw new Error(`${path} belongs to product "${changelog.product}", not "${product.id}"`);
  }
  return changelog;
}

/** Adds every eligible release up to the pin that the changelog does not hold yet. Recorded releases are kept as they are. */
async function updateChangelog(
  github: GithubClient,
  config: ReleasesConfig,
  githubUrl: string,
  product: Product,
  pinned: string,
  eligible: readonly Eligible[],
): Promise<number> {
  const path = join(REPO_ROOT, config.changelogDir, `${product.id}.json`);
  const changelog = await readChangelog(path, product);
  const known = new Set(changelog.releases.map((release) => release.tag));
  const included = eligible.filter((entry) => compareVersions(entry.version, pinned) <= 0);

  const added: ChangelogRelease[] = [];
  for (const [index, entry] of included.entries()) {
    if (known.has(entry.release.tagName)) {
      continue;
    }
    const block = extractChangelogBlock(entry.release.body);
    const markdown =
      block ?? (await generatedMarkdown(github, product, githubUrl, included[index - 1], entry));
    added.push({
      tag: entry.release.tagName,
      version: entry.version,
      publishedAt: entry.release.publishedAt,
      prerelease: entry.release.prerelease,
      url: entry.release.htmlUrl,
      source: block === undefined ? 'generated' : 'release-notes',
      markdown,
    });
    console.error(`  ${product.id} ${entry.version}: changelog from ${block === undefined ? 'pull requests' : CHANGELOG_START}`);
  }
  if (added.length === 0) {
    return 0;
  }
  const releases = [...changelog.releases, ...added].sort((a, b) => compareVersions(b.version, a.version));
  await writeFileAtomic(path, renderChangelogFile({ product: product.id, releases }));
  return added.length;
}

interface Followed {
  /** `<name> <tag>` when the pin moved. */
  readonly moved?: string;
  readonly recorded: number;
}

/** Follows one product: the pin moves only after its assets verify and the changelog up to it is written. */
async function followProduct(
  github: GithubClient,
  config: ReleasesConfig,
  githubUrl: string,
  product: Product,
  releases: readonly GithubRelease[],
  requestedVersion: string | undefined,
): Promise<Followed> {
  const eligible = eligibleReleases(product, releases);
  if (eligible.length === 0) {
    throw new Error(`${product.repository} has no published ${product.tagPrefix} release`);
  }
  const targetVersion = requestedVersion ?? eligible[eligible.length - 1].version;
  const target = eligible.find((entry) => entry.version === targetVersion);
  if (target === undefined) {
    throw new Error(`no published release ${product.tagPrefix}${targetVersion}`);
  }

  const order = compareVersions(target.version, product.version);
  if (order < 0) {
    throw new Error(`refusing to move the pin back from ${product.version} to ${target.version}`);
  }
  if (order === 0) {
    console.error(`follow-releases: ${product.id} already at ${product.version}`);
    return { recorded: await updateChangelog(github, config, githubUrl, product, product.version, eligible) };
  }

  await verifyAssets(github, product, target);
  const recorded = await updateChangelog(github, config, githubUrl, product, target.version, eligible);
  // Re-read the file so each product's rewrite keeps the others' updates.
  const raw = (await Bun.file(join(REPO_ROOT, CONFIG_FILE)).json()) as Record<string, unknown>;
  const content = renderWithVersion(raw, product.id, target.version);
  parseReleasesConfig(JSON.parse(content));
  await writeFileAtomic(join(REPO_ROOT, CONFIG_FILE), content);
  console.error(`follow-releases: ${product.id} ${product.version} -> ${target.version}`);
  return { moved: `${product.name} ${product.tagPrefix}${target.version}`, recorded };
}

/** Exit code when some products failed and the others were followed. */
const PARTIAL_FAILURE = 2;

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const config = parseReleasesConfig(await Bun.file(join(REPO_ROOT, CONFIG_FILE)).json());
  const github = new GithubClient(config.apiUrl, requireEnv('GH_TOKEN'));
  const { githubUrl } = parseDocsSyncConfig(await Bun.file(join(REPO_ROOT, 'docs-sync.config.json')).json());
  const selected = args.product === undefined ? config.products : [findProduct(config, args.product)];

  const releasesByRepository = new Map<string, GithubRelease[]>();
  const moved: string[] = [];
  const failures: string[] = [];
  let recorded = 0;

  // One product's broken release must not hold back the others; its failure is reported at the end.
  for (const product of selected) {
    try {
      let releases = releasesByRepository.get(product.repository);
      if (releases === undefined) {
        releases = await github.listReleases(product.repository);
        releasesByRepository.set(product.repository, releases);
      }
      const followed = await followProduct(github, config, githubUrl, product, releases, args.version);
      recorded += followed.recorded;
      if (followed.moved !== undefined) {
        moved.push(followed.moved);
      }
    } catch (error) {
      failures.push(`${product.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  console.error(`follow-releases: ${moved.length} pin(s) moved, ${recorded} changelog release(s) recorded`);
  for (const failure of failures) {
    console.error(`follow-releases: FAILED ${failure}`);
  }
  console.log(moved.join(', '));
  return failures.length === 0 ? 0 : PARTIAL_FAILURE;
}

try {
  process.exitCode = await main();
} catch (error) {
  console.error(`follow-releases: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
