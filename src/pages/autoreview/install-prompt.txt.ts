import type { APIRoute } from 'astro';
import installPrompt from '../../data/generated/autoreview/install-prompt.txt?raw';

/** The autoreview README install prompt as plain text, so an agent can fetch and follow it directly. */
export const GET: APIRoute = () =>
	new Response(installPrompt.trim() + '\n', { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
