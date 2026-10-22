import type { APIRoute } from 'astro';
import { securityTxt } from '../../config/agents.mjs';

const dayMs = 24 * 60 * 60 * 1000;

/** RFC 9116 security.txt; Expires moves forward with every build. */
export const GET: APIRoute = ({ site }) => {
	if (!site) {
		throw new Error('security.txt needs `site` in astro.config.mjs');
	}
	const expires = new Date(Date.now() + securityTxt.expiresAfterDays * dayMs);
	const lines = [
		`Contact: ${securityTxt.contact}`,
		`Expires: ${expires.toISOString().replace(/\.\d{3}Z$/, 'Z')}`,
		`Policy: ${securityTxt.policy}`,
		`Preferred-Languages: ${securityTxt.preferredLanguages}`,
		`Canonical: ${new URL('.well-known/security.txt', site)}`,
	];
	return new Response(lines.join('\n') + '\n', { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
