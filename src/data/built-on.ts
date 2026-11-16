import type { ImageMetadata } from 'astro';
import { banners } from './banners';
import { pinnedTag, product } from './ecosystem';
import type { Status } from './status';

/**
 * A product that runs on pohunek sessions but is not part of pohunek: it has its own repository, docs and releases.
 * Listed on /built-on/; it is not a `Surface`, so `src/pages/surfaces/[slug].astro` makes no page for it.
 */
export interface BuiltOnProduct {
	name: string;
	/** What kind of product it is, shown above the name. */
	kind: string;
	/** One sentence for cards; nothing beyond what the product's own docs say. */
	summary: string;
	/** The product page on this site. */
	href: string;
	/** Entry page of the product's docs. */
	docsHref: string;
	/** GitHub repository that maintains the product, as `owner/name`. */
	repository: string;
	status: Status;
	/** Short qualifier shown next to the status badge. */
	statusNote: string;
	image: ImageMetadata;
	imageAlt: string;
}

const autoreview = product('autoreview');

export const builtOn: readonly BuiltOnProduct[] = [
	{
		name: autoreview.name,
		kind: 'Pull request review',
		summary:
			'An automated pull request reviewer: it reviews GitHub pull requests with your own coding agents, run as read-only reviewers in pohunek sessions.',
		href: '/autoreview/',
		docsHref: '/autoreview/features/',
		repository: autoreview.repository,
		status: 'shipped',
		statusNote: pinnedTag('autoreview'),
		image: banners.autoreview.image,
		imageAlt: banners.autoreview.alt,
	},
];
