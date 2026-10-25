/** The subset of a GitHub release this site reads. */
export interface GithubRelease {
  readonly tagName: string;
  readonly draft: boolean;
  readonly prerelease: boolean;
  readonly publishedAt: string;
  readonly htmlUrl: string;
  readonly body: string;
  readonly assets: readonly GithubAsset[];
}

export interface GithubAsset {
  readonly name: string;
  readonly downloadUrl: string;
  /** `sha256:<hex>` when GitHub recorded one. */
  readonly digest?: string;
}

export interface GithubCommit {
  readonly sha: string;
  readonly message: string;
}

export interface GithubPull {
  readonly number: number;
  readonly title: string;
  readonly mergeCommitSha?: string;
  readonly merged: boolean;
}

export class GithubError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GithubError';
  }
}

type JsonObject = Record<string, unknown>;

const PAGE_SIZE = 100;

function field<T>(obj: JsonObject, key: string, type: 'string' | 'boolean' | 'number', where: string): T {
  const value = obj[key];
  if (typeof value !== type) {
    throw new GithubError(`${where}: field "${key}" is not a ${type}`);
  }
  return value as T;
}

/** Minimal read-only REST client. Responses are untrusted data and are shape-checked before use. */
export class GithubClient {
  constructor(
    private readonly apiUrl: string,
    private readonly token: string,
  ) {}

  private request(path: string): Promise<Response> {
    return fetch(`${this.apiUrl}${path}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${this.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
  }

  private async getJson(path: string): Promise<unknown> {
    const response = await this.request(path);
    if (!response.ok) {
      throw new GithubError(`GET ${path} answered ${response.status} ${response.statusText}`);
    }
    return response.json();
  }

  private async getPages(path: string, pick: (page: unknown) => unknown[]): Promise<unknown[]> {
    const items: unknown[] = [];
    const separator = path.includes('?') ? '&' : '?';
    for (let page = 1; ; page += 1) {
      const batch = pick(await this.getJson(`${path}${separator}per_page=${PAGE_SIZE}&page=${page}`));
      items.push(...batch);
      if (batch.length < PAGE_SIZE) {
        return items;
      }
    }
  }

  async listReleases(repository: string): Promise<GithubRelease[]> {
    const where = `releases of ${repository}`;
    const raw = await this.getPages(`/repos/${repository}/releases`, (page) => {
      if (!Array.isArray(page)) {
        throw new GithubError(`${where}: response is not a list`);
      }
      return page;
    });
    return raw.map((item) => {
      const obj = item as JsonObject;
      const tagName = field<string>(obj, 'tag_name', 'string', where);
      const draft = field<boolean>(obj, 'draft', 'boolean', where);
      const assetsRaw = obj.assets;
      if (!Array.isArray(assetsRaw)) {
        throw new GithubError(`${where}: ${tagName} has no asset list`);
      }
      return {
        tagName,
        draft,
        prerelease: field<boolean>(obj, 'prerelease', 'boolean', where),
        // A draft has no publication time; drafts are never used.
        publishedAt: draft ? '' : field<string>(obj, 'published_at', 'string', where),
        htmlUrl: field<string>(obj, 'html_url', 'string', where),
        body: typeof obj.body === 'string' ? obj.body : '',
        assets: assetsRaw.map((asset: JsonObject) => ({
          name: field<string>(asset, 'name', 'string', where),
          downloadUrl: field<string>(asset, 'browser_download_url', 'string', where),
          digest: typeof asset.digest === 'string' ? asset.digest : undefined,
        })),
      };
    });
  }

  /** Commits reachable from `head` but not from `base`. */
  async compareCommits(repository: string, base: string, head: string): Promise<GithubCommit[]> {
    const where = `compare ${base}...${head} of ${repository}`;
    const path = `/repos/${repository}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`;
    const raw = await this.getPages(path, (page) => {
      const commits = (page as JsonObject).commits;
      if (!Array.isArray(commits)) {
        throw new GithubError(`${where}: response has no commit list`);
      }
      return commits;
    });
    return raw.map((item) => {
      const obj = item as JsonObject;
      const commit = obj.commit as JsonObject;
      return {
        sha: field<string>(obj, 'sha', 'string', where),
        message: field<string>(commit, 'message', 'string', where),
      };
    });
  }

  /** The pull request with this number, or undefined when the number is an issue. */
  async getPull(repository: string, number: number): Promise<GithubPull | undefined> {
    const where = `pull ${number} of ${repository}`;
    const response = await this.request(`/repos/${repository}/pulls/${number}`);
    if (response.status === 404) {
      return undefined;
    }
    if (!response.ok) {
      throw new GithubError(`GET ${where} answered ${response.status} ${response.statusText}`);
    }
    const obj = (await response.json()) as JsonObject;
    return {
      number: field<number>(obj, 'number', 'number', where),
      title: field<string>(obj, 'title', 'string', where),
      mergeCommitSha: typeof obj.merge_commit_sha === 'string' ? obj.merge_commit_sha : undefined,
      merged: typeof obj.merged_at === 'string',
    };
  }

  /** Downloads a public release asset; the token is not sent to the storage host it redirects to. */
  async downloadAsset(asset: GithubAsset): Promise<Uint8Array> {
    const response = await fetch(asset.downloadUrl);
    if (!response.ok) {
      throw new GithubError(`download of ${asset.name} answered ${response.status} ${response.statusText}`);
    }
    return new Uint8Array(await response.arrayBuffer());
  }
}
