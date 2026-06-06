/** Result of an HTTP/TCP health probe against a listening port. */
export type Health = 'ok' | 'hung' | 'closed' | 'unknown';

/** One listening process, enriched with everything portwatch knows about it. */
export type Proc = {
	pid: number;
	command: string; // short command name from lsof/ss
	cmdline: string; // full command line from ps
	ports: number[];
	addresses: string[];
	cpu: number; // %CPU
	rssMb: number; // resident memory, MB
	uptime: string; // human-readable, e.g. "1h23m"
	uptimeSeconds: number; // raw, for stale detection
	isDev: boolean; // looks like a dev server / JS tooling
	stale: boolean; // old + idle, probably an orphan

	// Enrichment — all optional, populated best-effort.
	cwd?: string; // working directory of the process
	project?: string; // package.json "name" near cwd, else repo dir name
	repoRoot?: string; // git toplevel containing cwd
	branch?: string; // current git branch
	worktree?: string; // label when cwd is a linked git worktree
	docker?: string; // container name when the port is docker-published
	health?: Health; // result of an HTTP probe (only when requested)
};

/** Raw listener as parsed from lsof/ss, before ps/cwd/docker enrichment. */
export type Listener = {
	command: string;
	sockets: Set<string>; // "addr:port" strings
};

/** CPU/memory/uptime/cmdline parsed from a single `ps` call. */
export type PsInfo = {
	cpu: number;
	rssMb: number;
	uptime: string;
	uptimeSeconds: number;
	cmdline: string;
};

export type Signal = 'SIGTERM' | 'SIGKILL';
