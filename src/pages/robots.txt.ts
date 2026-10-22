import type { APIRoute } from 'astro';

/** Every crawler and agent may read the whole site; the sitemap and llms.txt name what is here. */
export const GET: APIRoute = ({ site }) => {
	if (!site) {
		throw new Error('robots.txt needs `site` in astro.config.mjs');
	}
	const lines = [
		'User-agent: *',
		'Allow: /',
		'',
		`Sitemap: ${new URL('sitemap-index.xml', site)}`,
		`# Summary for language models and agents: ${new URL('llms.txt', site)}`,
	];
	return new Response(lines.join('\n') + '\n', { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
