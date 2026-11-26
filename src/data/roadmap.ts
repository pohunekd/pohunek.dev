import type { Status } from './status';

export interface RoadmapIssue {
	/** Issue number in zajca/pohunek. */
	number: number;
}

export interface RoadmapTrack {
	title: string;
	goal: string;
	status: Status;
	statusNote: string;
	/** Closed and total child issues of the first linked epic. */
	progress?: { done: number; total: number };
	/** Epics and issues in zajca/pohunek; empty only for work tracked in a private repository. */
	issues: readonly RoadmapIssue[];
}

/** The open milestone the next core release is cut from. */
export interface RoadmapMilestone {
	/** Milestone number in zajca/pohunek, as in `/milestone/<number>`. */
	number: number;
	title: string;
	progress: { done: number; total: number };
	/** Epics of the milestone, with the outcome each one delivers. */
	epics: readonly { issue: number; title: string; outcome: string }[];
}

/**
 * When the counts below were read from GitHub. Update it together with them: the epics and
 * milestones are the source of truth, and this page is reconciled at each core release.
 */
export const roadmapAsOf = '2026-11-26';

/** Core release the roadmap was reconciled against. */
export const roadmapRelease = 'v0.45.0';

export const nextMilestone: RoadmapMilestone = {
	number: 21,
	title: '0.46',
	progress: { done: 3, total: 56 },
	epics: [
		{
			issue: 1609,
			title: 'Plugins live outside core',
			outcome: 'Plugins are admitted through the signed index without waiting for a core release; the official runtimes follow.',
		},
		{
			issue: 2167,
			title: 'Session inheritance',
			outcome: 'Finished sub-sessions clean up on their own, and a herd of sessions can be listed and removed as one tree.',
		},
		{
			issue: 2150,
			title: 'Parameterized agent profiles',
			outcome: 'Fewer profiles that cover more cases: options with defaults, audience-aware pickers and presets.',
		},
		{
			issue: 2159,
			title: 'Ownership and copy costs',
			outcome: 'Fewer copies on the hot output path and in event fan-out, with a benchmark and lints that keep them out.',
		},
	],
};

/** Epic links follow the open and closed state of zajca/pohunek issues on `roadmapAsOf`. */
export const roadmapTracks: readonly RoadmapTrack[] = [
	{
		title: 'Runtime plugin packages',
		goal: 'Pi, Codex, Claude Code and Hermes are signed, content-addressed runtime packages installed per host, and every release carries them for offline installs. Only shell stays built in.',
		status: 'shipped',
		statusNote: 'epic closed',
		progress: { done: 45, total: 46 },
		issues: [{ number: 139 }],
	},
	{
		title: 'Plugins outside core',
		goal: 'Plugins live in their own repositories and become installable by id through the signed official index, refreshed on the host between core releases. The plugin kit and its CI check a package the way the official pipeline does.',
		status: 'in-progress',
		statusNote: 'index and kit shipped',
		progress: { done: 10, total: 18 },
		issues: [{ number: 1609 }],
	},
	{
		title: 'More agents',
		goal: 'Further agent runtimes as packages: Pi, Muse Code, Mistral Vibe, Antigravity and Cline are available. OpenCode 2.x comes through the owned-server session backend instead of a compiled adapter.',
		status: 'in-progress',
		statusNote: 'five packages out; OpenCode pilot open',
		progress: { done: 6, total: 11 },
		issues: [{ number: 1946 }, { number: 1950 }],
	},
	{
		title: 'Agents that run agents',
		goal: 'Launch profiles with options and presets, sessions as a tree with recursive removal and attention isolation, and rights that let a session manage only the sessions it started.',
		status: 'shipped',
		statusNote: '0.43 and 0.44',
		progress: { done: 4, total: 4 },
		issues: [{ number: 2150 }, { number: 2167 }],
	},
	{
		title: 'Delegated task runs',
		goal: 'Tasks and turns over ordinary sessions, with a blocking wait and typed results, so agents can delegate work reliably.',
		status: 'in-progress',
		statusNote: 'RFC accepted, WS1 protocol started',
		progress: { done: 3, total: 16 },
		issues: [{ number: 182 }, { number: 219 }],
	},
	{
		title: 'Durability and detection',
		goal: 'Recovery from crashes and host-wide session loss in one action, and explainable working, blocked and idle detection. Detection reads OSC signals first (OSC 9;4, and OSC 7501 for Claude Code 2.1.309 and later) and falls back to screen text.',
		status: 'in-progress',
		statusNote: 'detection shipped, recovery open',
		progress: { done: 3, total: 6 },
		issues: [{ number: 426 }, { number: 67 }],
	},
	{
		title: 'macOS',
		goal: 'Native Apple Silicon hosts with launchd-owned durable workers.',
		status: 'shipped',
		statusNote: 'supported',
		issues: [{ number: 94 }, { number: 105 }],
	},
	{
		title: 'Optional team relay',
		goal: 'A multi-team control plane. Hosts open the WireGuard link to the relay themselves. The direct owner path stays first-class. Developed in a separate private repository, so its issues have no public link.',
		status: 'in-progress',
		statusNote: 'authentication done, transport pending',
		issues: [],
	},
	{
		title: 'Dark factory',
		goal: 'Unattended manager and auditor delegation over the team relay, built as a client of the relay. Tracked in the same private repository.',
		status: 'design',
		statusNote: 'design',
		issues: [],
	},
];
