import type { TimelineEntry } from '../data/changelog';

export interface FeedOptions {
	readonly siteUrl: string;
	readonly title: string;
	/** Newest entries kept in the feed. */
	readonly limit: number;
}

function escapeXml(text: string): string {
	return text
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&apos;');
}

function entryAnchor(siteUrl: string, entry: TimelineEntry): string {
	return `${siteUrl}/changelog/${entry.product.id}/#${entry.product.id}-${entry.release.version}`;
}

/** Atom 1.0 feed of the timeline; the HTML content is the already sanitized release body. */
export function renderAtomFeed(entries: readonly TimelineEntry[], options: FeedOptions): string {
	const kept = entries.slice(0, options.limit);
	const feedUrl = `${options.siteUrl}/changelog.xml`;
	// An empty feed still needs a stable updated time; the epoch says "never".
	const updated = kept[0]?.release.publishedAt ?? new Date(0).toISOString();
	const items = kept.map((entry) => {
		const title = `${entry.product.name} ${entry.release.tag}`;
		const note =
			entry.release.source === 'generated'
				? '<p><em>Generated from the titles of the merged pull requests; not curated.</em></p>'
				: '';
		return [
			'  <entry>',
			`    <id>${escapeXml(entry.release.url)}</id>`,
			`    <title>${escapeXml(title)}</title>`,
			`    <link rel="alternate" type="text/html" href="${escapeXml(entryAnchor(options.siteUrl, entry))}"/>`,
			`    <published>${escapeXml(entry.release.publishedAt)}</published>`,
			`    <updated>${escapeXml(entry.release.publishedAt)}</updated>`,
			`    <category term="${escapeXml(entry.product.id)}" label="${escapeXml(entry.product.name)}"/>`,
			`    <content type="html">${escapeXml(note + entry.html)}</content>`,
			'  </entry>',
		].join('\n');
	});
	return [
		'<?xml version="1.0" encoding="utf-8"?>',
		'<feed xmlns="http://www.w3.org/2005/Atom">',
		`  <id>${escapeXml(`${options.siteUrl}/changelog/`)}</id>`,
		`  <title>${escapeXml(options.title)}</title>`,
		`  <link rel="self" type="application/atom+xml" href="${escapeXml(feedUrl)}"/>`,
		`  <link rel="alternate" type="text/html" href="${escapeXml(`${options.siteUrl}/changelog/`)}"/>`,
		`  <updated>${escapeXml(updated)}</updated>`,
		`  <author><name>pohunek</name></author>`,
		...items,
		'</feed>',
		'',
	].join('\n');
}

/** Plain Markdown of the timeline for agents: one section per release, bodies as recorded. */
export function renderChangelogText(entries: readonly TimelineEntry[], title: string): string {
	const sections = entries.map((entry) => {
		const date = entry.release.publishedAt.slice(0, 10);
		const flags = [
			entry.release.prerelease ? 'pre-release' : undefined,
			entry.release.source === 'generated' ? 'generated from pull request titles, not curated' : undefined,
		].filter((flag) => flag !== undefined);
		const suffix = flags.length > 0 ? ` (${flags.join('; ')})` : '';
		return `## ${entry.product.name} ${entry.release.tag} - ${date}${suffix}\n\n${entry.release.url}\n\n${entry.release.markdown}`;
	});
	return `# ${title}\n\n${sections.join('\n\n')}\n`;
}
