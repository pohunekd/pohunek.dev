#!/usr/bin/env bun
// Moves every product pin in releases.config.json to the product's newest eligible release once the
// release's assets verify, and records the changelog of every release up to the pin.
// Every product is followed on its own: one product's failing assets, attestation or docs sync keep
// that product's old pin (and its old changelog entries) while the products that pass still move.
// Usage: follow-releases.ts [--product <id> [--version <X.Y.Z>]]. Needs GH_TOKEN (read access) and gh.
// Prints one line naming the moved pins (empty when none moved) on stdout; progress goes to stderr.
// Exits 2 when some products failed (the others are still followed), 1 when nothing could run.
import { createHash } from 'node:crypto';
import { appendFile, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
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
import { parseDocsSyncConfig, type DocsSyncConfig } from './lib/docs-config.ts';
import { DocsSyncError } from './lib/docs-source.ts';
import { buildDocPage, createLinkTargets, extractInstallPrompt, planPages } from './lib/docs-transform.ts';
import { parseMediaManifest, verifyMediaFile } from './lib/media-manifest.ts';
import { parseScreenshotManifest, verifyShotImage } from './lib/screenshot-manifest.ts';
import {
  GithubClient,
  type GithubAsset,
  type GithubCommit,
  type GithubPull,
  type GithubRelease,
} from './lib/github.ts';
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

// Overridable for tests, which run the follow against a scratch root instead of this checkout.
const REPO_ROOT = process.env.FOLLOW_RELEASES_ROOT ?? resolve(dirname(import.meta.path), '..');
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

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function findAsset(release: GithubRelease, name: string): GithubAsset {
  const asset = release.assets.find((candidate) => candidate.name === name);
  if (asset === undefined) {
    throw new Error(`${release.tagName} has no asset ${name}`);
  }
  return asset;
}

/** The attestation must come from the product's release workflow, run for exactly this tag. */
async function runGhAttestationVerify(path: string, product: Product, tag: string): Promise<void> {
  if (product.signerWorkflow === undefined) {
    throw new Error(`${product.id} is attested but names no signerWorkflow`);
  }
  const child = Bun.spawn(
    [
      'gh',
      'attestation',
      'verify',
      path,
      '--repo',
      product.repository,
      '--signer-workflow',
      `${product.repository}/${product.signerWorkflow}`,
      '--source-ref',
      `refs/tags/${tag}`,
    ],
    { stdout: 'pipe', stderr: 'pipe' },
  );
  const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  if (code !== 0) {
    throw new Error(`gh attestation verify failed for ${path}: ${stderr.trim()}`);
  }
}

/** Every asset the site names exists, matches its .sha256 file and GitHub's digest, and is attested when required. */
export async function verifyAssets(github: ReleaseFetcher, product: Product, target: Eligible): Promise<void> {
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
        await runGhAttestationVerify(path, product, target.release.tagName);
      }
      console.error(`  ${product.id} ${target.version}: ${name} verified`);
    }
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

async function generatedMarkdown(
  github: ReleaseFetcher,
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
  github: ReleaseFetcher,
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

export interface Followed {
  /** `<name> <tag>` when the pin moved. */
  readonly moved?: string;
  readonly recorded: number;
}

export interface ProductOutcome {
  /** Product id as used in releases.config.json. */
  readonly product: string;
  /** `<name> <tag>` when the pin moved; empty when the product stayed. */
  readonly moved?: string;
  readonly failed: boolean;
  readonly reason?: string;
}

/** The subset of GithubClient the follow needs; tests pass fakes with no network. */
export interface ReleaseFetcher {
  listReleases(repository: string): Promise<GithubRelease[]>;
  downloadAsset(asset: GithubAsset): Promise<Uint8Array>;
  compareCommits(repository: string, base: string, head: string): Promise<GithubCommit[]>;
  getPull(repository: string, number: number): Promise<GithubPull | undefined>;
}

interface ProductDocsCheck {
  (
    docsConfig: DocsSyncConfig,
    product: Product,
    version: string,
    fetchText: (repository: string, ref: string, path: string) => Promise<string>,
    fetchBytes: (repository: string, ref: string, path: string) => Promise<Uint8Array>,
  ): Promise<void>;
}

/** Follows one product: the pin moves only after its assets verify and the changelog up to it is written. */
export async function followProduct(
  github: ReleaseFetcher,
  config: ReleasesConfig,
  githubUrl: string,
  product: Product,
  releases: readonly GithubRelease[],
  requestedVersion: string | undefined,
  check?: {
    readonly docsConfig: DocsSyncConfig;
    readonly checkDocs: ProductDocsCheck;
    readonly fetchText: (repository: string, ref: string, path: string) => Promise<string>;
    readonly fetchBytes: (repository: string, ref: string, path: string) => Promise<Uint8Array>;
  },
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
  const changelogPath = join(REPO_ROOT, config.changelogDir, `${product.id}.json`);
  const previousChangelog = (await Bun.file(changelogPath).exists())
    ? await Bun.file(changelogPath).text()
    : undefined;
  const recorded = await updateChangelog(github, config, githubUrl, product, target.version, eligible);
  // Re-read the file so each product's rewrite keeps the others' updates.
  const raw = (await Bun.file(join(REPO_ROOT, CONFIG_FILE)).json()) as Record<string, unknown>;
  const content = renderWithVersion(raw, product.id, target.version);
  parseReleasesConfig(JSON.parse(content));
  await writeFileAtomic(join(REPO_ROOT, CONFIG_FILE), content);
  try {
    if (check !== undefined) {
      await check.checkDocs(check.docsConfig, product, target.version, check.fetchText, check.fetchBytes);
    }
  } catch (error) {
    // The new release's docs do not sync: keep the old pin and the old changelog entries.
    const reason = error instanceof Error ? error.message : String(error);
    const current = JSON.parse(await Bun.file(join(REPO_ROOT, CONFIG_FILE)).text()) as Record<string, unknown>;
    await writeFileAtomic(join(REPO_ROOT, CONFIG_FILE), renderWithVersion(current, product.id, product.version));
    if (previousChangelog === undefined) {
      await rm(changelogPath, { force: true });
    } else {
      await writeFileAtomic(changelogPath, previousChangelog);
    }
    throw new Error(
      `docs sync failed at ${product.tagPrefix}${target.version}, kept pin ${product.version}: ${reason}`,
    );
  }
  console.error(`follow-releases: ${product.id} ${product.version} -> ${target.version}`);
  return { moved: `${product.name} ${product.tagPrefix}${target.version}`, recorded };
}

/** Exit code when some products failed and the others were followed. */
const PARTIAL_FAILURE = 2;

/**
 * Checks that the new pin's docs still sync: plans the product's whitelisted pages and extracts its
 * install prompt from the new tag, and, for a product with a screenshot or media manifest, reads and
 * verifies that manifest at the new tag. Throws when any of it fails; nothing in the real checkout is
 * touched, so a failure leaves the previously synced docs — which belong to the old pin — as they are.
 */
async function checkProductDocs(
  docsConfig: DocsSyncConfig,
  product: Product,
  version: string,
  fetchText: (repository: string, ref: string, path: string) => Promise<string>,
  fetchBytes: (repository: string, ref: string, path: string) => Promise<Uint8Array>,
): Promise<void> {
  const ref = `${product.tagPrefix}${version}`;
  const source = docsConfig.sources.find((entry) => entry.product === product.id);
  if (source !== undefined) {
    const files = await listRefFiles(product.repository, ref, fetchText);
    const planned = planPages(source.pages, files);
    const routes = new Map(planned.map((page) => [page.sourcePath, page.route]));
    const targets = createLinkTargets({
      files,
      routes,
      repository: product.repository,
      ref,
      githubUrl: docsConfig.githubUrl,
      rawUrl: docsConfig.rawUrl,
      routePrefix: source.routePrefix,
    });
    for (const page of planned) {
      buildDocPage({
        sourcePath: page.sourcePath,
        text: await fetchText(product.repository, ref, page.sourcePath),
        planned: page,
        editUrl: `${docsConfig.githubUrl}/${product.repository}/blob/${source.editBranch}/${page.sourcePath}`,
        targets,
      });
    }
    if (source.installPrompt !== undefined) {
      extractInstallPrompt(
        await fetchText(product.repository, ref, source.installPrompt.readme),
        source.installPrompt.heading,
      );
    }
  }
  if (product.screenshotManifest !== undefined) {
    const where = `${product.repository} at ref "${ref}" ${product.screenshotManifest}`;
    const manifest = parseScreenshotManifest(await fetchText(product.repository, ref, product.screenshotManifest), where);
    const manifestDir = dirname(product.screenshotManifest);
    for (const shot of manifest.shots) {
      const path = manifestDir === '.' ? shot.file : `${manifestDir}/${shot.file}`;
      verifyShotImage(shot, await fetchBytes(product.repository, ref, path), `${where} ${path}`);
    }
  }
  if (product.mediaManifest !== undefined) {
    const where = `${product.repository} at ref "${ref}" ${product.mediaManifest}`;
    const raw = await fetchOptionalText(product.repository, ref, product.mediaManifest, fetchText);
    if (raw !== undefined) {
      const manifest = parseMediaManifest(raw, where);
      const manifestDir = dirname(product.mediaManifest);
      for (const entry of manifest.files) {
        const path = manifestDir === '.' ? entry.file : `${manifestDir}/${entry.file}`;
        verifyMediaFile(entry, await fetchBytes(product.repository, ref, path), `${where} ${path}`);
      }
    }
  }
}

async function fetchOptionalText(
  repository: string,
  ref: string,
  path: string,
  fetchText: (repository: string, ref: string, path: string) => Promise<string>,
): Promise<string | undefined> {
  try {
    return await fetchText(repository, ref, path);
  } catch (error) {
    if (error instanceof DocsSyncError) {
      return undefined;
    }
    throw error;
  }
}

async function listRefFiles(
  repository: string,
  ref: string,
  fetchText: (repository: string, ref: string, path: string) => Promise<string>,
): Promise<string[]> {
  try {
    const child = Bun.spawn(
      ['gh', 'api', `repos/${repository}/git/trees/${ref}?recursive=1`, '--jq', '.tree[].path'],
      { stdout: 'pipe', stderr: 'pipe' },
    );
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (code !== 0) {
      throw new DocsSyncError(`could not list ${repository} at ref "${ref}": ${stderr.trim()}`);
    }
    const files = stdout.split('\n').filter((entry) => entry !== '');
    if (files.length === 0) {
      throw new DocsSyncError(`could not list ${repository} at ref "${ref}": empty tree`);
    }
    return files;
  } catch (error) {
    if (error instanceof DocsSyncError) {
      throw error;
    }
    throw new DocsSyncError(
      `could not list ${repository} at ref "${ref}": ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
/** Reads a repository file at a ref through the gh CLI (no Bearer token leaves this machine). */
async function ghFetchText(repository: string, ref: string, path: string): Promise<string> {
  return new TextDecoder().decode(await ghFetchBytes(repository, ref, path));
}

async function ghFetchBytes(repository: string, ref: string, path: string): Promise<Uint8Array> {
  const child = Bun.spawn(
    ['gh', 'api', `repos/${repository}/contents/${path}?ref=${ref}`, '--jq', '.content'],
    { stdout: 'pipe', stderr: 'pipe' },
  );
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0) {
    throw new DocsSyncError(`${repository} at ref "${ref}" has no readable file ${path}: ${stderr.trim()}`);
  }
  const base64 = stdout.replace(/\s+/g, '');
  if (base64.length === 0) {
    throw new DocsSyncError(`${repository} at ref "${ref}" has an empty file ${path}`);
  }
  try {
    return Buffer.from(base64, 'base64');
  } catch {
    throw new DocsSyncError(`${repository} at ref "${ref}" returned unreadable content for ${path}`);
  }
}



/** Appends a per-product table to the workflow run summary, so a failing product is visible in red. */
export async function writeSummary(outcomes: readonly ProductOutcome[]): Promise<void> {
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (summaryFile === undefined || summaryFile.length === 0) {
    return;
  }
  const lines = ['### follow-releases', '', '| product | result | detail |', '| --- | --- | --- |'];
  for (const outcome of outcomes) {
    if (outcome.failed) {
      lines.push(`| ${outcome.product} | FAILED | ${sanitizeCell(outcome.reason ?? 'unknown error')} |`);
    } else if (outcome.moved !== undefined) {
      lines.push(`| ${outcome.product} | moved | ${sanitizeCell(outcome.moved)} |`);
    } else {
      lines.push(`| ${outcome.product} | unchanged | already at the newest release |`);
    }
  }
  await appendFile(summaryFile, `${lines.join('\n')}\n`);
}

export function sanitizeCell(text: string): string {
  return text.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|');
}

/**
 * Follows one product without touching the others: a failure records {product, reason}, keeps the old
 * pin and lets the remaining products continue. Failures bubble out of followProduct unchanged, so
 * nothing about the security checks is weakened for the products that pass.
 */
export async function followEach(
  selected: readonly Product[],
  run: (product: Product) => Promise<Followed>,
): Promise<{ outcomes: ProductOutcome[]; moved: string[]; recorded: number }> {
  const outcomes: ProductOutcome[] = [];
  const moved: string[] = [];
  let recorded = 0;
  for (const product of selected) {
    try {
      const followed = await run(product);
      recorded += followed.recorded;
      if (followed.moved !== undefined) {
        moved.push(followed.moved);
      }
      outcomes.push({ product: product.id, moved: followed.moved, failed: false });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      outcomes.push({ product: product.id, failed: true, reason });
    }
  }
  return { outcomes, moved, recorded };
}

export async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const config = parseReleasesConfig(await Bun.file(join(REPO_ROOT, CONFIG_FILE)).json());
  const github = new GithubClient(config.apiUrl, requireEnv('GH_TOKEN'));
  const docsConfig = parseDocsSyncConfig(
    await Bun.file(join(REPO_ROOT, 'docs-sync.config.json')).json(),
    config.products.map((product) => product.id),
  );
  const selected = args.product === undefined ? config.products : [findProduct(config, args.product)];

  const releasesByRepository = new Map<string, GithubRelease[]>();

  // One product's broken release must not hold back the others; its failure is reported at the end.
  const { outcomes, moved, recorded } = await followEach(selected, async (product) => {
    let releases = releasesByRepository.get(product.repository);
    if (releases === undefined) {
      releases = await github.listReleases(product.repository);
      releasesByRepository.set(product.repository, releases);
    }
    return followProduct(github, docsConfig.githubUrl, product, releases, args.version, {
      docsConfig,
      checkDocs: checkProductDocs,
      fetchText: ghFetchText,
      fetchBytes: ghFetchBytes,
    });
  });

  console.error(`follow-releases: ${moved.length} pin(s) moved, ${recorded} changelog release(s) recorded`);
  for (const outcome of outcomes) {
    if (outcome.failed) {
      console.error(`follow-releases: FAILED ${outcome.product}: ${outcome.reason}`);
    }
  }
  await writeSummary(outcomes);
  console.log(moved.join(', '));
  return outcomes.some((outcome) => outcome.failed) ? PARTIAL_FAILURE : 0;
}

if (import.meta.main) {
  try {
    process.exitCode = await main();
  } catch (error) {
    console.error(`follow-releases: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
