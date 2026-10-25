import { pinnedTag, product } from '../data/ecosystem';

export interface NavLink {
	label: string;
	href: string;
}

const pohunek = product('pohunek');
const repoUrl = `https://github.com/${pohunek.repository}`;

export const site = {
	name: 'pohunek',
	domain: 'pohunek.dev',
	repository: pohunek.repository,
	tagline: 'I herd. They code.',
	description:
		'A headless, multihost backbone for coding agents. One small daemon per machine, one durable terminal per agent, one JSON contract.',
	release: pinnedTag('pohunek'),
	repoUrl,
	releasesUrl: `${repoUrl}/releases`,
	milestonesUrl: `${repoUrl}/milestones`,
	issuesUrl: `${repoUrl}/issues`,
	websiteRepoUrl: 'https://github.com/pohunekd/pohunek.dev',
	orgUrl: 'https://github.com/pohunekd',
	homebrewTapUrl: 'https://github.com/zajca/homebrew-pohunek',
	homebrewInstall: 'brew install zajca/pohunek/pohunek',
	licenseUrl: `${repoUrl}/blob/main/LICENSE`,
} as const;

/** Primary navigation shared by the marketing pages and the docs header. */
export const nav: readonly NavLink[] = [
	{ label: 'Why', href: '/why/' },
	{ label: 'Surfaces', href: '/surfaces/' },
	{ label: 'Plugins', href: '/plugins/' },
	{ label: 'Roadmap', href: '/roadmap/' },
	{ label: 'Changelog', href: '/changelog/' },
	{ label: 'Docs', href: '/docs/' },
];

export const footerLinks: readonly NavLink[] = [
	{ label: 'Source', href: site.repoUrl },
	{ label: 'Releases', href: site.releasesUrl },
	{ label: 'Homebrew tap', href: site.homebrewTapUrl },
	{ label: 'Docs', href: '/docs/' },
	{ label: 'Install', href: '/install/' },
	{ label: 'Website source', href: site.websiteRepoUrl },
];
