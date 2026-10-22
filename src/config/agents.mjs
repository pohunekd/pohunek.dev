// Machine-readable entry points for agents: llms.txt (starlight-llms-txt), robots.txt
// and /.well-known/security.txt. Plain .mjs so astro.config.mjs can import it.

export const siteUrl = 'https://pohunek.dev';

/** @type {NonNullable<Parameters<typeof import('starlight-llms-txt').default>[0]>} */
export const llmsTxt = {
	projectName: 'pohunek',
	description:
		'pohunek is a headless, multihost backbone for coding agents: one small daemon (pohunekd) per machine, one durable PTY per agent session, and one versioned JSON contract (`pohunek ... --json`, protocol, Rust and TypeScript SDKs) for everything built on top. The agent is the user; a human owner only steps in when a session needs them.',
	details: [
		'How to use these files:',
		'',
		`- To install pohunek on a machine, fetch ${siteUrl}/install-prompt.txt and follow it. It verifies every download and asks the owner before it installs the login service or any runtime hook.`,
		'- To drive pohunek, use the CLI with `--json`: every automation command returns one versioned envelope with typed errors. The CLI reference set below is the contract.',
		'- Agent CLIs (Codex, Claude Code, Hermes, Pi, and any other through a runtime package) run inside pohunek sessions; pohunek does not write code itself.',
		`- The docs are rendered from the pohunek repository at a pinned release; the version is shown on ${siteUrl}/docs/.`,
	].join('\n'),
	// llms-full.txt opens with what an agent needs first: what pohunek does, how to install it, the CLI.
	promote: ['docs/features*', 'docs/install*', 'docs/cli*'],
	customSets: [
		{
			label: 'CLI, SDK and protocol reference',
			description: 'the automation contract: commands, JSON envelopes, SDK clients and the wire protocol',
			paths: ['docs/cli*', 'docs/sdk*', 'docs/protocol*'],
		},
		{
			label: 'Install and operate',
			description: 'installation, upgrades, remote hosts and runbooks',
			paths: ['docs/install*', 'docs/guides/**', 'docs/runbooks/**'],
		},
	],
	optionalLinks: [
		{ label: 'Why pohunek', url: `${siteUrl}/why/`, description: 'why agents need a farmhand, not an IDE' },
		{ label: 'Surfaces', url: `${siteUrl}/surfaces/`, description: 'optional owner UIs: desktop and Android companions, TUI, Sway launcher, web' },
		{ label: 'Plugins', url: `${siteUrl}/plugins/`, description: 'runtime packages and workflow plugins' },
		{ label: 'Roadmap', url: `${siteUrl}/roadmap/`, description: 'tracks and their state' },
		{ label: 'Source', url: 'https://github.com/zajca/pohunek', description: 'repository, issues and releases' },
	],
};

/** RFC 9116 contact; the advisory form is GitHub private vulnerability reporting. */
export const securityTxt = {
	contact: 'https://github.com/zajca/pohunek/security/advisories/new',
	policy: 'https://github.com/zajca/pohunek/security',
	preferredLanguages: 'en, cs',
	/** Expires is computed at build time; every deploy pushes it this many days out (RFC 9116 asks for under a year). */
	expiresAfterDays: 180,
};
