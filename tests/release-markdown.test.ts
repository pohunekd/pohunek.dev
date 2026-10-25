import { describe, expect, test } from 'bun:test';
import { renderReleaseMarkdown } from '../src/lib/release-markdown.ts';

describe('renderReleaseMarkdown', () => {
  test('renders the contract section with headings at the requested depth', () => {
    const html = renderReleaseMarkdown('### Added\n\n- **Breaking:** `attach` is read-only. ([#15](https://github.com/a/b/issues/15))', 4);
    expect(html).toContain('<h4>Added</h4>');
    expect(html).toContain('<strong>Breaking:</strong> <code>attach</code>');
    expect(html).toContain('<a href="https://github.com/a/b/issues/15" rel="nofollow ugc noopener">#15</a>');
  });

  test('drops raw HTML, inline and block', () => {
    const html = renderReleaseMarkdown('- a <script>alert(1)</script> b\n\n<iframe src="https://x"></iframe>\n\n<img src=x onerror=alert(1)>', 4);
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<iframe');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('onerror');
  });

  test('keeps only http(s) link targets', () => {
    const html = renderReleaseMarkdown(
      '[x](javascript:alert(1)) [y](data:text/html,hi) [z](HTTPS://github.com/a)\n\n[r]: javascript:alert(1)\n\n[ref][r]',
      4,
    );
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('data:');
    expect(html).toContain('href="HTTPS://github.com/a"');
  });

  test('turns images into links so the page loads nothing from elsewhere', () => {
    const html = renderReleaseMarkdown('![screen](https://example.com/s.png) ![bad](javascript:x)', 4);
    expect(html).not.toContain('<img');
    expect(html).toContain('<a href="https://example.com/s.png" rel="nofollow ugc noopener">screen</a>');
    expect(html).toContain('bad');
  });

  test('levels every heading so a body cannot outrank the page', () => {
    const html = renderReleaseMarkdown('# One\n\n## Two\n\n###### Six', 4);
    expect(html).toBe('<h4>One</h4>\n<h4>Two</h4>\n<h4>Six</h4>');
  });
});
