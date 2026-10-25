import type { APIRoute } from 'astro';
import { siteUrl } from '../config/agents.mjs';
import { changelogFeed } from '../config/changelog';
import { timeline } from '../data/changelog';
import { renderAtomFeed } from '../lib/changelog-feed';

/** Atom feed of the newest ecosystem releases. */
export const GET: APIRoute = () =>
	new Response(renderAtomFeed(timeline(), { siteUrl, title: changelogFeed.title, limit: changelogFeed.limit }), {
		headers: { 'Content-Type': 'application/atom+xml; charset=utf-8' },
	});
