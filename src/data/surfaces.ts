import type { ImageMetadata } from 'astro';
import type { Status } from './status';
import type { IconName } from '../components/icons';
import companionSidebar from '../assets/screenshots/companion/sidebar.png';
import companionByState from '../assets/screenshots/companion/by-state.png';
import companionFilters from '../assets/screenshots/companion/filters.png';
import companionRowActions from '../assets/screenshots/companion/row-actions.png';
import companionSessionDetail from '../assets/screenshots/companion/session-detail.png';
import companionNewSession from '../assets/screenshots/companion/new-session.png';
import companionAssistant from '../assets/screenshots/companion/assistant.png';
import companionInstallPlan from '../assets/screenshots/companion/install-plan.png';
import { androidScreenshots } from './generated/android-screenshots';
import { isPrerelease } from '../../scripts/lib/releases-config';
import { pinnedTag, product } from './ecosystem';

export interface SurfaceScreenshot {
	image: ImageMetadata;
	alt: string;
	caption: string;
	/** Device pixel ratio of the capture; omitted means 2 (HiDPI). */
	density?: number;
}

export interface Surface {
	slug: string;
	name: string;
	/** One sentence for cards. */
	summary: string;
	status: Status;
	/** Short qualifier shown next to the status badge. */
	statusNote: string;
	/** Shown on the landing page; experimental surfaces stay on the surfaces page only. */
	featured: boolean;
	/** Short platform line, for example "Linux · macOS". */
	platform: string;
	repoUrl: string;
	/** Latest verified release tag, when one exists. */
	release?: string;
	icon: IconName;
	/** Real screenshots only; surfaces without captures leave this empty. */
	screenshots: readonly SurfaceScreenshot[];
}

const companionRepo = `https://github.com/${product('companion').repository}`;
const workRepo = `https://github.com/${product('plugin').repository}`;

export const surfaces: readonly Surface[] = [
	{
		slug: 'companion',
		featured: true,
		name: 'Desktop companion',
		summary: 'A narrow native sidebar that lifts the sessions needing you to the top, with a tray badge and one-click attach.',
		status: 'shipped',
		statusNote: pinnedTag('companion'),
		platform: 'Linux · Wayland · macOS',
		repoUrl: companionRepo,
		release: pinnedTag('companion'),
		icon: 'tiles',
		screenshots: [
			{
				image: companionSidebar,
				alt: 'Sidebar with sessions that need the owner listed first, followed by groups of working and idle agent sessions',
				caption: 'Sidebar',
			},
			{
				image: companionByState,
				alt: 'State view with Needs you, Working and Idle sections',
				caption: 'State view',
			},
			{
				image: companionFilters,
				alt: 'A project chip and the Ended chip active, showing only that project sessions',
				caption: 'Filters',
			},
			{
				image: companionRowActions,
				alt: 'Action icons shown on a hovered session row',
				caption: 'Row actions',
			},
			{
				image: companionSessionDetail,
				alt: 'Session details view with copyable id, host, agent, state and working directory',
				caption: 'Session detail',
			},
			{
				image: companionNewSession,
				alt: 'New session dialog with host, project, agent and prompt fields',
				caption: 'New session',
			},
			{
				image: companionAssistant,
				alt: 'Assistant dialog with request and intent fields',
				caption: 'Assistant',
			},
			{
				image: companionInstallPlan,
				alt: 'Setup screen after the release was downloaded and verified, showing checksum evidence and what the installer will write',
				caption: 'Verified install',
				density: 1,
			},
		],
	},
	{
		slug: 'android',
		featured: true,
		name: 'Android companion',
		summary: 'A remote session list with live state and an embedded terminal over the NetBird overlay.',
		status: 'in-progress',
		statusNote: isPrerelease(product('android').version) ? `${pinnedTag('android')} pre-release` : pinnedTag('android'),
		platform: 'Android',
		repoUrl: `https://github.com/${product('android').repository}`,
		release: pinnedTag('android'),
		icon: 'phone',
		screenshots: androidScreenshots,
	},
	{
		slug: 'tui',
		featured: true,
		name: 'Terminal TUI',
		summary: 'pohunek-work tui: Work, Sessions, Hosts and Activity views in one full-screen terminal interface.',
		status: 'in-progress',
		statusNote: `${pinnedTag('plugin')} released, views still landing`,
		platform: 'Linux · macOS terminal',
		repoUrl: workRepo,
		release: pinnedTag('plugin'),
		icon: 'terminal',
		screenshots: [],
	},
	{
		slug: 'sway',
		featured: true,
		name: 'Sway + rofi launcher',
		summary: 'Quick-switch attached agent terminals with a keybind and start work on Linear issues or GitHub PRs from rofi.',
		status: 'shipped',
		statusNote: pinnedTag('launchers'),
		platform: 'Linux · Wayland (Sway)',
		repoUrl: workRepo,
		release: pinnedTag('launchers'),
		icon: 'window',
		screenshots: [],
	},
	{
		slug: 'web',
		featured: false,
		name: 'Web control center',
		summary: 'An experimental self-hosted dashboard with a session rail across all hosts. It works, but it still needs a lot of polish.',
		status: 'experimental',
		statusNote: pinnedTag('web'),
		platform: 'Linux · macOS',
		repoUrl: workRepo,
		release: pinnedTag('web'),
		icon: 'globe',
		screenshots: [],
	},
];

export function getSurface(slug: string): Surface {
	const surface = surfaces.find((item) => item.slug === slug);
	if (!surface) {
		throw new Error(`Unknown surface slug: ${slug}`);
	}
	return surface;
}
