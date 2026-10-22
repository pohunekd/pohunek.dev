import { posix } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { PageRule } from './docs-config.ts';

/** A whitelisted source file and the site route it is published under. */
export interface PlannedPage {
  readonly sourcePath: string;
  readonly route: string;
  readonly title?: string;
}

/** Everything a link needs to know about the pinned repository and the published pages. */
export interface LinkTargets {
  readonly files: ReadonlySet<string>;
  readonly dirs: ReadonlySet<string>;
  readonly routes: ReadonlyMap<string, string>;
  readonly routeUrl: (route: string) => string;
  readonly blobUrl: (path: string) => string;
  readonly treeUrl: (path: string) => string;
  readonly rawUrl: (path: string) => string;
}

export interface LinkTargetsInput {
  readonly files: readonly string[];
  readonly routes: ReadonlyMap<string, string>;
  readonly repository: string;
  readonly ref: string;
  readonly githubUrl: string;
  readonly rawUrl: string;
  readonly routePrefix: string;
}

export interface BuiltPage {
  readonly sourcePath: string;
  readonly route: string;
  readonly title: string;
  readonly content: string;
  readonly warnings: readonly string[];
}

export interface BuildPageInput {
  readonly sourcePath: string;
  readonly text: string;
  readonly planned: PlannedPage;
  readonly editUrl: string;
  readonly targets: LinkTargets;
}

const GLOB_CHARACTERS = /[*?[{]/;

/** Splits a leading `---` YAML frontmatter block from the Markdown body. */
export function splitFrontmatter(text: string): { data: Record<string, unknown>; body: string } {
  const lines = normalizeNewlines(text).split('\n');
  if (lines[0] !== '---') {
    return { data: {}, body: lines.join('\n') };
  }
  const closing = lines.indexOf('---', 1);
  if (closing === -1) {
    throw new Error('frontmatter opened with "---" is never closed');
  }
  const parsed: unknown = parseYaml(lines.slice(1, closing).join('\n'));
  if (parsed === null || parsed === undefined) {
    return { data: {}, body: lines.slice(closing + 1).join('\n') };
  }
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('frontmatter must be a YAML mapping');
  }
  return {
    data: parsed as Record<string, unknown>,
    body: lines.slice(closing + 1).join('\n'),
  };
}

/**
 * Removes the first ATX H1 when it is the first content of the body, because the
 * site renders the title from frontmatter. Returns the removed heading text, if any.
 */
export function stripLeadingH1(body: string): { heading: string | null; body: string } {
  const lines = body.split('\n');
  const first = lines.findIndex((line) => line.trim() !== '');
  if (first === -1) {
    return { heading: null, body };
  }
  const match = /^#[ \t]+(.+?)[ \t]*#*[ \t]*$/.exec(lines[first]);
  if (!match) {
    return { heading: null, body };
  }
  let next = first + 1;
  while (next < lines.length && lines[next].trim() === '') {
    next++;
  }
  return { heading: match[1], body: lines.slice(next).join('\n') };
}

/** Removes Markdown inline markup that is not meaningful in a plain-text title. */
export function plainTitle(text: string): string {
  return text.replace(/\\(.)/g, '$1').replace(/`/g, '').trim();
}

/** Expands the page rules against the files present at the pinned ref. Throws when a rule matches nothing. */
export function planPages(rules: readonly PageRule[], files: readonly string[]): PlannedPage[] {
  const fileSet = new Set(files);
  const planned = new Map<string, PlannedPage>();
  const routes = new Map<string, string>();

  for (const rule of rules) {
    const isGlob = GLOB_CHARACTERS.test(rule.source);
    const glob = new Bun.Glob(rule.source);
    const matches = isGlob
      ? files.filter((file) => glob.match(file))
      : fileSet.has(rule.source)
        ? [rule.source]
        : [];

    if (matches.length === 0) {
      throw new Error(`whitelisted source matches no file at the pinned ref: ${rule.source}`);
    }

    for (const sourcePath of matches) {
      const route = rule.route ?? routeFromBase(sourcePath, rule.routeBase ?? '');
      if (planned.has(sourcePath)) {
        throw new Error(`${sourcePath} is matched by more than one page rule`);
      }
      const owner = routes.get(route);
      if (owner !== undefined) {
        throw new Error(`route "${route}" is produced by both ${owner} and ${sourcePath}`);
      }
      routes.set(route, sourcePath);
      planned.set(sourcePath, { sourcePath, route, title: rule.title });
    }
  }

  return [...planned.values()].sort((a, b) => a.sourcePath.localeCompare(b.sourcePath));
}

/** Builds the link resolution context: which repository paths are published and which are GitHub links. */
export function createLinkTargets(input: LinkTargetsInput): LinkTargets {
  const files = new Set(input.files);
  const dirs = new Set<string>();
  for (const file of files) {
    for (let dir = posix.dirname(file); dir !== '.' && dir !== '/'; dir = posix.dirname(dir)) {
      dirs.add(dir);
    }
  }
  const repoUrl = `${input.githubUrl}/${input.repository}`;
  return {
    files,
    dirs,
    routes: input.routes,
    routeUrl: (route) => (route === '' ? `/${input.routePrefix}/` : `/${input.routePrefix}/${route}/`),
    blobUrl: (path) => `${repoUrl}/blob/${input.ref}/${path}`,
    treeUrl: (path) => `${repoUrl}/tree/${input.ref}/${path}`,
    rawUrl: (path) => `${input.rawUrl}/${input.repository}/${input.ref}/${path}`,
  };
}

/** Parses one page: frontmatter, title, H1 removal and link rewriting. Output keeps only title, description and editUrl. */
export function buildDocPage(input: BuildPageInput): BuiltPage {
  const { data, body } = splitFrontmatter(input.text);
  const stripped = stripLeadingH1(body);

  const frontmatterTitle = typeof data.title === 'string' ? data.title : undefined;
  const rawTitle = input.planned.title ?? frontmatterTitle ?? stripped.heading;
  if (rawTitle === undefined || rawTitle === null) {
    throw new Error(`${input.sourcePath} has neither a frontmatter title nor a leading H1`);
  }
  const title = plainTitle(rawTitle);
  if (title === '') {
    throw new Error(`${input.sourcePath} resolves to an empty title`);
  }

  const description = typeof data.description === 'string' ? data.description : undefined;
  const links = rewriteMarkdownLinks(stripped.body, input.sourcePath, input.targets);

  const frontmatter = stringifyYaml({
    title,
    ...(description !== undefined ? { description } : {}),
    editUrl: input.editUrl,
  });
  const content = `---\n${frontmatter}---\n\n${links.text.replace(/\s*$/, '')}\n`;

  return {
    sourcePath: input.sourcePath,
    route: input.planned.route,
    title,
    content,
    warnings: links.warnings,
  };
}

/** Extracts the first ```text fenced block under the given heading, before the next H2. */
export function extractInstallPrompt(readme: string, heading: string): string {
  const lines = normalizeNewlines(readme).split('\n');
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start === -1) {
    throw new Error(`README has no "${heading}" section`);
  }

  let open = -1;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) {
      break;
    }
    if (/^```text\s*$/.test(lines[i])) {
      open = i;
      break;
    }
  }
  if (open === -1) {
    throw new Error(`"${heading}" section has no \`\`\`text block`);
  }

  const close = lines.findIndex((line, index) => index > open && /^```\s*$/.test(line));
  if (close === -1) {
    throw new Error(`"${heading}" text block is never closed`);
  }

  const prompt = lines.slice(open + 1, close).join('\n').trim();
  if (prompt === '') {
    throw new Error(`"${heading}" text block is empty`);
  }
  return `${prompt}\n`;
}

/**
 * Rewrites inline Markdown links and images. Fenced code blocks are copied verbatim and
 * inline code spans are skipped. Link labels may span lines, so each run of prose lines is
 * scanned as one block. Relative targets are resolved against the source file's directory.
 */
export function rewriteMarkdownLinks(
  markdown: string,
  sourcePath: string,
  targets: LinkTargets,
): { text: string; warnings: string[] } {
  const warnings: string[] = [];
  const out: string[] = [];
  let prose: string[] = [];
  let fence: { char: string; length: number } | null = null;

  const flushProse = (): void => {
    if (prose.length === 0) {
      return;
    }
    out.push(rewriteProse(prose.join('\n'), sourcePath, targets, warnings));
    prose = [];
  };

  for (const line of normalizeNewlines(markdown).split('\n')) {
    if (fence === null) {
      const opening = /^ {0,3}(`{3,}|~{3,})/.exec(line);
      if (opening) {
        flushProse();
        fence = { char: opening[1][0], length: opening[1].length };
        out.push(line);
      } else {
        prose.push(line);
      }
      continue;
    }

    out.push(line);
    const closing = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line);
    if (closing && closing[1][0] === fence.char && closing[1].length >= fence.length) {
      fence = null;
    }
  }
  flushProse();

  return { text: out.join('\n'), warnings };
}

function rewriteProse(
  text: string,
  sourcePath: string,
  targets: LinkTargets,
  warnings: string[],
): string {
  // A link is skipped only when it starts inside a code span. Code inside a link label is common
  // (`[`docs/x.md`](x.md)`), so code-span ranges must not be used to exclude the whole segment.
  const codeRanges = inlineCodeRanges(text);
  const insideCode = (offset: number): boolean =>
    codeRanges.some(([start, end]) => offset >= start && offset < end);

  return text.replace(
    LINK_PATTERN,
    (match: string, bang: string, label: string, target: string, title: string, offset: number) => {
      if (insideCode(offset)) {
        return match;
      }
      const result = rewriteTarget(target, bang === '!', sourcePath, targets);
      if (result.warning !== undefined) {
        warnings.push(`${sourcePath}: ${result.warning}`);
      }
      if (result.value === target) {
        return match;
      }
      return `${bang}[${label}](${result.value}${title})`;
    },
  );
}

// Inline link or image: `[label](target "optional title")`. Targets with spaces or unbalanced parentheses are not supported.
const LINK_PATTERN = /(!?)\[((?:[^[\]\\]|\\.|\[[^[\]]*\])*)\]\(<?([^\s)<>]*)>?((?:\s+(?:"[^"]*"|'[^']*'))?)\s*\)/g;

function rewriteTarget(
  target: string,
  isImage: boolean,
  sourcePath: string,
  targets: LinkTargets,
): { value: string; warning?: string } {
  if (target === '' || target.startsWith('#') || target.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(target)) {
    return { value: target };
  }

  const hashAt = target.indexOf('#');
  const pathPart = hashAt === -1 ? target : target.slice(0, hashAt);
  const anchor = hashAt === -1 ? '' : target.slice(hashAt);
  const repoPath = resolveRepoPath(sourcePath, pathPart);
  if (repoPath === null) {
    return { value: target, warning: `link escapes the repository root: ${target}` };
  }

  if (isImage) {
    return targets.files.has(repoPath)
      ? { value: targets.rawUrl(repoPath) }
      : { value: target, warning: `image not found at ref: ${target}` };
  }

  const route = targets.routes.get(repoPath);
  if (route !== undefined) {
    return { value: `${targets.routeUrl(route)}${anchor}` };
  }
  if (targets.files.has(repoPath)) {
    return { value: `${targets.blobUrl(repoPath)}${anchor}` };
  }
  if (targets.dirs.has(repoPath)) {
    return { value: `${targets.treeUrl(repoPath)}${anchor}` };
  }
  return { value: target, warning: `link target not found at ref: ${target}` };
}

/** Resolves a link path to a repository-relative path, or null when it points above the repository root. */
function resolveRepoPath(sourcePath: string, pathPart: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathPart);
  } catch {
    decoded = pathPart;
  }
  const withoutSlash = decoded.replace(/\/+$/, '');
  const joined = decoded.startsWith('/')
    ? withoutSlash.slice(1)
    : posix.join(posix.dirname(sourcePath), withoutSlash);
  const normalized = posix.normalize(joined === '' ? '.' : joined);
  if (normalized === '..' || normalized.startsWith('../') || normalized.startsWith('/')) {
    return null;
  }
  return normalized === '.' ? '' : normalized;
}

/** Returns [start, end) offsets of every inline code span, including its backtick delimiters. */
function inlineCodeRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] !== '`') {
      i++;
      continue;
    }
    const runLength = backtickRunLength(text, i);
    const closeAt = findClosingBacktickRun(text, i + runLength, runLength);
    if (closeAt === -1) {
      i += runLength;
      continue;
    }
    ranges.push([i, closeAt + runLength]);
    i = closeAt + runLength;
  }
  return ranges;
}

function backtickRunLength(text: string, start: number): number {
  let end = start;
  while (text[end] === '`') {
    end++;
  }
  return end - start;
}

function findClosingBacktickRun(text: string, from: number, length: number): number {
  let i = from;
  while (i < text.length) {
    if (text[i] !== '`') {
      i++;
      continue;
    }
    const run = backtickRunLength(text, i);
    if (run === length) {
      return i;
    }
    i += run;
  }
  return -1;
}

function routeFromBase(sourcePath: string, routeBase: string): string {
  const relative = sourcePath.slice(routeBase.length + 1);
  return relative.replace(/\.md$/, '');
}

function normalizeNewlines(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}
