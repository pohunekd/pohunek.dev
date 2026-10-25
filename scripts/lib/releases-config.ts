/** One released product of the ecosystem and the version this site pins. */
export interface Product {
  readonly id: string;
  readonly name: string;
  readonly repository: string;
  /** Prefix of the product's tags, for example `v` or `plugin-v`. */
  readonly tagPrefix: string;
  readonly version: string;
  /** Whether a pre-release (`X.Y.Z-pre.N`) may be pinned. */
  readonly prerelease: boolean;
  /** Whether every asset carries a GitHub build-provenance attestation. */
  readonly attested: boolean;
  /** Asset names with a `{version}` placeholder. */
  readonly assets: readonly string[];
  /** Path of the screenshot manifest inside the product repository, when the site renders its screenshots. */
  readonly screenshotManifest?: string;
}

export interface ReleasesConfig {
  readonly apiUrl: string;
  /** Directory of the committed changelog data, one `<product id>.json` per product. */
  readonly changelogDir: string;
  readonly products: readonly Product[];
}

/** Parsed `X.Y.Z` or `X.Y.Z-pre.N`; `pre` is undefined for a stable release. */
export interface Version {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly pre?: number;
}

type JsonObject = Record<string, unknown>;

const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const ID_PATTERN = /^[a-z][a-z0-9-]*$/;
const TAG_PREFIX_PATTERN = /^([a-z][a-z0-9]*-)?v$/;
const NUMBER = '(0|[1-9][0-9]*)';
const VERSION_PATTERN = new RegExp(`^${NUMBER}\\.${NUMBER}\\.${NUMBER}(?:-pre\\.${NUMBER})?$`);
const ASSET_PATTERN = /^[A-Za-z0-9._{}-]+$/;
const VERSION_PLACEHOLDER = '{version}';

export function parseVersion(text: string): Version {
  const match = VERSION_PATTERN.exec(text);
  if (match === null) {
    throw new Error(`version must look like X.Y.Z or X.Y.Z-pre.N, got "${text}"`);
  }
  const [, major, minor, patch, pre] = match;
  return {
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
    pre: pre === undefined ? undefined : Number(pre),
  };
}

/** Orders versions; a pre-release sorts before the stable release of the same X.Y.Z. */
export function compareVersions(left: string, right: string): number {
  const a = parseVersion(left);
  const b = parseVersion(right);
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (a[key] !== b[key]) {
      return a[key] - b[key];
    }
  }
  if (a.pre === b.pre) {
    return 0;
  }
  if (a.pre === undefined) {
    return 1;
  }
  if (b.pre === undefined) {
    return -1;
  }
  return a.pre - b.pre;
}

export function isPrerelease(version: string): boolean {
  return parseVersion(version).pre !== undefined;
}

export function tagOf(product: Product, version: string = product.version): string {
  return `${product.tagPrefix}${version}`;
}

/**
 * The version a tag names for this product, or undefined when the tag belongs to another product
 * or is not a release tag. A pre-release counts only for a product that follows pre-releases.
 */
export function versionOfTag(product: Product, tag: string): string | undefined {
  if (!tag.startsWith(product.tagPrefix)) {
    return undefined;
  }
  const version = tag.slice(product.tagPrefix.length);
  if (!VERSION_PATTERN.test(version)) {
    return undefined;
  }
  if (isPrerelease(version) && !product.prerelease) {
    return undefined;
  }
  return version;
}

export function assetNames(product: Product, version: string = product.version): string[] {
  return product.assets.map((asset) => asset.replaceAll(VERSION_PLACEHOLDER, version));
}

export function findProduct(config: ReleasesConfig, id: string): Product {
  const product = config.products.find((candidate) => candidate.id === id);
  if (product === undefined) {
    throw new Error(`releases.config.json has no product "${id}"`);
  }
  return product;
}

function asObject(value: unknown, where: string): JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${where} must be a JSON object`);
  }
  return value as JsonObject;
}

function requireString(obj: JsonObject, key: string, where: string): string {
  const value = obj[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${where}.${key} must be a non-empty string`);
  }
  return value;
}

function requireBoolean(obj: JsonObject, key: string, where: string): boolean {
  const value = obj[key];
  if (typeof value !== 'boolean') {
    throw new Error(`${where}.${key} must be true or false`);
  }
  return value;
}

function parseProduct(raw: unknown, index: number): Product {
  const where = `releases.config.json products[${index}]`;
  const obj = asObject(raw, where);
  const known = new Set([
    'id',
    'name',
    'repository',
    'tagPrefix',
    'version',
    'prerelease',
    'attested',
    'assets',
    'screenshotManifest',
  ]);
  for (const key of Object.keys(obj)) {
    if (!known.has(key)) {
      throw new Error(`${where} has unknown key "${key}"`);
    }
  }

  const id = requireString(obj, 'id', where);
  if (!ID_PATTERN.test(id)) {
    throw new Error(`${where}.id must match ${ID_PATTERN}, got "${id}"`);
  }
  const repository = requireString(obj, 'repository', where);
  if (!REPOSITORY_PATTERN.test(repository)) {
    throw new Error(`${where}.repository must look like "owner/name", got "${repository}"`);
  }
  const tagPrefix = requireString(obj, 'tagPrefix', where);
  if (!TAG_PREFIX_PATTERN.test(tagPrefix)) {
    throw new Error(`${where}.tagPrefix must be "v" or "<name>-v", got "${tagPrefix}"`);
  }
  const prerelease = requireBoolean(obj, 'prerelease', where);
  const version = requireString(obj, 'version', where);
  parseVersion(version);
  if (isPrerelease(version) && !prerelease) {
    throw new Error(`${where}.version ${version} is a pre-release but prerelease is false`);
  }

  const assetsRaw = obj.assets;
  if (!Array.isArray(assetsRaw) || assetsRaw.length === 0) {
    throw new Error(`${where}.assets must be a non-empty array`);
  }
  const assets = assetsRaw.map((asset, assetIndex) => {
    if (typeof asset !== 'string' || !ASSET_PATTERN.test(asset) || !asset.includes(VERSION_PLACEHOLDER)) {
      throw new Error(`${where}.assets[${assetIndex}] must be a file name containing ${VERSION_PLACEHOLDER}`);
    }
    return asset;
  });

  const screenshotManifest = obj.screenshotManifest;
  if (screenshotManifest !== undefined && (typeof screenshotManifest !== 'string' || screenshotManifest.length === 0)) {
    throw new Error(`${where}.screenshotManifest must be a non-empty string when present`);
  }

  return {
    id,
    name: requireString(obj, 'name', where),
    repository,
    tagPrefix,
    version,
    prerelease,
    attested: requireBoolean(obj, 'attested', where),
    assets,
    screenshotManifest,
  };
}

/** Validates releases.config.json. Missing keys throw; no defaults are invented. */
export function parseReleasesConfig(raw: unknown): ReleasesConfig {
  const where = 'releases.config.json';
  const obj = asObject(raw, where);
  const apiUrl = requireString(obj, 'apiUrl', where);
  if (!apiUrl.startsWith('https://') || apiUrl.endsWith('/')) {
    throw new Error(`${where}.apiUrl must be an https URL without a trailing slash`);
  }
  const productsRaw = obj.products;
  if (!Array.isArray(productsRaw) || productsRaw.length === 0) {
    throw new Error(`${where}.products must be a non-empty array`);
  }
  const products = productsRaw.map((product, index) => parseProduct(product, index));

  const ids = new Set<string>();
  const tagSpaces = new Set<string>();
  for (const product of products) {
    if (ids.has(product.id)) {
      throw new Error(`${where} lists product "${product.id}" twice`);
    }
    ids.add(product.id);
    // Two products of one repository with one prefix would claim the same tags.
    const space = `${product.repository} ${product.tagPrefix}`;
    if (tagSpaces.has(space)) {
      throw new Error(`${where}: two products use tag prefix "${product.tagPrefix}" in ${product.repository}`);
    }
    tagSpaces.add(space);
  }
  return { apiUrl, changelogDir: requireString(obj, 'changelogDir', where), products };
}

/** The config file content with one product's version replaced, keeping key order and the 2-space layout. */
export function renderWithVersion(raw: JsonObject, id: string, version: string): string {
  const products = raw.products;
  if (!Array.isArray(products)) {
    throw new Error('releases.config.json.products must be an array');
  }
  let found = false;
  const updated = products.map((product: JsonObject) => {
    if (product.id !== id) {
      return product;
    }
    found = true;
    return { ...product, version };
  });
  if (!found) {
    throw new Error(`releases.config.json has no product "${id}"`);
  }
  return `${JSON.stringify({ ...raw, products: updated }, null, 2)}\n`;
}
