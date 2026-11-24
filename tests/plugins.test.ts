import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import {
  buildPluginView,
  compareVersions,
  derivedName,
  newestEntries,
  parsePluginIndex,
  parsePluginSnapshot,
  pendingNotAdmitted,
  renderPluginViewModule,
  repositoryOfArchive,
  type PendingPlugin,
  type PluginIndexEntry,
} from '../scripts/lib/plugins.ts';
import { pluginPresentation } from '../scripts/lib/plugin-presentation.ts';
import { syncPlugins } from '../scripts/lib/plugins-sync.ts';

const SEQUENCE = 1795521773;
const WHERE = 'fixture index';

function entry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    package_id: 'pohunek.runtime.vibe',
    kind: 'runtime',
    runtime_id: 'vibe',
    version: '0.1.0',
    digest: `sha256:${'a'.repeat(64)}`,
    url: 'https://github.com/pohunekd/plugin-mistral-vibe/releases/download/v0.1.0/pohunek.runtime.vibe-0.1.0.tar.zst',
    platforms: ['x86_64-unknown-linux-gnu', 'aarch64-apple-darwin'],
    core: '>=0.44.0',
    ...overrides,
  };
}

const contextEntry = entry({
  package_id: 'pohunek.context.assistant',
  kind: 'context',
  runtime_id: undefined,
  version: '0.44.1',
  url: 'https://github.com/pohunekd/plugin-assistant/releases/download/v0.44.1/pohunek.context.assistant-0.44.1.tar.zst',
  core: '>=0.44.0, <0.45.0',
});

const agyEntry = entry({
  package_id: 'pohunek.runtime.agy',
  runtime_id: 'agy',
  url: 'https://github.com/pohunekd/plugin-antigravity/releases/download/v0.1.0/pohunek.runtime.agy-0.1.0.tar.zst',
});

const museOlder = entry({
  package_id: 'pohunek.runtime.muse',
  runtime_id: 'muse',
  version: '0.1.0',
  url: 'https://github.com/pohunekd/plugin-muse-code/releases/download/v0.1.0/pohunek.runtime.muse-0.1.0.tar.zst',
  core: '>=0.40.0',
});

const museNewer = entry({
  package_id: 'pohunek.runtime.muse',
  runtime_id: 'muse',
  version: '0.2.0',
  url: 'https://github.com/pohunekd/plugin-muse-code/releases/download/v0.2.0/pohunek.runtime.muse-0.2.0.tar.zst',
  core: '>=0.41.0',
});

function indexDocument(entries: unknown[] = [entry(), contextEntry, agyEntry, museOlder, museNewer]): unknown {
  return {
    schema_version: 2,
    index: {
      schema_version: 2,
      scope: 'official',
      sequence: SEQUENCE,
      expires_at: SEQUENCE + 14 * 24 * 60 * 60,
      entries,
    },
    key_records: [],
    signatures: [],
  };
}

function viewOf(document: unknown = indexDocument(), stale = false) {
  return buildPluginView(parsePluginIndex(document, WHERE), {
    source: 'https://example.test/official-index-v2.json',
    fetchedAt: '2026-11-24T13:00:00.000Z',
    stale,
    presentation: pluginPresentation,
  });
}

const tempRoots: string[] = [];

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'plugins-test-'));
  tempRoots.push(root);
  return root;
}

afterEach(async () => {
  while (tempRoots.length > 0) {
    await rm(tempRoots.pop() as string, { recursive: true, force: true });
  }
});

describe('parsePluginIndex', () => {
  test('accepts the fixture and keeps every admitted version', () => {
    const index = parsePluginIndex(indexDocument(), WHERE);
    expect(index.sequence).toBe(SEQUENCE);
    expect(index.entries).toHaveLength(5);
    expect(index.entries.map((candidate) => candidate.packageId)).toContain('pohunek.runtime.agy');
  });

  test('rejects another schema version', () => {
    const document = indexDocument() as { schema_version: number };
    document.schema_version = 1;
    expect(() => parsePluginIndex(document, WHERE)).toThrow('schema_version must be 2');
  });

  test('rejects an empty index instead of rendering an empty list', () => {
    expect(() => parsePluginIndex(indexDocument([]), WHERE)).toThrow('the index lists no entries');
  });

  test('rejects a duplicate package version', () => {
    expect(() => parsePluginIndex(indexDocument([entry(), entry()]), WHERE)).toThrow('appears twice');
  });

  test('rejects a kind that does not match the package id', () => {
    expect(() => parsePluginIndex(indexDocument([entry({ kind: 'context' })]), WHERE)).toThrow(
      'does not match kind "context"',
    );
  });

  test('rejects a runtime id that does not match the package id', () => {
    expect(() => parsePluginIndex(indexDocument([entry({ runtime_id: 'cline' })]), WHERE)).toThrow(
      'does not match package_id',
    );
  });

  test('rejects a context entry that carries a runtime id', () => {
    expect(() => parsePluginIndex(indexDocument([entry({ package_id: 'pohunek.context.assistant', kind: 'context', runtime_id: 'assistant' })]), WHERE)).toThrow(
      'a context entry carries no runtime_id',
    );
  });

  test('rejects an archive URL that is not https', () => {
    expect(() => parsePluginIndex(indexDocument([entry({ url: 'http://example.test/x.tar.zst' })]), WHERE)).toThrow(
      'must be an https URL',
    );
  });
});

describe('the rendered rows', () => {
  test('renders the newest version of every package with its name, runtime, tier, description and link', () => {
    const view = viewOf();
    expect(view.stale).toBe(false);
    expect(view.asOf).toBe('2026-11-24T12:02:53.000Z');
    expect(view.runtime.map((row) => row.name)).toEqual(['Antigravity', 'Mistral Vibe', 'Muse Code']);
    expect(view.context.map((row) => row.name)).toEqual(['Assistant knowledge']);

    const vibe = view.runtime.find((row) => row.packageId === 'pohunek.runtime.vibe');
    expect(vibe).toMatchObject({
      runtimeId: 'vibe',
      version: '0.1.0',
      tier: 'official',
      description: "Mistral's Vibe terminal coding agent.",
      repository: 'https://github.com/pohunekd/plugin-mistral-vibe',
      repositoryLabel: 'pohunekd/plugin-mistral-vibe',
    });
    expect(view.runtime.find((row) => row.packageId === 'pohunek.runtime.muse')?.version).toBe('0.2.0');
    expect(view.context[0]).toMatchObject({
      packageId: 'pohunek.context.assistant',
      runtimeId: null,
      repository: 'https://github.com/pohunekd/plugin-assistant',
    });
  });

  test('keeps a new admission without a presentation entry', () => {
    const view = viewOf(
      indexDocument([
        entry({
          package_id: 'pohunek.runtime.some-agent',
          runtime_id: 'some-agent',
          url: 'https://github.com/pohunekd/plugin-some-agent/releases/download/v0.1.0/pohunek.runtime.some-agent-0.1.0.tar.zst',
        }),
      ]),
    );
    // The plugin repository names the plugin, so an admission the site has never seen renders.
    expect(view.runtime[0]).toMatchObject({
      name: 'Some Agent',
      description: 'Official runtime package for Some Agent.',
      repository: 'https://github.com/pohunekd/plugin-some-agent',
    });
  });

  test('derives a name and a description when the repository is unknown', () => {
    const newEntry: PluginIndexEntry = {
      packageId: 'pohunek.runtime.muse-code',
      kind: 'runtime',
      runtimeId: 'muse-code',
      version: '1.0.0',
      url: 'https://example.test/muse-code-1.0.0.tar.zst',
      platforms: ['x86_64-unknown-linux-gnu'],
      core: '>=0.44.0',
    };
    expect(derivedName(newEntry, null)).toBe('Muse Code');
    const view = buildPluginView(
      parsePluginIndex(indexDocument([entry({ package_id: 'pohunek.runtime.agy', runtime_id: 'agy' })]), WHERE),
      {
        source: 'https://example.test/index.json',
        fetchedAt: '2026-11-24T13:00:00.000Z',
        stale: false,
        presentation: {},
      },
    );
    expect(view.runtime[0]).toMatchObject({
      name: 'Mistral Vibe',
      description: 'Official runtime package for Mistral Vibe.',
      repository: 'https://github.com/pohunekd/plugin-mistral-vibe',
    });
  });

  test('falls back to the archive when the URL names no GitHub repository', () => {
    const view = viewOf(indexDocument([entry({ url: 'https://example.test/archive.tar.zst' })]));
    expect(view.runtime[0].repository).toBe('https://example.test/archive.tar.zst');
    expect(view.runtime[0].repositoryLabel).toBe('release archive');
  });

  test('the stale view keeps the snapshot dates and the flag', () => {
    const view = viewOf(indexDocument(), true);
    expect(view.stale).toBe(true);
    expect(view.asOf).toBe('2026-11-24T12:02:53.000Z');
  });
});

const clineRow: PendingPlugin = {
  packageId: 'pohunek.runtime.cline',
  name: 'Cline',
  runtime: 'cline',
  tier: 'official',
  description: 'Cline CLI. Not admitted to the index yet.',
  repository: 'https://github.com/pohunekd/plugin-cline',
  repositoryLabel: 'pohunekd/plugin-cline',
};

const clineEntry = entry({
  package_id: 'pohunek.runtime.cline',
  runtime_id: 'cline',
  url: 'https://github.com/pohunekd/plugin-cline/releases/download/v0.1.0/pohunek.runtime.cline-0.1.0.tar.zst',
});

describe('pending rows against the index', () => {
  test('keeps a pending row the index does not admit', () => {
    expect(pendingNotAdmitted([clineRow], viewOf())).toEqual([clineRow]);
  });

  test('drops a pending row once the runtime package is admitted', () => {
    const view = viewOf(indexDocument([entry(), contextEntry, agyEntry, museNewer, clineEntry]));
    // The index row is the only Cline row; the pending table must not repeat it.
    expect(view.runtime.map((row) => row.name)).toContain('Cline');
    expect(pendingNotAdmitted([clineRow], view)).toEqual([]);
  });

  test('drops a pending row whose package id matches a context entry', () => {
    const contextPending: PendingPlugin = { ...clineRow, packageId: 'pohunek.context.assistant' };
    expect(pendingNotAdmitted([contextPending], viewOf())).toEqual([]);
  });

  test('leaves an empty list when every pending row is admitted, so the page hides the section', () => {
    const view = viewOf(indexDocument([entry(), contextEntry, agyEntry, museNewer, clineEntry]));
    expect(pendingNotAdmitted([clineRow], view)).toHaveLength(0);
  });
});

describe('ordering and repository derivation', () => {
  test('orders release versions and lets a stable release win over its pre-release', () => {
    expect(compareVersions('0.2.0', '0.10.0')).toBeLessThan(0);
    expect(compareVersions('1.0.0', '1.0.0-pre.1')).toBeGreaterThan(0);
  });

  test('keeps one row per package id', () => {
    const newest = newestEntries(parsePluginIndex(indexDocument(), WHERE));
    expect(newest.filter((candidate) => candidate.packageId === 'pohunek.runtime.muse')).toHaveLength(1);
  });

  test('derives owner and repository from a release asset URL', () => {
    expect(repositoryOfArchive(agyEntry.url as string)).toEqual({
      url: 'https://github.com/pohunekd/plugin-antigravity',
      label: 'pohunekd/plugin-antigravity',
    });
    expect(repositoryOfArchive('https://example.test/x.tar.zst')).toBeNull();
  });
});

describe('the sync', () => {
  test('renders a fixture index into the module', async () => {
    const root = await tempRoot();
    const indexFile = join(root, 'index.json');
    const modulePath = join(root, 'generated', 'plugins.ts');
    await writeFile(indexFile, JSON.stringify(indexDocument()), 'utf8');

    const result = await syncPlugins({
      root,
      indexFile,
      modulePath,
      presentation: pluginPresentation,
      now: () => new Date('2026-11-24T13:00:00.000Z'),
    });

    expect(result.view.stale).toBe(false);
    expect(result.view.runtime.map((row) => row.name)).toEqual(['Antigravity', 'Mistral Vibe', 'Muse Code']);
    const module = await readFile(modulePath, 'utf8');
    expect(module).toContain('export const pluginIndexView: PluginIndexView');
    expect(module).toContain('import type { PluginIndexView } from');
    expect(module).toContain('"name": "Mistral Vibe"');
    expect(module).toContain('"name": "Antigravity"');
    expect(module).toContain('"packageId": "pohunek.runtime.muse"');
    expect(module).toContain('"version": "0.2.0"');
    expect(module).not.toContain('pohunek.runtime.muse-0.1.0');
  });

  test('falls back to the committed snapshot when the fetch fails', async () => {
    const root = await tempRoot();
    const snapshotPath = join(root, 'plugins.snapshot.json');
    const modulePath = join(root, 'generated', 'plugins.ts');
    await writeFile(
      snapshotPath,
      JSON.stringify({
        source: 'https://example.test/official-index-v2.json',
        fetched_at: '2026-11-20T08:00:00.000Z',
        document: indexDocument(),
      }),
      'utf8',
    );

    const result = await syncPlugins({
      root,
      snapshotPath,
      modulePath,
      presentation: pluginPresentation,
      fetchImpl: (async () => {
        throw new Error('offline');
      }) as unknown as typeof fetch,
    });

    expect(result.snapshotWritten).toBe(false);
    expect(result.fallbackReason).toContain('cannot fetch');
    expect(result.view.stale).toBe(true);
    expect(result.view.fetchedAt).toBe('2026-11-20T08:00:00.000Z');
    expect(result.view.asOf).toBe('2026-11-24T12:02:53.000Z');
    const module = await readFile(modulePath, 'utf8');
    expect(module).toContain('"stale": true');
    expect(module).toContain('"fetchedAt": "2026-11-20T08:00:00.000Z"');
  });

  test('fails loudly when the fetch fails and no snapshot exists', async () => {
    const root = await tempRoot();
    await expect(
      syncPlugins({
        root,
        modulePath: join(root, 'generated', 'plugins.ts'),
        snapshotPath: join(root, 'missing.snapshot.json'),
        presentation: pluginPresentation,
        fetchImpl: (async () => new Response('nope', { status: 500 })) as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/HTTP 500.*fallback snapshot is unusable/);
  });

  test('refuses a document that is not the index', async () => {
    const root = await tempRoot();
    const indexFile = join(root, 'index.json');
    await writeFile(indexFile, JSON.stringify({ schema_version: 1 }), 'utf8');
    await expect(
      syncPlugins({ root, indexFile, modulePath: join(root, 'plugins.ts'), presentation: pluginPresentation }),
    ).rejects.toThrow('schema_version must be 2');
  });

  test('writes a valid snapshot on a successful fetch only when asked to', async () => {
    const root = await tempRoot();
    const snapshotPath = join(root, 'plugins.snapshot.json');
    const modulePath = join(root, 'generated', 'plugins.ts');
    const fetchImpl = (async () => new Response(JSON.stringify(indexDocument()), { status: 200 })) as unknown as typeof fetch;

    const first = await syncPlugins({
      root,
      snapshotPath,
      modulePath,
      presentation: pluginPresentation,
      fetchImpl,
      now: () => new Date('2026-11-24T13:00:00.000Z'),
    });
    expect(first.snapshotWritten).toBe(true);
    const snapshot = parsePluginSnapshot(JSON.parse(await readFile(snapshotPath, 'utf8')), snapshotPath);
    expect(snapshot.fetchedAt).toBe('2026-11-24T13:00:00.000Z');

    const second = await syncPlugins({
      root,
      snapshotPath,
      modulePath,
      presentation: pluginPresentation,
      fetchImpl,
      now: () => new Date('2026-11-25T13:00:00.000Z'),
    });
    expect(second.snapshotWritten).toBe(false);
    const unchanged = parsePluginSnapshot(JSON.parse(await readFile(snapshotPath, 'utf8')), snapshotPath);
    expect(unchanged.fetchedAt).toBe('2026-11-24T13:00:00.000Z');
  });
});

describe('the committed snapshot', () => {
  test('parses and renders every row with a description and a link', async () => {
    const snapshotPath = 'src/data/plugins.snapshot.json';
    const snapshot = parsePluginSnapshot(JSON.parse(await readFile(snapshotPath, 'utf8')), snapshotPath);
    const view = buildPluginView(parsePluginIndex(snapshot.document, snapshotPath), {
      source: snapshot.source,
      fetchedAt: snapshot.fetchedAt,
      stale: false,
      presentation: pluginPresentation,
    });
    expect(view.runtime.length + view.context.length).toBeGreaterThan(0);
    for (const row of [...view.runtime, ...view.context]) {
      expect(row.name.length).toBeGreaterThan(0);
      expect(row.description.length).toBeGreaterThan(0);
      expect(row.repository.startsWith('https://')).toBe(true);
      expect(row.tier).toBe('official');
    }
  });

  test('rejects a snapshot without a valid fetch time', () => {
    expect(() =>
      parsePluginSnapshot({ source: 'https://example.test/index.json', fetched_at: 'yesterday', document: indexDocument() }, 'snapshot'),
    ).toThrow('fetched_at must be an ISO 8601 UTC timestamp');
  });
});

describe('module rendering', () => {
  test('names the generating script and imports the view type', () => {
    const module = renderPluginViewModule(viewOf(), '../../scripts/lib/plugins');
    expect(module.startsWith('// Generated by scripts/sync-plugins.ts')).toBe(true);
    expect(module).toContain("import type { PluginIndexView } from '../../scripts/lib/plugins';");
    expect(module).toContain('export const pluginIndexView: PluginIndexView');
  });
});
