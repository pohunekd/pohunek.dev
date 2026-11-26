import type { IconName } from '../components/icons';
import { pendingPlugins, pluginIndex } from './plugins';
import type { Status } from './status';

interface Tenet {
	icon: IconName;
	title: string;
	body: string;
}

interface AgentStep {
	command: string;
	caption: string;
}

interface Agent {
	name: string;
	status: Status;
	note: string;
}

interface Host {
	name: string;
	transport: string;
	workers: string;
}

interface ComparisonRow {
	need: string;
	answer: string;
}

const tenets: Tenet[] = [
	{
		icon: 'terminal',
		title: 'No agentic IDE',
		body: 'Your agent already has a shell. Give it pohunek and it can start, feed, watch and review other agents on any of your machines.',
	},
	{
		icon: 'bell',
		title: "Don't watch the field",
		body: 'You are not meant to stare at it. When an agent waits for an approval or is blocked, the notification reaches you from every host at once.',
	},
	{
		icon: 'network',
		title: 'Every machine, one contract',
		body: 'Laptop, workstation, build box. One daemon each, one versioned JSON contract for everything you build on top.',
	},
];

const agentSteps: AgentStep[] = [
	{
		command: 'pohunek session new --host buildbox --project myapp --agent codex --branch feat/parser --yes --json',
		caption: 'Start Codex on the build box, in its own worktree.',
	},
	{
		command: "printf '%s' 'Run the focused tests.' | pohunek session input buildbox/s-01J… --stdin --json",
		caption: 'Send a prompt from stdin, framed the way this agent expects.',
	},
	{
		command: 'pohunek session wait buildbox/s-01J… --activity idle --timeout-ms 8000 --json',
		caption: 'Wake up when the agent goes idle, or report a timeout.',
	},
	{
		command: 'pohunek session diff buildbox/s-01J…',
		caption: 'Review what it changed in the remote worktree, untracked files included.',
	},
	{
		command: 'pohunek notifications watch --all-hosts',
		caption: 'Hear about it only when an agent needs you.',
	},
];

/** The official runtime packages every core release ships and installs offline, plus the built-in shell. */
const bundledAgents: Agent[] = [
	{ name: 'Codex', status: 'shipped', note: 'official' },
	{ name: 'Claude Code', status: 'shipped', note: 'official' },
	{ name: 'Hermes', status: 'shipped', note: 'official' },
	{ name: 'Pi', status: 'shipped', note: 'official' },
	{ name: 'shell', status: 'shipped', note: 'built in' },
];

/** Agents without a package or an adapter yet. */
const plannedAgents: Agent[] = [{ name: 'OpenCode', status: 'planned', note: '2.x' }];

/**
 * Bundled runtimes first, then every runtime package of the signed official plugin index and the
 * official plugin repositories awaiting admission, so an admitted plugin appears without an edit here.
 */
const agents: Agent[] = [
	...bundledAgents,
	...pluginIndex.runtime.map((plugin): Agent => ({ name: plugin.name, status: 'shipped', note: 'plugin' })),
	...pendingPlugins.map((plugin): Agent => ({ name: plugin.name, status: 'in-progress', note: 'plugin, pending' })),
	...plannedAgents,
];

const hosts: Host[] = [
	{ name: 'laptop', transport: 'Unix socket', workers: 'claude · codex' },
	{ name: 'workstation', transport: 'NetBird / WireGuard', workers: 'codex · hermes' },
	{ name: 'buildbox', transport: 'NetBird / WireGuard', workers: 'claude · pi · shell' },
];

const comparison: ComparisonRow[] = [
	{
		need: 'Know whether the agent is working, blocked or idle',
		answer: 'Live detection from OSC signals first, with screen patterns and PTY activity as the fallback, driven by TOML manifests.',
	},
	{
		need: 'Submit a multi-line prompt without it being half-swallowed',
		answer: 'Per-agent framing (bracketed paste, delayed submit); prompts can come from stdin and never touch argv or logs.',
	},
	{
		need: 'Hear about it when something needs you, on any machine',
		answer: 'Durable, deduplicated notification records fed by agent hooks and daemon detection, fanned out across hosts.',
	},
	{
		need: 'Keep two agents out of one working tree',
		answer: 'A worktree per session off the base branch, with ownership checked before any reuse or cleanup.',
	},
	{
		need: 'Get a conversation back',
		answer: "The agent's own session id is captured for an explicit resume.",
	},
	{
		need: 'Watch without stealing the terminal',
		answer: 'Screen snapshots, paged output with exact cursors, and bounded waits for change.',
	},
	{
		need: 'Drive it from a script or another agent',
		answer: 'One versioned --json envelope, typed errors with recovery hints, event streams, Rust and TypeScript SDKs.',
	},
];

export const landing = { tenets, agentSteps, agents, hosts, comparison } as const;
