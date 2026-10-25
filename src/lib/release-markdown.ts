import type { Element, Root as HastRoot } from 'hast';
import { toHtml } from 'hast-util-to-html';
import type { Nodes, Parent, PhrasingContent, Root } from 'mdast';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { toHast } from 'mdast-util-to-hast';
import { gfm } from 'micromark-extension-gfm';
import { visit } from 'unist-util-visit';

const SAFE_URL = /^https?:\/\//i;

function isSafeUrl(url: string): boolean {
	return SAFE_URL.test(url.trim());
}

/**
 * Release bodies come from other repositories and are untrusted: raw HTML is dropped, links keep only
 * http(s) targets, images become links (no third-party loads on the page) and every heading is set to
 * `headingDepth` so a body cannot outrank the page's own headings.
 */
function sanitize(tree: Root, headingDepth: 1 | 2 | 3 | 4 | 5 | 6): void {
	visit(tree, (node: Nodes, index, parent: Parent | undefined) => {
		if (parent === undefined || index === undefined) {
			return;
		}
		if (node.type === 'html') {
			parent.children.splice(index, 1);
			return index;
		}
		if (node.type === 'image' || node.type === 'imageReference') {
			const alt = node.alt ?? '';
			const replacement: PhrasingContent =
				node.type === 'image' && isSafeUrl(node.url)
					? { type: 'link', url: node.url, children: [{ type: 'text', value: alt.length > 0 ? alt : node.url }] }
					: { type: 'text', value: alt };
			parent.children.splice(index, 1, replacement as never);
			return index;
		}
		if ((node.type === 'link' || node.type === 'definition') && !isSafeUrl(node.url)) {
			if (node.type === 'definition') {
				parent.children.splice(index, 1);
			} else {
				parent.children.splice(index, 1, ...(node.children as never[]));
			}
			return index;
		}
		if (node.type === 'heading') {
			node.depth = headingDepth;
		}
		return undefined;
	});
}

/** Marks every link as user content that leaves the site. */
function markLinks(tree: HastRoot): void {
	visit(tree, 'element', (node: Element) => {
		if (node.tagName === 'a') {
			node.properties.rel = ['nofollow', 'ugc', 'noopener'];
		}
	});
}

/** Renders untrusted release Markdown (GitHub Flavored) to HTML that is safe to inline. */
export function renderReleaseMarkdown(markdown: string, headingDepth: 1 | 2 | 3 | 4 | 5 | 6): string {
	const tree = fromMarkdown(markdown, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
	sanitize(tree, headingDepth);
	// Without allowDangerousHtml, any raw HTML the sanitizer missed is dropped here as well.
	const hast = toHast(tree) as HastRoot;
	markLinks(hast);
	return toHtml(hast);
}
