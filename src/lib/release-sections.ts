import type { ChangelogSource } from '../../scripts/lib/changelog';

/** A release body split for the changelog page: what is always shown and what stays one click away. */
export interface ReleaseSections {
	/** One plain-text line that tells what the release is about. */
	readonly summary: string;
	/** Markdown shown when the release is opened. */
	readonly lead: string;
	/** Markdown of the `Full changelog` section, when the body has one. */
	readonly full?: string;
	/** List items in the full section. */
	readonly fullCount: number;
}

/** Longest summary line; a second sentence is added only while it still fits. */
const SUMMARY_LIMIT = 220;

const FULL_HEADING = /^#{1,6}\s+full changelog\s*$/im;
const BULLET = /^\s*[-*+]\s+/;
const ISSUE_REFS = /\s*\((?:#\d+)(?:,\s*#\d+)*\)/g;

/** Plain text of one Markdown inline run: link targets, code ticks and emphasis marks dropped. */
function plain(text: string): string {
	return text
		.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/[`*]+/g, '')
		.replace(/(^|\s)_+|_+(?=\s|$|[.,;:])/g, '$1')
		.replace(ISSUE_REFS, '')
		.replace(/\s+/g, ' ')
		.trim();
}

function firstBlock(markdown: string): string | undefined {
	for (const block of markdown.split(/\n\s*\n/)) {
		const lines = block.split('\n').filter((line) => !/^#{1,6}\s/.test(line.trim()) && line.trim() !== '');
		if (lines.length === 0 || lines[0].trim().startsWith('```')) {
			continue;
		}
		return BULLET.test(lines[0]) ? lines[0].replace(BULLET, '') : lines.join(' ');
	}
	return undefined;
}

/** The first sentence of the text, plus the second one while the line stays within the limit. */
function leadingSentences(text: string): string {
	const sentences = text.split(/(?<=[.!?])\s+/);
	let line = sentences[0].trim();
	if (sentences.length > 1 && `${line} ${sentences[1].trim()}`.length <= SUMMARY_LIMIT) {
		line = `${line} ${sentences[1].trim()}`;
	}
	if (line.length <= SUMMARY_LIMIT) {
		return line;
	}
	const cut = line.slice(0, SUMMARY_LIMIT - 1);
	return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), 1)).replace(/[,;:.\s]+$/, '')}…`;
}

function countItems(markdown: string): number {
	return markdown.split('\n').filter((line) => BULLET.test(line)).length;
}

/**
 * Splits a release body at its `Full changelog` heading (the ecosystem changelog contract puts the
 * highlights above it) and derives the summary line. A body without that heading stays whole;
 * a generated body, which is only a list of pull request titles, is summarized by its count.
 */
export function splitRelease(markdown: string, source: ChangelogSource): ReleaseSections {
	const normalized = markdown.replace(/\r\n/g, '\n').trim();
	const match = FULL_HEADING.exec(normalized);
	const lead = (match === null ? normalized : normalized.slice(0, match.index)).trim();
	const full = match === null ? undefined : normalized.slice(match.index + match[0].length).trim();
	const hasFull = full !== undefined && full.length > 0;

	let summary: string;
	if (source === 'generated') {
		const count = countItems(lead);
		summary = count === 0 ? plain(lead) : `${count} merged pull request${count === 1 ? '' : 's'}`;
	} else {
		const block = firstBlock(lead.length > 0 ? lead : (full ?? ''));
		summary = block === undefined ? '' : leadingSentences(plain(block));
	}

	return {
		summary,
		lead: lead.length > 0 ? lead : (full ?? ''),
		full: hasFull && lead.length > 0 ? full : undefined,
		fullCount: hasFull ? countItems(full) : 0,
	};
}
