/** A whitelist entry: either one explicit file with its route, or a glob whose route is derived from routeBase. */
export interface PageRule {
  readonly source: string;
  readonly route?: string;
  readonly routeBase?: string;
  readonly title?: string;
}

export interface InstallPromptConfig {
  readonly readme: string;
  readonly heading: string;
  readonly output: string;
}

/** The docs of one product; its repository and pinned tag come from the product of the same id in releases.config.json. */
export interface ProductDocs {
  readonly product: string;
  /** One path segment: the pages render into `<contentRoot>/<routePrefix>/` and are served under `/<routePrefix>/`. */
  readonly routePrefix: string;
  readonly editBranch: string;
  readonly pages: readonly PageRule[];
  readonly installPrompt?: InstallPromptConfig;
}

export interface DocsSyncConfig {
  readonly contentRoot: string;
  readonly generatedDir: string;
  readonly cacheDir: string;
  readonly githubUrl: string;
  readonly rawUrl: string;
  readonly sources: readonly ProductDocs[];
}

type JsonObject = Record<string, unknown>;

const ROUTE_PREFIX_PATTERN = /^[a-z][a-z0-9-]*$/;

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

function optionalString(obj: JsonObject, key: string, where: string): string | undefined {
  const value = obj[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new Error(`${where}.${key} must be a string when present`);
  }
  return value;
}

function parsePageRule(raw: unknown, where: string): PageRule {
  const obj = asObject(raw, where);
  const source = requireString(obj, 'source', where);
  const route = optionalString(obj, 'route', where);
  const routeBase = optionalString(obj, 'routeBase', where);
  const title = optionalString(obj, 'title', where);

  if ((route === undefined) === (routeBase === undefined)) {
    throw new Error(`${where} must set exactly one of "route" or "routeBase"`);
  }
  if (route !== undefined && /[*?[]/.test(source)) {
    throw new Error(`${where} sets "route" but its source is a glob; use "routeBase" for globs`);
  }
  if (routeBase !== undefined && !/[*?[]/.test(source)) {
    throw new Error(`${where} sets "routeBase" but its source is not a glob`);
  }
  if (routeBase !== undefined && !source.startsWith(`${routeBase}/`)) {
    throw new Error(`${where} source must live under routeBase "${routeBase}"`);
  }
  if (title !== undefined && title.length === 0) {
    throw new Error(`${where}.title must not be empty when present`);
  }

  return { source, route, routeBase, title };
}

function parseInstallPrompt(raw: unknown, where: string): InstallPromptConfig {
  const obj = asObject(raw, where);
  return {
    readme: requireString(obj, 'readme', where),
    heading: requireString(obj, 'heading', where),
    output: requireString(obj, 'output', where),
  };
}

function parseProductDocs(raw: unknown, index: number, productIds: ReadonlySet<string>): ProductDocs {
  const where = `docs-sync.config.json sources[${index}]`;
  const obj = asObject(raw, where);
  const product = requireString(obj, 'product', where);
  if (!productIds.has(product)) {
    throw new Error(`${where}.product "${product}" is not a product of releases.config.json`);
  }
  const routePrefix = requireString(obj, 'routePrefix', where);
  if (!ROUTE_PREFIX_PATTERN.test(routePrefix)) {
    throw new Error(`${where}.routePrefix must be one path segment matching ${ROUTE_PREFIX_PATTERN}, got "${routePrefix}"`);
  }
  const pagesRaw = obj.pages;
  if (!Array.isArray(pagesRaw) || pagesRaw.length === 0) {
    throw new Error(`${where}.pages must be a non-empty array`);
  }
  return {
    product,
    routePrefix,
    editBranch: requireString(obj, 'editBranch', where),
    pages: pagesRaw.map((rule, ruleIndex) => parsePageRule(rule, `${where}.pages[${ruleIndex}]`)),
    installPrompt:
      obj.installPrompt === undefined ? undefined : parseInstallPrompt(obj.installPrompt, `${where}.installPrompt`),
  };
}

function requireUnique(values: readonly string[], message: (value: string) => string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      throw new Error(message(value));
    }
    seen.add(value);
  }
}

/**
 * Validates docs-sync.config.json against the product ids of releases.config.json. Missing keys throw;
 * no defaults are invented.
 */
export function parseDocsSyncConfig(raw: unknown, productIds: readonly string[]): DocsSyncConfig {
  const where = 'docs-sync.config.json';
  const obj = asObject(raw, where);

  const sourcesRaw = obj.sources;
  if (!Array.isArray(sourcesRaw) || sourcesRaw.length === 0) {
    throw new Error(`${where}.sources must be a non-empty array`);
  }
  const known = new Set(productIds);
  const sources = sourcesRaw.map((source, index) => parseProductDocs(source, index, known));

  // Distinct one-segment prefixes keep every product's output directory apart, so syncing one never touches another.
  requireUnique(
    sources.map((source) => source.product),
    (product) => `${where} lists product "${product}" twice`,
  );
  requireUnique(
    sources.map((source) => source.routePrefix),
    (prefix) => `${where}: two sources use routePrefix "${prefix}"`,
  );
  requireUnique(
    sources.flatMap((source) => (source.installPrompt === undefined ? [] : [source.installPrompt.output])),
    (output) => `${where}: two sources write the install prompt "${output}"`,
  );

  return {
    contentRoot: requireString(obj, 'contentRoot', where),
    generatedDir: requireString(obj, 'generatedDir', where),
    cacheDir: requireString(obj, 'cacheDir', where),
    githubUrl: requireString(obj, 'githubUrl', where),
    rawUrl: requireString(obj, 'rawUrl', where),
    sources,
  };
}
