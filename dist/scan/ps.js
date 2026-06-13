import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parsePs } from './parse.js';
const run = promisify(execFile);
/**
 * Enrich pids with full command line, CPU, memory and uptime via one `ps` call.
 * The `-o key=` form (no headers) is portable across macOS and Linux procps.
 */
export async function enrichPs(pids) {
    if (pids.length === 0)
        return new Map();
    let stdout = '';
    try {
        ({ stdout } = await run('ps', ['-o', 'pid=,etime=,%cpu=,rss=,command=', '-p', pids.join(',')], { maxBuffer: 8 * 1024 * 1024 }));
    }
    catch (err) {
        stdout = err?.stdout ?? '';
    }
    return parsePs(stdout);
}
