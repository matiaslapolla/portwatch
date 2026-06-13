import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseLsofListeners } from './parse.js';
const run = promisify(execFile);
const MAX_BUFFER = 8 * 1024 * 1024;
/** Best-effort run that returns whatever stdout we got, even on non-zero exit. */
async function softRun(cmd, args) {
    try {
        const { stdout } = await run(cmd, args, { maxBuffer: MAX_BUFFER });
        return stdout;
    }
    catch (err) {
        // lsof exits non-zero when nothing is listening; partial stdout is still useful.
        return err?.stdout ?? '';
    }
}
/** List listening TCP sockets on macOS via lsof. */
export async function listListeners() {
    const stdout = await softRun('lsof', [
        '-nP',
        '-iTCP',
        '-sTCP:LISTEN',
        '-F',
        'pcn',
    ]);
    return parseLsofListeners(stdout);
}
/** Resolve working directories for the given pids in a single batched lsof call. */
export async function resolveCwds(pids) {
    const map = new Map();
    if (pids.length === 0)
        return map;
    const stdout = await softRun('lsof', [
        '-a',
        '-d',
        'cwd',
        '-Fn',
        '-p',
        pids.join(','),
    ]);
    let current;
    for (const line of stdout.split('\n')) {
        if (!line)
            continue;
        const tag = line[0];
        const value = line.slice(1);
        if (tag === 'p')
            current = Number(value);
        else if (tag === 'n' && current !== undefined)
            map.set(current, value);
    }
    return map;
}
