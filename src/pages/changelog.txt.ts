import type { APIRoute } from 'astro';
import { changelogFeed } from '../config/changelog';
import { timeline } from '../data/changelog';
import { renderChangelogText } from '../lib/changelog-feed';

/** The whole ecosystem changelog as Markdown text, linked from llms.txt. */
export const GET: APIRoute = () =>
	new Response(renderChangelogText(timeline(), changelogFeed.title), {
		headers: { 'Content-Type': 'text/plain; charset=utf-8' },
	});
