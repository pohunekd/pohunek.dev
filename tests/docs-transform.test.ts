import { describe, expect, test } from 'bun:test';
import {
  buildDocPage,
  createLinkTargets,
  extractInstallPrompt,
  planPages,
  plainTitle,
  rewriteMarkdownLinks,
  splitFrontmatter,
  stripLeadingH1,
  type LinkTargets,
  type PlannedPage,
} from '../scripts/lib/docs-transform.ts';
import type { PageRule } from '../scripts/lib/docs-config.ts';

const REPO = 'zajca/pohunek';
const REF = 'v0.35.2';

const FILES = [
  'README.md',
  'docs/install.md',
  'docs/cli.md',
  'docs/public-api.md',
  'docs/design/team-relay-control-plane-rfc.md',
  'docs/knowledge/index.md',
  'docs/knowledge/concepts/sessions.md',
  'docs/knowledge/concepts/worktrees.md',
  'docs/knowledge/guides/setup.md',
  'docs/knowledge/assistant/source-map.md',
  'docs/knowledge/log.md',
  'crates/pohunek-core/src/lib.rs',
  'LICENSE',
];

const PAGE_RULES: PageRule[] = [
  { source: 'docs/install.md', route: 'install' },
  { source: 'docs/public-api.md', route: 'protocol' },
  { source: 'docs/knowledge/index.md', route: '' },
  { source: 'docs/knowledge/concepts/**/*.md', routeBase: 'docs/knowledge' },
  { source: 'docs/knowledge/guides/**/*.md', routeBase: 'docs/knowledge' },
];

function plannedPages(): PlannedPage[] {
  return planPages(PAGE_RULES, FILES);
}

function targetsFor(): LinkTargets {
  const planned = plannedPages();
  return createLinkTargets({
    files: FILES,
    routes: new Map(planned.map((page) => [page.sourcePath, page.route])),
    repository: REPO,
    ref: REF,
    githubUrl: 'https://github.com',
    rawUrl: 'https://raw.githubusercontent.com',
    routePrefix: 'docs',
  });
}

describe('splitFrontmatter', () => {
  test('returns the parsed mapping and the body after the closing fence', () => {
    const { data, body } = splitFrontmatter('---\ntitle: Sessions\nsince: 0.3.3\n---\n\n# Sessions\n');
    expect(data).toEqual({ title: 'Sessions', since: '0.3.3' });
    expect(body).toBe('\n# Sessions\n');
  });

  test('treats a document without frontmatter as all body', () => {
    expect(splitFrontmatter('# CLI guide\n')).toEqual({ data: {}, body: '# CLI guide\n' });
  });

  test('rejects an unclosed frontmatter block', () => {
    expect(() => splitFrontmatter('---\ntitle: Broken\n# no close\n')).toThrow('never closed');
  });

  test('normalizes CRLF line endings', () => {
    const { data, body } = splitFrontmatter('---\r\ntitle: Win\r\n---\r\n# Body\r\n');
    expect(data.title).toBe('Win');
    expect(body).toBe('# Body\n');
  });
});

describe('stripLeadingH1', () => {
  test('removes the first H1 when it is the first content and reports its text', () => {
    expect(stripLeadingH1('\n# CLI guide\n\n## Commands\n')).toEqual({
      heading: 'CLI guide',
      body: '## Commands\n',
    });
  });

  test('keeps an H1 that is not the first content', () => {
    const body = 'Intro paragraph.\n\n# Later heading\n';
    expect(stripLeadingH1(body)).toEqual({ heading: null, body });
  });

  test('does not treat an H2 as a title', () => {
    const body = '## Section\n\ntext\n';
    expect(stripLeadingH1(body)).toEqual({ heading: null, body });
  });

  test('strips closing hashes from ATX headings', () => {
    expect(stripLeadingH1('# Title #\n\nbody').heading).toBe('Title');
  });
});

describe('plainTitle', () => {
  test('removes backticks and escapes', () => {
    expect(plainTitle('Repo `.pohunek/` Safety')).toBe('Repo .pohunek/ Safety');
    expect(plainTitle('Escaped \\* star')).toBe('Escaped * star');
  });
});

describe('buildDocPage', () => {
  const planned = (sourcePath: string, route: string, title?: string): PlannedPage => ({ sourcePath, route, title });

  test('derives the title from frontmatter, removes the duplicate H1, and keeps only allowed keys', () => {
    const page = buildDocPage({
      sourcePath: 'docs/knowledge/concepts/sessions.md',
      text: [
        '---',
        'type: Concept',
        'id: concept/sessions',
        'title: Sessions',
        'description: Durable records.',
        'source_kind: manual',
        'intents: [debug, help]',
        '---',
        '',
        '# Sessions',
        '',
        'A session is a record.',
        '',
      ].join('\n'),
      planned: planned('docs/knowledge/concepts/sessions.md', 'concepts/sessions'),
      editUrl: 'https://github.com/zajca/pohunek/blob/main/docs/knowledge/concepts/sessions.md',
      targets: targetsFor(),
    });

    expect(page.title).toBe('Sessions');
    expect(page.route).toBe('concepts/sessions');
    expect(page.content).toBe(
      [
        '---',
        'title: Sessions',
        'description: Durable records.',
        'editUrl: https://github.com/zajca/pohunek/blob/main/docs/knowledge/concepts/sessions.md',
        '---',
        '',
        'A session is a record.',
        '',
      ].join('\n'),
    );
  });

  test('derives the title from the H1 when frontmatter has none', () => {
    const page = buildDocPage({
      sourcePath: 'docs/install.md',
      text: '# Install pohunek manually\n\nBody.\n',
      planned: planned('docs/install.md', 'install'),
      editUrl: 'https://example.test/edit',
      targets: targetsFor(),
    });
    expect(page.title).toBe('Install pohunek manually');
    expect(page.content).not.toContain('# Install pohunek manually');
    expect(page.content).toContain('title: Install pohunek manually');
  });

  test('uses the page rule title over the source title', () => {
    const page = buildDocPage({
      sourcePath: 'docs/knowledge/index.md',
      text: '# Pohunek Knowledge\n\nBody.\n',
      planned: planned('docs/knowledge/index.md', '', 'Pohunek documentation'),
      editUrl: 'https://example.test/edit',
      targets: targetsFor(),
    });
    expect(page.title).toBe('Pohunek documentation');
  });

  test('fails when neither frontmatter nor an H1 provides a title', () => {
    expect(() =>
      buildDocPage({
        sourcePath: 'docs/install.md',
        text: 'Just prose.\n',
        planned: planned('docs/install.md', 'install'),
        editUrl: 'https://example.test/edit',
        targets: targetsFor(),
      }),
    ).toThrow('neither a frontmatter title nor a leading H1');
  });

  test('omits description when the source has none', () => {
    const page = buildDocPage({
      sourcePath: 'docs/cli.md',
      text: '# CLI guide\n\nBody.\n',
      planned: planned('docs/cli.md', 'cli'),
      editUrl: 'https://example.test/edit',
      targets: targetsFor(),
    });
    expect(page.content.split('\n').some((line) => line.startsWith('description:'))).toBe(false);
  });
});

describe('planPages', () => {
  test('matches explicit files and globs and derives routes from routeBase', () => {
    const planned = plannedPages();
    expect(planned.map((page) => [page.sourcePath, page.route])).toEqual([
      ['docs/install.md', 'install'],
      ['docs/knowledge/concepts/sessions.md', 'concepts/sessions'],
      ['docs/knowledge/concepts/worktrees.md', 'concepts/worktrees'],
      ['docs/knowledge/guides/setup.md', 'guides/setup'],
      ['docs/knowledge/index.md', ''],
      ['docs/public-api.md', 'protocol'],
    ]);
  });

  test('never publishes files that no rule matches', () => {
    const sourcePaths = plannedPages().map((page) => page.sourcePath);
    expect(sourcePaths).not.toContain('docs/design/team-relay-control-plane-rfc.md');
    expect(sourcePaths).not.toContain('docs/knowledge/log.md');
    expect(sourcePaths).not.toContain('docs/knowledge/assistant/source-map.md');
  });

  test('fails when an explicit whitelisted file is missing at the ref', () => {
    expect(() => planPages([{ source: 'docs/sdk.md', route: 'sdk' }], FILES)).toThrow(
      'matches no file at the pinned ref: docs/sdk.md',
    );
  });

  test('fails when a glob matches nothing', () => {
    expect(() =>
      planPages([{ source: 'docs/knowledge/runbooks/**/*.md', routeBase: 'docs/knowledge' }], FILES),
    ).toThrow('matches no file');
  });

  test('fails when two rules produce the same route', () => {
    expect(() =>
      planPages(
        [
          { source: 'docs/install.md', route: 'same' },
          { source: 'docs/cli.md', route: 'same' },
        ],
        FILES,
      ),
    ).toThrow('route "same" is produced by both');
  });
});

describe('rewriteMarkdownLinks', () => {
  const targets = targetsFor();

  test('rewrites a whitelisted .md link to its site route and keeps the anchor', () => {
    const { text, warnings } = rewriteMarkdownLinks(
      'See [sessions](concepts/sessions.md#lifecycle) for details.',
      'docs/knowledge/index.md',
      targets,
    );
    expect(text).toBe('See [sessions](/docs/concepts/sessions/#lifecycle) for details.');
    expect(warnings).toEqual([]);
  });

  test('resolves parent-relative links against the source directory', () => {
    const { text } = rewriteMarkdownLinks(
      '[setup](../guides/setup.md)',
      'docs/knowledge/concepts/sessions.md',
      targets,
    );
    expect(text).toBe('[setup](/docs/guides/setup/)');
  });

  test('links the index route to the docs home', () => {
    const { text } = rewriteMarkdownLinks('[home](../index.md)', 'docs/knowledge/guides/setup.md', targets);
    expect(text).toBe('[home](/docs/)');
  });

  test('rewrites a non-whitelisted repository file to a GitHub blob URL at the ref', () => {
    const { text } = rewriteMarkdownLinks(
      '[readme](../README.md) and [crate](../crates/pohunek-core/src/lib.rs#L10)',
      'docs/install.md',
      targets,
    );
    expect(text).toBe(
      `[readme](https://github.com/${REPO}/blob/${REF}/README.md) and ` +
        `[crate](https://github.com/${REPO}/blob/${REF}/crates/pohunek-core/src/lib.rs#L10)`,
    );
  });

  test('rewrites a directory link to a GitHub tree URL', () => {
    const { text } = rewriteMarkdownLinks('[crates](../crates/)', 'docs/install.md', targets);
    expect(text).toBe(`[crates](https://github.com/${REPO}/tree/${REF}/crates)`);
  });

  test('leaves external URLs, mail links and same-page anchors untouched', () => {
    const source = [
      '[issue](https://github.com/zajca/pohunek/issues/92)',
      '[mail](mailto:ops@example.test)',
      '[section](#turn-waits)',
      '[protocol](//cdn.example.test/x)',
    ].join('\n');
    expect(rewriteMarkdownLinks(source, 'docs/public-api.md', targets).text).toBe(source);
  });

  test('leaves links inside fenced code blocks untouched', () => {
    const source = [
      'Before [sessions](concepts/sessions.md)',
      '```markdown',
      '[sessions](concepts/sessions.md)',
      '```',
      'After [sessions](concepts/sessions.md)',
    ].join('\n');
    const { text } = rewriteMarkdownLinks(source, 'docs/knowledge/index.md', targets);
    expect(text).toBe(
      [
        'Before [sessions](/docs/concepts/sessions/)',
        '```markdown',
        '[sessions](concepts/sessions.md)',
        '```',
        'After [sessions](/docs/concepts/sessions/)',
      ].join('\n'),
    );
  });

  test('keeps tilde fences open until a fence of the same character closes them', () => {
    const source = ['~~~', '[a](concepts/sessions.md)', '```', '[b](concepts/sessions.md)', '~~~', '[c](concepts/sessions.md)'].join('\n');
    const { text } = rewriteMarkdownLinks(source, 'docs/knowledge/index.md', targets);
    expect(text).toBe(
      ['~~~', '[a](concepts/sessions.md)', '```', '[b](concepts/sessions.md)', '~~~', '[c](/docs/concepts/sessions/)'].join('\n'),
    );
  });

  test('leaves links inside inline code spans untouched', () => {
    const { text } = rewriteMarkdownLinks(
      'Use `[x](concepts/sessions.md)` but link [y](concepts/sessions.md).',
      'docs/knowledge/index.md',
      targets,
    );
    expect(text).toBe('Use `[x](concepts/sessions.md)` but link [y](/docs/concepts/sessions/).');
  });

  test('rewrites a link whose label contains code', () => {
    const { text } = rewriteMarkdownLinks(
      'See [`docs/public-api.md`](public-api.md).',
      'docs/sdk.md',
      targets,
    );
    expect(text).toBe('See [`docs/public-api.md`](/docs/protocol/).');
  });

  test('rewrites a link whose label spans several lines', () => {
    const { text } = rewriteMarkdownLinks(
      'Read [repo\n`.pohunek/`](guides/setup.md) first.',
      'docs/knowledge/index.md',
      targets,
    );
    expect(text).toBe('Read [repo\n`.pohunek/`](/docs/guides/setup/) first.');
  });

  test('preserves a link title attribute', () => {
    const { text } = rewriteMarkdownLinks('[s](concepts/sessions.md "Sessions")', 'docs/knowledge/index.md', targets);
    expect(text).toBe('[s](/docs/concepts/sessions/ "Sessions")');
  });

  test('rewrites images to raw GitHub URLs at the ref', () => {
    const { text } = rewriteMarkdownLinks('![logo](../crates/pohunek-core/src/lib.rs)', 'docs/install.md', targets);
    expect(text).toBe(`![logo](https://raw.githubusercontent.com/${REPO}/${REF}/crates/pohunek-core/src/lib.rs)`);
  });

  test('keeps unresolved targets and reports them as warnings', () => {
    const { text, warnings } = rewriteMarkdownLinks('[gone](missing.md)', 'docs/install.md', targets);
    expect(text).toBe('[gone](missing.md)');
    expect(warnings).toEqual(['docs/install.md: link target not found at ref: missing.md']);
  });

  test('reports links that escape the repository root', () => {
    const { text, warnings } = rewriteMarkdownLinks('[up](../../outside.md)', 'docs/install.md', targets);
    expect(text).toBe('[up](../../outside.md)');
    expect(warnings).toEqual(['docs/install.md: link escapes the repository root: ../../outside.md']);
  });
});

describe('extractInstallPrompt', () => {
  const readme = [
    '# pohunek',
    '',
    '## Install with an agent',
    '',
    'Open your agent and paste:',
    '',
    '```text',
    'Install pohunek on this machine.',
    '',
    'Rules:',
    '1. Verify downloads.',
    '```',
    '',
    '## Next section',
    '',
    '```text',
    'not the prompt',
    '```',
    '',
  ].join('\n');

  test('returns the first text block under the heading', () => {
    expect(extractInstallPrompt(readme, '## Install with an agent')).toBe(
      'Install pohunek on this machine.\n\nRules:\n1. Verify downloads.\n',
    );
  });

  test('fails when the heading is missing', () => {
    expect(() => extractInstallPrompt(readme, '## Nope')).toThrow('has no "## Nope" section');
  });

  test('does not read a text block that belongs to a later section', () => {
    const withoutBlock = '## Install with an agent\n\nNo block here.\n\n## Next\n\n```text\nwrong\n```\n';
    expect(() => extractInstallPrompt(withoutBlock, '## Install with an agent')).toThrow('no ```text block');
  });

  test('fails on an empty block rather than writing an empty prompt', () => {
    const empty = '## Install with an agent\n\n```text\n\n```\n';
    expect(() => extractInstallPrompt(empty, '## Install with an agent')).toThrow('is empty');
  });
});
