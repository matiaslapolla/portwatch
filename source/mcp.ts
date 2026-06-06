import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {z} from 'zod';
import {
	findByPort,
	freePort,
	killProc,
	scan,
	waitForPort,
	type Proc,
} from './scan/index.js';

/** Trim a Proc down to the fields an agent actually needs to reason about. */
function summarize(p: Proc) {
	return {
		pid: p.pid,
		ports: p.ports,
		command: p.command,
		cmdline: p.cmdline,
		project: p.project ?? null,
		branch: p.branch ?? null,
		worktree: p.worktree ?? null,
		docker: p.docker ?? null,
		cwd: p.cwd ?? null,
		isDev: p.isDev,
		stale: p.stale,
		cpu: p.cpu,
		memMb: Math.round(p.rssMb),
		uptime: p.uptime,
		health: p.health ?? null,
	};
}

const text = (value: unknown) => ({
	content: [{type: 'text' as const, text: JSON.stringify(value, null, 2)}],
	structuredContent: value as Record<string, unknown>,
});

export function buildServer(): McpServer {
	const server = new McpServer({name: 'portwatch', version: '0.2.0'});

	server.registerTool(
		'list_ports',
		{
			title: 'List listening ports',
			description:
				'List processes listening on local TCP ports, enriched with the project/git-worktree that owns each one, docker container, staleness and optional health. Use this to see what is running before starting a dev server.',
			inputSchema: {
				dev_only: z
					.boolean()
					.optional()
					.describe('Only return dev-server / JS tooling processes (default false).'),
				health: z
					.boolean()
					.optional()
					.describe('Probe each port over HTTP to report ok/hung/closed (slower).'),
			},
		},
		async ({dev_only, health}) => {
			const rows = await scan({health});
			const filtered = dev_only ? rows.filter(r => r.isDev) : rows;
			return text({count: filtered.length, ports: filtered.map(summarize)});
		},
	);

	server.registerTool(
		'whats_on_port',
		{
			title: 'What is on a port',
			description:
				'Identify which process is listening on a specific port, including the project/worktree it belongs to. Returns an empty list if the port is free.',
			inputSchema: {
				port: z.number().int().min(1).max(65535).describe('TCP port to inspect.'),
			},
		},
		async ({port}) => {
			const found = await findByPort(port);
			return text({port, free: found.length === 0, listeners: found.map(summarize)});
		},
	);

	server.registerTool(
		'free_port',
		{
			title: 'Free a port',
			description:
				'Reclaim a port by terminating its listeners (SIGTERM, then SIGKILL on holdouts). SAFETY: by default this refuses to kill non-dev-server processes (e.g. databases) — pass force=true to override. Prefer calling whats_on_port first.',
			inputSchema: {
				port: z.number().int().min(1).max(65535).describe('TCP port to free.'),
				force: z
					.boolean()
					.optional()
					.describe('Allow killing non-dev-server processes (default false).'),
			},
		},
		async ({port, force}) => {
			const targets = await findByPort(port);
			if (targets.length === 0) {
				return text({port, freed: true, killed: [], note: 'Port was already free.'});
			}
			const nonDev = targets.filter(t => !t.isDev);
			if (nonDev.length > 0 && !force) {
				return text({
					port,
					freed: false,
					refused: true,
					reason:
						'Port is held by non-dev-server process(es). Re-run with force=true if you are sure.',
					listeners: nonDev.map(summarize),
				});
			}
			const result = await freePort(port);
			return text({...result, listeners: targets.map(summarize)});
		},
	);

	server.registerTool(
		'kill_process',
		{
			title: 'Kill a process',
			description:
				'Send SIGTERM (or SIGKILL with force=true) to a specific pid. This is the lower-level escape hatch — prefer free_port when you mean "reclaim a port". SAFETY: like free_port, this refuses to kill a pid that is currently listening as a NON-dev-server process (e.g. a database) unless force=true. Processes that are not listening on a port cannot be classified and are signalled as requested.',
			inputSchema: {
				pid: z.number().int().positive().describe('Process id to signal.'),
				force: z
					.boolean()
					.optional()
					.describe('Use SIGKILL and bypass the non-dev-server safety check.'),
			},
		},
		async ({pid, force}) => {
			if (!force) {
				const known = (await scan()).find(p => p.pid === pid);
				if (known && !known.isDev) {
					return text({
						pid,
						killed: false,
						refused: true,
						reason:
							'pid is a non-dev-server listener (e.g. a database). Re-run with force=true if you are sure.',
						process: summarize(known),
					});
				}
			}
			try {
				killProc(pid, force ? 'SIGKILL' : 'SIGTERM');
				return text({pid, killed: true, signal: force ? 'SIGKILL' : 'SIGTERM'});
			} catch (err) {
				return text({pid, killed: false, error: (err as Error).message});
			}
		},
	);

	server.registerTool(
		'wait_for_port',
		{
			title: 'Wait for a port',
			description:
				'Block until a port becomes free or starts listening, or until the timeout elapses. Useful after starting/stopping a server.',
			inputSchema: {
				port: z.number().int().min(1).max(65535),
				target: z
					.enum(['free', 'listen'])
					.optional()
					.describe('Wait for the port to be free (default) or to start listening.'),
				timeout_sec: z.number().int().positive().max(600).optional(),
			},
		},
		async ({port, target, timeout_sec}) => {
			const ok = await waitForPort(port, target ?? 'free', {
				timeoutMs: (timeout_sec ?? 30) * 1000,
			});
			return text({port, target: target ?? 'free', ok, timedOut: !ok});
		},
	);

	return server;
}

/** Entry point for `portwatch mcp`. Logs go to stderr to keep stdout clean. */
export async function runMcp(): Promise<void> {
	const server = buildServer();
	const transport = new StdioServerTransport();
	await server.connect(transport);
	console.error('portwatch MCP server running on stdio');
}
