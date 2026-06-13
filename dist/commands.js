import { loadConfig } from './config.js';
import { findByPort, freePort, killProc, scan, waitForPort, } from './scan/index.js';
/** Parse a "3000" or ":3000" style argument into a port number. */
export function parsePort(arg) {
    if (!arg)
        return undefined;
    const port = Number(arg.replace(/^:/, ''));
    return Number.isInteger(port) && port > 0 && port < 65536 ? port : undefined;
}
function labelFor(proc) {
    if (proc.project && proc.branch)
        return `${proc.project} (${proc.branch})`;
    return proc.project ?? proc.command;
}
/** `portwatch free <port>` — terminate everything listening on a port. */
export async function cmdFree(arg) {
    const port = parsePort(arg);
    if (port === undefined) {
        console.error('Usage: portwatch free <port>');
        return 2;
    }
    const result = await freePort(port);
    if (result.killed.length === 0) {
        console.log(`:${port} was already free.`);
        return 0;
    }
    const how = result.forced ? 'SIGKILL' : 'SIGTERM';
    if (result.freed) {
        console.log(`Freed :${port} — ${how} → pid ${result.killed.join(', ')}.`);
        return 0;
    }
    console.error(`Could not free :${port} (pid ${result.killed.join(', ')} survived).`);
    return 1;
}
/** `portwatch kill <port|pid>` — kill by port or by pid. */
export async function cmdKill(arg, force = false) {
    const port = parsePort(arg);
    const signal = force ? 'SIGKILL' : 'SIGTERM';
    if (port !== undefined) {
        const targets = await findByPort(port);
        if (targets.length === 0) {
            console.log(`Nothing listening on :${port}.`);
            return 0;
        }
        for (const proc of targets) {
            killProc(proc.pid, signal);
            console.log(`${signal} → ${labelFor(proc)} (pid ${proc.pid}) on :${port}`);
        }
        return 0;
    }
    const pid = Number(arg);
    if (Number.isInteger(pid) && pid > 0) {
        try {
            killProc(pid, signal);
            console.log(`${signal} → pid ${pid}`);
            return 0;
        }
        catch (err) {
            console.error(`Failed to kill ${pid}: ${err.message}`);
            return 1;
        }
    }
    console.error('Usage: portwatch kill <port|pid> [--force]');
    return 2;
}
/** `portwatch wait <port> [--for=free|listen] [--timeout=30]` */
export async function cmdWait(arg, opts) {
    const port = parsePort(arg);
    if (port === undefined) {
        console.error('Usage: portwatch wait <port> [--for=free|listen] [--timeout=30]');
        return 2;
    }
    const ok = await waitForPort(port, opts.target, {
        timeoutMs: opts.timeoutSec * 1000,
    });
    if (ok) {
        console.log(`:${port} is now ${opts.target === 'free' ? 'free' : 'listening'}.`);
        return 0;
    }
    console.error(`Timed out after ${opts.timeoutSec}s waiting for :${port} to be ${opts.target}.`);
    return 1;
}
/**
 * Compare a `.portwatch` config (if present) against what's actually listening,
 * writing a short diagnostic to stderr so stdout stays a clean, pipeable table.
 */
async function reportConfig(listening) {
    const cfg = await loadConfig();
    if (!cfg || cfg.expected.length === 0)
        return;
    console.error('.portwatch:');
    for (const svc of cfg.expected) {
        const name = svc.name ? ` (${svc.name})` : '';
        const state = listening.has(svc.port) ? '✓ listening' : '✗ not listening';
        console.error(`  :${svc.port}${name} — ${state}`);
    }
}
/** `portwatch ports` / `--once` — one-shot table of listeners. */
export async function cmdList(opts = {}) {
    const rows = await scan({ health: opts.health });
    if (opts.json) {
        console.log(JSON.stringify(rows, null, 2));
        return 0;
    }
    for (const row of rows) {
        const tags = [
            row.docker ? `docker:${row.docker}` : '',
            row.worktree ? `wt:${row.worktree}` : '',
            row.stale ? 'stale' : '',
            row.health && row.health !== 'unknown' ? row.health : '',
        ]
            .filter(Boolean)
            .join(' ');
        console.log(`:${row.ports.join(',')}\t${row.pid}\t${labelFor(row)}\t${row.cmdline}${tags ? `\t[${tags}]` : ''}`);
    }
    await reportConfig(new Set(rows.flatMap(r => r.ports)));
    return 0;
}
