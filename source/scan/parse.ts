import type {Listener, PsInfo} from './types.js';

// Tooling we treat as a "dev server" by default. Matched against the full command line.
const DEV_RE =
	/\b(node|deno|bun|next|vite|nuxt|npm|pnpm|yarn|webpack|esbuild|turbo|turbopack|remix|astro|gatsby|nodemon|ts-node|tsx|rollup|parcel|storybook|wrangler|rsbuild|rspack|expo|metro|sst)\b/i;

/** Decide whether a process looks like a dev server / JS tooling. */
export function isDev(cmdline: string, command: string): boolean {
	return DEV_RE.test(cmdline) || /node|deno|bun/i.test(command);
}

// A process is "stale" (probably an orphan) when it is old and idle.
export const STALE_AGE_SECONDS = 60 * 60; // 1h
export const STALE_MAX_CPU = 1; // %

/** Flag long-lived, idle listeners as probable orphans. */
export function isStale(uptimeSeconds: number, cpu: number): boolean {
	return uptimeSeconds >= STALE_AGE_SECONDS && cpu <= STALE_MAX_CPU;
}

/**
 * Parse `lsof -F pcn` machine output into pid -> {command, sockets}.
 * Fields: `p`<pid>, `c`<command>, `n`<addr:port>.
 */
export function parseLsofListeners(stdout: string): Map<number, Listener> {
	const procs = new Map<number, Listener>();
	let current: Listener | undefined;

	for (const line of stdout.split('\n')) {
		if (!line) continue;
		const tag = line[0];
		const value = line.slice(1);
		if (tag === 'p') {
			current = {command: '', sockets: new Set()};
			procs.set(Number(value), current);
		} else if (tag === 'c' && current) {
			current.command = value;
		} else if (tag === 'n' && current) {
			current.sockets.add(value);
		}
	}

	return procs;
}

const SS_USER_RE = /\("([^"]*)",pid=(\d+),fd=\d+\)/g;

/**
 * Parse `ss -tlnpH` (TCP, listening, numeric, with process, no header) into
 * pid -> {command, sockets}. A single socket may list multiple pids.
 *
 * Example line:
 *   LISTEN 0 511 0.0.0.0:3000 0.0.0.0:* users:(("node",pid=1234,fd=20))
 */
export function parseSsListeners(stdout: string): Map<number, Listener> {
	const procs = new Map<number, Listener>();

	for (const raw of stdout.split('\n')) {
		const line = raw.trim();
		if (!line) continue;
		const cols = line.split(/\s+/);
		// State Recv-Q Send-Q Local Peer [users:(...)]
		if (cols[0] !== 'LISTEN') continue;
		const local = cols[3];
		if (!local) continue;

		const usersIdx = line.indexOf('users:(');
		const usersPart = usersIdx === -1 ? '' : line.slice(usersIdx);

		// Each user entry: ("name",pid=N,fd=M). Listeners with no resolvable
		// process info (no permission) are skipped — we can't act on them anyway.
		for (const m of usersPart.matchAll(SS_USER_RE)) {
			const command = m[1];
			const pid = Number(m[2]);
			const entry = procs.get(pid) ?? {command, sockets: new Set<string>()};
			if (!entry.command) entry.command = command;
			entry.sockets.add(local);
			procs.set(pid, entry);
		}
	}

	return procs;
}

/**
 * Parse `ps -o pid=,etime=,%cpu=,rss=,command=` output into pid -> PsInfo.
 * The command column is last and may contain spaces.
 */
export function parsePs(stdout: string): Map<number, PsInfo> {
	const map = new Map<number, PsInfo>();
	for (const line of stdout.split('\n')) {
		const m = line.trim().match(/^(\d+)\s+(\S+)\s+(\S+)\s+(\d+)\s+(.*)$/);
		if (!m) continue;
		map.set(Number(m[1]), {
			uptime: formatEtime(m[2]),
			uptimeSeconds: etimeToSeconds(m[2]),
			cpu: Number(m[3]),
			rssMb: Number(m[4]) / 1024,
			cmdline: m[5],
		});
	}
	return map;
}

/** Parse ps etime ([[dd-]hh:]mm:ss) into total seconds. */
export function etimeToSeconds(etime: string): number {
	let days = 0;
	let rest = etime;
	if (rest.includes('-')) {
		const [d, r] = rest.split('-');
		days = Number(d);
		rest = r ?? '';
	}
	const parts = rest.split(':').map(Number);
	let h = 0;
	let m = 0;
	let s = 0;
	if (parts.length === 3) [h, m, s] = parts;
	else if (parts.length === 2) [m, s] = parts;
	else [s] = parts;
	return days * 86400 + h * 3600 + m * 60 + s;
}

/** Convert ps etime to a compact human string, e.g. "1h23m". */
export function formatEtime(etime: string): string {
	const total = etimeToSeconds(etime);
	const days = Math.floor(total / 86400);
	const h = Math.floor((total % 86400) / 3600);
	const m = Math.floor((total % 3600) / 60);
	const s = total % 60;
	if (days) return `${days}d${h}h`;
	if (h) return `${h}h${m}m`;
	if (m) return `${m}m${s}s`;
	return `${s}s`;
}

const DOCKER_HOST_PORT_RE = /(?:\d{1,3}(?:\.\d{1,3}){3}|\[?::\]?|\*)?:(\d+)->/g;

/**
 * Parse `docker ps --format "{{.Names}}\t{{.Ports}}"` into host port -> container.
 * Port mappings look like "0.0.0.0:5432->5432/tcp, :::5432->5432/tcp".
 */
export function parseDockerPs(stdout: string): Map<number, string> {
	const map = new Map<number, string>();
	for (const line of stdout.split('\n')) {
		if (!line.trim()) continue;
		const tab = line.indexOf('\t');
		if (tab === -1) continue;
		const name = line.slice(0, tab).trim();
		const portsField = line.slice(tab + 1);
		for (const m of portsField.matchAll(DOCKER_HOST_PORT_RE)) {
			map.set(Number(m[1]), name);
		}
	}
	return map;
}

/** Extract the current branch from a git HEAD file's contents. */
export function parseHead(content: string): string | undefined {
	const line = content.trim();
	const ref = line.match(/^ref:\s*refs\/heads\/(.+)$/);
	if (ref) return ref[1];
	if (/^[0-9a-f]{7,40}$/.test(line)) return line.slice(0, 7); // detached HEAD
	return undefined;
}

/** Extract the port number from a host:port socket string, ignoring the address. */
export function portFromSocket(socket: string): number | undefined {
	const idx = socket.lastIndexOf(':');
	if (idx === -1) return undefined;
	const port = Number(socket.slice(idx + 1));
	return Number.isFinite(port) ? port : undefined;
}

/** Extract the bare address from a host:port socket string. */
export function addressFromSocket(socket: string): string {
	const idx = socket.lastIndexOf(':');
	const addr = idx === -1 ? socket : socket.slice(0, idx);
	return addr.replace(/^\[|\]$/g, '') || '*';
}
