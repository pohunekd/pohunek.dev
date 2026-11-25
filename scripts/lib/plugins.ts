/**
 * The official plugin index as the site renders it: parse the signed index v2 document, keep the
 * newest version of every package and turn each entry into a row of the /plugins/ page.
 *
 * The index is the list of packages `pohunek plugin install <id>` can install by id. Admission is a
 * pull request to `pohunekd/pohunek-plugin-index`; the site never decides what is installable, it
 * only renders the published document. The signed document carries no display name or prose, so the
 * short description and the human name of a plugin come from a presentation table in the site, with
 * a derived fallback so a newly admitted plugin still appears without a page edit.
 */

export type PluginKind = 'runtime' | 'context';

/** One entry of the signed index v2 document. */
export interface PluginIndexEntry {
  readonly packageId: string;
  readonly kind: PluginKind;
  readonly runtimeId: string | null;
  readonly version: string;
  readonly url: string;
  readonly platforms: readonly string[];
  readonly core: string;
}

/** The parts of the signed index document the page needs. */
export interface PluginIndex {
  readonly sequence: number;
  readonly expiresAt: number;
  readonly entries: readonly PluginIndexEntry[];
}

/** One row of the generated table. */
export interface PluginRow {
  readonly packageId: string;
  readonly kind: PluginKind;
  readonly runtimeId: string | null;
  readonly name: string;
  /** `official` is the only tier the index admits today. */
  readonly tier: 'official';
  readonly version: string;
  readonly description: string;
  /** Link to the plugin's repository, derived from the archive URL. */
  readonly repository: string;
  /** The repository as `owner/name`, for the link text. */
  readonly repositoryLabel: string;
  readonly archiveUrl: string;
  readonly platforms: readonly string[];
  readonly core: string;
}

/** The data the page imports; written by `scripts/sync-plugins.ts` into `src/data/generated/`. */
export interface PluginIndexView {
  /** The URL the document was fetched from, or the snapshot's source. */
  readonly source: string;
  /** Signing time of the index document, from its sequence. */
  readonly asOf: string;
  /** When the document was fetched; older than `asOf` is impossible, and the two differ for a snapshot. */
  readonly fetchedAt: string;
  /** True when the live index could not be read and the committed snapshot was rendered instead. */
  readonly stale: boolean;
  readonly sequence: number;
  readonly runtime: readonly PluginRow[];
  readonly context: readonly PluginRow[];
}

/** Display name and short description of one package, keyed by package id. */
export interface PluginPresentation {
  readonly name: string;
  readonly description: string;
}

/**
 * An official plugin repository whose package is not installable by id yet: the site's own list of
 * work in progress, which the page shows only while the index does not admit the package.
 */
export interface PendingPlugin {
  readonly packageId: string;
  readonly name: string;
  readonly runtime: string;
  readonly tier: PluginRow['tier'];
  readonly description: string;
  readonly repository: string;
  readonly repositoryLabel: string;
}

/**
 * Drops the pending rows the index already admits, in either kind, so an admission removes its row
 * from the "not admitted yet" table instead of showing the plugin twice. An empty result hides the
 * whole section.
 */
export function pendingNotAdmitted(
  pending: readonly PendingPlugin[],
  view: PluginIndexView,
): readonly PendingPlugin[] {
  const admitted = new Set([...view.runtime, ...view.context].map((row) => row.packageId));
  return pending.filter((row) => !admitted.has(row.packageId));
}

export type PluginPresentationMap = Readonly<Record<string, PluginPresentation>>;

/** A committed copy of the raw index document, used when the build cannot fetch the live index. */
export interface PluginSnapshot {
  readonly source: string;
  readonly fetchedAt: string;
  readonly document: unknown;
}

/** Protocol package-id ceiling, `MAX_PACKAGE_ID_BYTES`; the id is ASCII, so these are bytes. */
const MAX_PACKAGE_ID_BYTES = 128;

/** Protocol runtime-id ceiling, `MAX_AGENT_RUNTIME_ID_BYTES`. */
const MAX_RUNTIME_ID_BYTES = 64;

/** The protocol identifier alphabet shared by `PackageId` and `RuntimeId`. */
const IDENTIFIER = /^[a-z0-9._-]+$/;

/** A context package id is this prefix plus a non-empty tail. */
const CONTEXT_PREFIX = 'pohunek.context.';

/** An official runtime package id is this prefix plus its runtime id. */
const RUNTIME_PREFIX = 'pohunek.runtime.';

const VERSION = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

function objectAt(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${where} must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

function stringAt(value: unknown, field: string, where: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${where}: ${field} must be a non-empty string`);
  }
  return value;
}

/**
 * Validates an id with the protocol's `PackageId`/`RuntimeId` rules: lowercase ASCII letters,
 * digits, `.`, `_` and `-`; no leading `.` or `-`; no `..`; at most `max` bytes. Keeping this
 * identical to the core's `validate_identifier` means an admitted id never makes the page drop the
 * whole index.
 */
function identifierAt(value: unknown, field: string, where: string, max: number): string {
  const text = stringAt(value, field, where);
  if (!IDENTIFIER.test(text)) {
    throw new Error(`${where}: ${field} must be lowercase ASCII letters, digits, '.', '_' or '-': ${text}`);
  }
  if (text.length > max) {
    throw new Error(`${where}: ${field} is longer than ${max} bytes: ${text}`);
  }
  if (text.startsWith('.') || text.startsWith('-')) {
    throw new Error(`${where}: ${field} must not start with '.' or '-': ${text}`);
  }
  if (text.includes('..')) {
    throw new Error(`${where}: ${field} must not contain '..': ${text}`);
  }
  return text;
}

function integerAt(value: unknown, field: string, where: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${where}: ${field} must be a positive integer`);
  }
  return value;
}

function stringListAt(value: unknown, field: string, where: string): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${where}: ${field} must be a non-empty list`);
  }
  return value.map((item, index) => stringAt(item, `${field}[${index}]`, where));
}

function httpsUrlAt(value: unknown, field: string, where: string): string {
  const text = stringAt(value, field, where);
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new Error(`${where}: ${field} is not a URL: ${text}`);
  }
  if (url.protocol !== 'https:') {
    throw new Error(`${where}: ${field} must be an https URL, got ${text}`);
  }
  return text;
}

function parseEntry(value: unknown, where: string): PluginIndexEntry {
  const entry = objectAt(value, where);
  const packageId = identifierAt(entry.package_id, 'package_id', where, MAX_PACKAGE_ID_BYTES);
  const kind = stringAt(entry.kind, 'kind', where);
  if (kind !== 'runtime' && kind !== 'context') {
    throw new Error(`${where}: kind must be "runtime" or "context", got "${kind}"`);
  }
  if (kind === 'context') {
    if (!packageId.startsWith(CONTEXT_PREFIX) || packageId.length === CONTEXT_PREFIX.length) {
      throw new Error(`${where}: a context package_id is "${CONTEXT_PREFIX}" plus a tail: ${packageId}`);
    }
  } else if (packageId.startsWith(CONTEXT_PREFIX)) {
    throw new Error(`${where}: a runtime package_id must not start with "${CONTEXT_PREFIX}": ${packageId}`);
  }
  const version = stringAt(entry.version, 'version', where);
  if (!VERSION.test(version)) {
    throw new Error(`${where}: version is not a release version: ${version}`);
  }
  let runtimeId: string | null = null;
  if (kind === 'runtime') {
    const id = identifierAt(entry.runtime_id, 'runtime_id', where, MAX_RUNTIME_ID_BYTES);
    if (`${RUNTIME_PREFIX}${id}` !== packageId) {
      throw new Error(`${where}: runtime_id "${id}" does not match package_id ${packageId}`);
    }
    runtimeId = id;
  } else if (entry.runtime_id !== undefined) {
    throw new Error(`${where}: a context entry carries no runtime_id`);
  }
  return {
    packageId,
    kind,
    runtimeId,
    version,
    url: httpsUrlAt(entry.url, 'url', where),
    platforms: stringListAt(entry.platforms, 'platforms', where),
    core: stringAt(entry.core, 'core', where),
  };
}

/**
 * Parses a signed index v2 document. Only the fields the page renders are checked; the signature,
 * the digest and the install authorization stay the installer's concern.
 */
export function parsePluginIndex(document: unknown, where: string): PluginIndex {
  const root = objectAt(document, where);
  if (root.schema_version !== 2) {
    throw new Error(`${where}: schema_version must be 2`);
  }
  const index = objectAt(root.index, `${where}: index`);
  if (index.schema_version !== 2) {
    throw new Error(`${where}: index.schema_version must be 2`);
  }
  if (index.scope !== 'official') {
    throw new Error(`${where}: index.scope must be "official"`);
  }
  const sequence = integerAt(index.sequence, 'sequence', where);
  const expiresAt = integerAt(index.expires_at, 'expires_at', where);
  if (expiresAt <= sequence) {
    throw new Error(`${where}: expires_at must be after sequence`);
  }
  if (!Array.isArray(index.entries) || index.entries.length === 0) {
    throw new Error(`${where}: the index lists no entries; the page never renders an empty list silently`);
  }
  const entries = index.entries.map((entry, position) => parseEntry(entry, `${where}: entries[${position}]`));
  const seen = new Set<string>();
  for (const entry of entries) {
    const key = `${entry.packageId}@${entry.version}`;
    if (seen.has(key)) {
      throw new Error(`${where}: ${key} appears twice`);
    }
    seen.add(key);
  }
  return { sequence, expiresAt, entries };
}

/** Parses a committed snapshot around the raw index document. */
export function parsePluginSnapshot(raw: unknown, where: string): PluginSnapshot {
  const root = objectAt(raw, where);
  const source = httpsUrlAt(root.source, 'source', where);
  const fetchedAt = stringAt(root.fetched_at, 'fetched_at', where);
  if (!ISO_DATE.test(fetchedAt)) {
    throw new Error(`${where}: fetched_at must be an ISO 8601 UTC timestamp`);
  }
  parsePluginIndex(root.document, `${where}: document`);
  return { source, fetchedAt, document: root.document };
}

/** Orders two release versions; a pre-release sorts before the stable release of the same X.Y.Z. */
export function compareVersions(left: string, right: string): number {
  const split = (version: string): { numbers: number[]; pre: string | null } => {
    const [numbers, pre = null] = version.split('-', 2);
    return { numbers: numbers.split('.').map(Number), pre };
  };
  const a = split(left);
  const b = split(right);
  for (let i = 0; i < 3; i += 1) {
    if (a.numbers[i] !== b.numbers[i]) {
      return a.numbers[i] - b.numbers[i];
    }
  }
  if (a.pre === b.pre) {
    return 0;
  }
  if (a.pre === null) {
    return 1;
  }
  if (b.pre === null) {
    return -1;
  }
  return a.pre < b.pre ? -1 : 1;
}

/** The newest admitted version of every package, so the page lists one row per plugin. */
export function newestEntries(index: PluginIndex): PluginIndexEntry[] {
  const newest = new Map<string, PluginIndexEntry>();
  for (const entry of index.entries) {
    const current = newest.get(entry.packageId);
    if (current === undefined || compareVersions(entry.version, current.version) > 0) {
      newest.set(entry.packageId, entry);
    }
  }
  return [...newest.values()];
}

/** Derives the plugin repository from its release archive URL, when it points into GitHub. */
export function repositoryOfArchive(url: string): { url: string; label: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.hostname !== 'github.com') {
    return null;
  }
  const [owner, name] = parsed.pathname.split('/').filter((segment) => segment.length > 0);
  if (owner === undefined || name === undefined) {
    return null;
  }
  return { url: `https://github.com/${owner}/${name}`, label: `${owner}/${name}` };
}

function titleCase(slug: string): string {
  return slug
    .split('-')
    .filter((word) => word.length > 0)
    .map((word) => `${word[0].toUpperCase()}${word.slice(1)}`)
    .join(' ');
}

/** The name shown when the presentation table has no entry: `plugin-mistral-vibe` becomes "Mistral Vibe". */
export function derivedName(entry: PluginIndexEntry, repositoryLabel: string | null): string {
  const name = repositoryLabel?.split('/')[1];
  if (name !== undefined && name.startsWith('plugin-') && name.length > 'plugin-'.length) {
    return titleCase(name.slice('plugin-'.length));
  }
  const tail = entry.runtimeId ?? entry.packageId.split('.').pop() ?? entry.packageId;
  return titleCase(tail);
}

function derivedDescription(entry: PluginIndexEntry, name: string): string {
  return entry.kind === 'runtime'
    ? `Official runtime package for ${name}.`
    : `Official context package for ${name}.`;
}

function rowOf(entry: PluginIndexEntry, presentation: PluginPresentationMap): PluginRow {
  const repository = repositoryOfArchive(entry.url);
  const shown = presentation[entry.packageId];
  const name = shown?.name ?? derivedName(entry, repository?.label ?? null);
  return {
    packageId: entry.packageId,
    kind: entry.kind,
    runtimeId: entry.runtimeId,
    name,
    tier: 'official',
    version: entry.version,
    description: shown?.description ?? derivedDescription(entry, name),
    repository: repository?.url ?? entry.url,
    repositoryLabel: repository?.label ?? 'release archive',
    archiveUrl: entry.url,
    platforms: entry.platforms,
    core: entry.core,
  };
}

/** Builds the page view from a parsed index and the site's presentation table. */
export function buildPluginView(
  index: PluginIndex,
  options: {
    readonly source: string;
    readonly fetchedAt: string;
    readonly stale: boolean;
    readonly presentation: PluginPresentationMap;
  },
): PluginIndexView {
  const rows = newestEntries(index).map((entry) => rowOf(entry, options.presentation));
  const byName = (left: PluginRow, right: PluginRow): number => left.name.localeCompare(right.name, 'en');
  return {
    source: options.source,
    asOf: new Date(index.sequence * 1000).toISOString(),
    fetchedAt: options.fetchedAt,
    stale: options.stale,
    sequence: index.sequence,
    runtime: rows.filter((row) => row.kind === 'runtime').sort(byName),
    context: rows.filter((row) => row.kind === 'context').sort(byName),
  };
}

/** Renders the module at `src/data/generated/plugins.ts`; the page imports it at build time. */
export function renderPluginViewModule(view: PluginIndexView, typesImportPath: string): string {
  return [
    '// Generated by scripts/sync-plugins.ts from the signed official plugin index; do not edit.',
    `import type { PluginIndexView } from '${typesImportPath}';`,
    '',
    `export const pluginIndexView: PluginIndexView = ${JSON.stringify(view, null, 2)};`,
    '',
  ].join('\n');
}
