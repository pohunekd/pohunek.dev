/** A whitelist entry: either one explicit file with its route, or a glob whose route is derived from routeBase. */
export interface PageRule {
  readonly source: string;
  readonly route?: string;
  readonly routeBase?: string;
  readonly title?: string;
}

export interface DocsSyncConfig {
  readonly editBranch: string;
  readonly routePrefix: string;
  readonly contentRoot: string;
  readonly generatedDir: string;
  readonly cacheDir: string;
  readonly githubUrl: string;
  readonly rawUrl: string;
  readonly pages: readonly PageRule[];
  readonly installPrompt: {
    readonly readme: string;
    readonly heading: string;
    readonly output: string;
  };
}

type JsonObject = Record<string, unknown>;

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

function parsePageRule(raw: unknown, index: number): PageRule {
  const where = `docs-sync.config.json pages[${index}]`;
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

/** Validates docs-sync.config.json. Missing keys throw; no defaults are invented. */
export function parseDocsSyncConfig(raw: unknown): DocsSyncConfig {
  const where = 'docs-sync.config.json';
  const obj = asObject(raw, where);

  const pagesRaw = obj.pages;
  if (!Array.isArray(pagesRaw) || pagesRaw.length === 0) {
    throw new Error(`${where}.pages must be a non-empty array`);
  }

  const installRaw = asObject(obj.installPrompt, `${where}.installPrompt`);

  return {
    editBranch: requireString(obj, 'editBranch', where),
    routePrefix: requireString(obj, 'routePrefix', where),
    contentRoot: requireString(obj, 'contentRoot', where),
    generatedDir: requireString(obj, 'generatedDir', where),
    cacheDir: requireString(obj, 'cacheDir', where),
    githubUrl: requireString(obj, 'githubUrl', where),
    rawUrl: requireString(obj, 'rawUrl', where),
    pages: pagesRaw.map((rule, index) => parsePageRule(rule, index)),
    installPrompt: {
      readme: requireString(installRaw, 'readme', `${where}.installPrompt`),
      heading: requireString(installRaw, 'heading', `${where}.installPrompt`),
      output: requireString(installRaw, 'output', `${where}.installPrompt`),
    },
  };
}
