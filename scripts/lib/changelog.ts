// Changelog data of one product: the marked block of each release body (the ecosystem changelog
// contract, zajca/pohunek#1588) or, for a release without one, a list generated from its pull requests.

export const CHANGELOG_START = '<!-- pohunek-changelog:start -->';
export const CHANGELOG_END = '<!-- pohunek-changelog:end -->';

/** `release-notes`: the curated block of the release body. `generated`: pull request titles, not curated. */
export type ChangelogSource = 'release-notes' | 'generated';

export interface ChangelogRelease {
  readonly tag: string;
  readonly version: string;
  /** ISO 8601 publication time from GitHub. */
  readonly publishedAt: string;
  readonly prerelease: boolean;
  readonly url: string;
  readonly source: ChangelogSource;
  /** Untrusted Markdown; rendered only through the sanitizing renderer. */
  readonly markdown: string;
}

export interface ProductChangelog {
  readonly product: string;
  /** Newest first. */
  readonly releases: readonly ChangelogRelease[];
}

export interface PullTitle {
  readonly number: number;
  readonly title: string;
}

type JsonObject = Record<string, unknown>;

const MERGE_SUBJECT = /^Merge pull request #([1-9][0-9]*) from \S+$/;
const SQUASH_SUBJECT = /\(#([1-9][0-9]*)\)$/;
/** Release-preparation pull requests carry no user-facing change of their own. */
const RELEASE_TITLE = /^Release\b/i;

/**
 * The content between the changelog markers, or undefined when the body has no markers.
 * A body with a lone, repeated or out-of-order marker is malformed and throws.
 */
export function extractChangelogBlock(body: string): string | undefined {
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  const starts = lines.flatMap((line, index) => (line.trim() === CHANGELOG_START ? [index] : []));
  const ends = lines.flatMap((line, index) => (line.trim() === CHANGELOG_END ? [index] : []));
  if (starts.length === 0 && ends.length === 0) {
    return undefined;
  }
  if (starts.length !== 1 || ends.length !== 1 || ends[0] < starts[0]) {
    throw new Error('release body has malformed changelog markers');
  }
  const block = lines
    .slice(starts[0] + 1, ends[0])
    .join('\n')
    .trim();
  if (block.length === 0) {
    throw new Error('release body has an empty changelog block');
  }
  return block;
}

/** Pull request numbers named by merge or squash commit subjects, in commit order, without repeats. */
export function pullCandidates(messages: readonly string[]): number[] {
  const numbers: number[] = [];
  for (const message of messages) {
    const subject = message.split('\n', 1)[0].trim();
    const match = MERGE_SUBJECT.exec(subject) ?? SQUASH_SUBJECT.exec(subject);
    if (match !== null) {
      const number = Number(match[1]);
      if (!numbers.includes(number)) {
        numbers.push(number);
      }
    }
  }
  return numbers;
}

/** Markdown list of the pull requests of a release without a curated block. */
export function renderGeneratedMarkdown(
  pulls: readonly PullTitle[],
  repository: string,
  githubUrl: string,
  previousTag: string | undefined,
): string {
  if (previousTag === undefined) {
    return 'First release.';
  }
  const listed = pulls.filter((pull) => !RELEASE_TITLE.test(pull.title.trim()));
  if (listed.length === 0) {
    return `No pull requests merged since ${previousTag}.`;
  }
  return listed
    .map((pull) => {
      // A title is one line of plain text; collapsing whitespace keeps it from opening Markdown blocks.
      const title = pull.title.replace(/\s+/g, ' ').trim();
      return `- ${title} ([#${pull.number}](${githubUrl}/${repository}/pull/${pull.number}))`;
    })
    .join('\n');
}

function requireString(obj: JsonObject, key: string, where: string): string {
  const value = obj[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${where}.${key} must be a non-empty string`);
  }
  return value;
}

/** Validates one committed changelog file. */
export function parseProductChangelog(raw: unknown, where: string): ProductChangelog {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error(`${where} must be a JSON object`);
  }
  const obj = raw as JsonObject;
  const product = requireString(obj, 'product', where);
  if (!Array.isArray(obj.releases)) {
    throw new Error(`${where}.releases must be an array`);
  }
  const releases = obj.releases.map((item: unknown, index: number): ChangelogRelease => {
    const at = `${where}.releases[${index}]`;
    if (typeof item !== 'object' || item === null) {
      throw new Error(`${at} must be a JSON object`);
    }
    const release = item as JsonObject;
    const source = release.source;
    if (source !== 'release-notes' && source !== 'generated') {
      throw new Error(`${at}.source must be "release-notes" or "generated"`);
    }
    if (typeof release.prerelease !== 'boolean') {
      throw new Error(`${at}.prerelease must be true or false`);
    }
    const publishedAt = requireString(release, 'publishedAt', at);
    if (Number.isNaN(Date.parse(publishedAt))) {
      throw new Error(`${at}.publishedAt is not a date`);
    }
    const url = requireString(release, 'url', at);
    if (!url.startsWith('https://github.com/')) {
      throw new Error(`${at}.url must be a GitHub URL`);
    }
    return {
      tag: requireString(release, 'tag', at),
      version: requireString(release, 'version', at),
      publishedAt,
      prerelease: release.prerelease,
      url,
      source,
      markdown: requireString(release, 'markdown', at),
    };
  });
  return { product, releases };
}

export function renderChangelogFile(changelog: ProductChangelog): string {
  return `${JSON.stringify(changelog, null, 2)}\n`;
}
