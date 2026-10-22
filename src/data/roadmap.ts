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
	progress?: { done: number; total: number };
	issues: readonly RoadmapIssue[];
}

/** Epic links come from the README roadmap table at zajca/pohunek origin/main. */
export const roadmapTracks: readonly RoadmapTrack[] = [
	{
		title: 'Runtime plugin packages',
		goal: 'Pi, Codex, Claude Code and Hermes become signed, content-addressed runtime packages installed per host. Only shell stays built in.',
		status: 'in-progress',
		statusNote: 'registry, catalog and four official packages landed',
		progress: { done: 37, total: 46 },
		issues: [{ number: 139 }],
	},
	{
		title: 'Workflow plugins',
		goal: 'Bounded, out-of-process plugins with declared actions and event reactions, invoked from the CLI.',
		status: 'shipped',
		statusNote: 'all four children landed',
		progress: { done: 4, total: 4 },
		issues: [{ number: 148 }, { number: 325 }, { number: 326 }],
	},
	{
		title: 'More agents',
		goal: 'Further first-class runtimes beyond the official packages. OpenCode 2.x is planned.',
		status: 'in-progress',
		statusNote: 'Pi ships; its acceptance and OpenCode are open',
		issues: [{ number: 50 }, { number: 227 }],
	},
	{
		title: 'Delegated task runs',
		goal: 'Tasks and turns over ordinary sessions, with a blocking wait and typed results, so agents can delegate work reliably.',
		status: 'in-progress',
		statusNote: 'RFC accepted, WS1 protocol started',
		issues: [{ number: 182 }],
	},
	{
		title: 'Durability and detection',
		goal: 'Recovery from crashes and host-wide session loss in one action, and explainable working, blocked and idle detection.',
		status: 'in-progress',
		statusNote: 'lost classification and recovery binding landed',
		issues: [{ number: 426 }, { number: 67 }],
	},
	{
		title: 'macOS',
		goal: 'Native Apple Silicon hosts with launchd-owned durable workers.',
		status: 'shipped',
		statusNote: 'supported per owner decision',
		issues: [{ number: 94 }],
	},
	{
		title: 'Optional team relay',
		goal: 'A multi-team control plane. Hosts open the WireGuard link to the relay themselves. The direct owner path stays first-class.',
		status: 'in-progress',
		statusNote: 'authentication and credentials implemented; transport pending',
		issues: [{ number: 56 }],
	},
	{
		title: 'Dark factory',
		goal: 'Unattended manager and auditor delegation over the team relay, built as a client of the relay.',
		status: 'design',
		statusNote: 'design',
		issues: [{ number: 185 }],
	},
];
