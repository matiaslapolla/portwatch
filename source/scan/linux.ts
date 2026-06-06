import {execFile} from 'node:child_process';
import {readlink} from 'node:fs/promises';
import {promisify} from 'node:util';
import type {Listener} from './types.js';
import {parseLsofListeners, parseSsListeners} from './parse.js';

const run = promisify(execFile);
const MAX_BUFFER = 8 * 1024 * 1024;

async function softRun(cmd: string, args: string[]): Promise<string | null> {
	try {
		const {stdout} = await run(cmd, args, {maxBuffer: MAX_BUFFER});
		return stdout;
	} catch (err) {
		const e = err as {stdout?: string; code?: string};
		// ENOENT means the tool isn't installed — signal that to the caller.
		if (e.code === 'ENOENT') return null;
		return e.stdout ?? '';
	}
}

/**
 * List listening TCP sockets on Linux. Prefers `ss` (iproute2, almost always
 * present); falls back to `lsof` when ss is unavailable.
 */
export async function listListeners(): Promise<Map<number, Listener>> {
	const ss = await softRun('ss', ['-tlnpH']);
	if (ss !== null) return parseSsListeners(ss);

	const lsof = await softRun('lsof', [
		'-nP',
		'-iTCP',
		'-sTCP:LISTEN',
		'-F',
		'pcn',
	]);
	if (lsof !== null) return parseLsofListeners(lsof);

	return new Map();
}

/** Resolve working directories by reading /proc/<pid>/cwd symlinks. */
export async function resolveCwds(pids: number[]): Promise<Map<number, string>> {
	const map = new Map<number, string>();
	await Promise.all(
		pids.map(async pid => {
			try {
				map.set(pid, await readlink(`/proc/${pid}/cwd`));
			} catch {
				// Process gone or not readable; skip.
			}
		}),
	);
	return map;
}
