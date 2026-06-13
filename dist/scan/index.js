import * as darwin from './darwin.js';
import * as linux from './linux.js';
import { enrichPs } from './ps.js';
import { resolveDocker } from './docker.js';
import { resolveProject } from './project.js';
import { isListening, probePorts } from './health.js';
import { addressFromSocket, isDev, isStale, portFromSocket, } from './parse.js';
export { STALE_AGE_SECONDS } from './parse.js';
function pickBackend() {
    if (process.platform === 'linux')
        return linux;
    if (process.platform === 'win32') {
        throw new Error('portwatch does not support Windows natively yet — run it inside WSL.');
    }
    return darwin; // macOS and other BSD-like platforms
}
/** Scan all listening TCP ports and return one enriched row per process. */
export async function scan(opts = {}) {
    const backend = pickBackend();
    const listeners = await backend.listListeners();
    const pids = [...listeners.keys()];
    const [psInfo, cwds, docker] = await Promise.all([
        enrichPs(pids),
        backend.resolveCwds(pids),
        resolveDocker(),
    ]);
    // Resolve each distinct working directory only once.
    const uniqueCwds = [...new Set([...cwds.values()])];
    const projects = new Map(await Promise.all(uniqueCwds.map(async (cwd) => [cwd, await resolveProject(cwd)])));
    const rows = [];
    for (const [pid, { command, sockets }] of listeners) {
        const ports = new Set();
        const addresses = new Set();
        for (const socket of sockets) {
            const port = portFromSocket(socket);
            if (port === undefined)
                continue;
            ports.add(port);
            addresses.add(addressFromSocket(socket));
        }
        if (ports.size === 0)
            continue;
        const ps = psInfo.get(pid);
        const cmdline = ps?.cmdline ?? command;
        const cpu = ps?.cpu ?? 0;
        const uptimeSeconds = ps?.uptimeSeconds ?? 0;
        const cwd = cwds.get(pid);
        const project = cwd ? projects.get(cwd) : undefined;
        const sortedPorts = [...ports].sort((a, b) => a - b);
        const dockerName = sortedPorts
            .map(p => docker.get(p))
            .find((name) => Boolean(name));
        rows.push({
            pid,
            command,
            cmdline,
            ports: sortedPorts,
            addresses: [...addresses],
            cpu,
            rssMb: ps?.rssMb ?? 0,
            uptime: ps?.uptime ?? '',
            uptimeSeconds,
            isDev: isDev(cmdline, command),
            stale: isStale(uptimeSeconds, cpu),
            cwd,
            project: project?.project,
            repoRoot: project?.repoRoot,
            branch: project?.branch,
            worktree: project?.worktree,
            docker: dockerName,
        });
    }
    if (opts.health) {
        const health = await probePorts(rows.flatMap(r => r.ports));
        for (const row of rows) {
            row.health = row.ports.map(p => health.get(p)).find(Boolean) ?? 'unknown';
        }
    }
    rows.sort((a, b) => a.ports[0] - b.ports[0]);
    return rows;
}
/** Return the processes currently listening on a given port. */
export async function findByPort(port) {
    const rows = await scan();
    return rows.filter(row => row.ports.includes(port));
}
/** Send a signal to a process. Throws on permission errors or missing pid. */
export function killProc(pid, signal = 'SIGTERM') {
    process.kill(pid, signal);
}
/** True when the pid is still alive (signal 0 probes without killing). */
export function isAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch (err) {
        // EPERM means it exists but we can't signal it; ESRCH means it's gone.
        return err.code === 'EPERM';
    }
}
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
/**
 * Free a port: SIGTERM every listener, wait for them to exit, then SIGKILL any
 * that hold on. Resolves even if the port was already free (killed: []).
 */
export async function freePort(port, opts = {}) {
    const graceMs = opts.graceMs ?? 1500;
    const targets = await findByPort(port);
    const killed = [];
    let forced = false;
    for (const proc of targets) {
        try {
            killProc(proc.pid, 'SIGTERM');
            killed.push(proc.pid);
        }
        catch {
            // Already gone or not ours.
        }
    }
    const start = Date.now();
    while (killed.some(isAlive) && Date.now() - start < graceMs) {
        await sleep(100);
    }
    for (const pid of killed) {
        if (isAlive(pid)) {
            try {
                killProc(pid, 'SIGKILL');
                forced = true;
            }
            catch {
                // best effort
            }
        }
    }
    await sleep(150);
    const freed = !(await isListening(port));
    return { port, killed, freed, forced };
}
/**
 * Block until a port reaches the desired state or the timeout elapses.
 * Returns true on success, false on timeout.
 */
export async function waitForPort(port, target = 'free', opts = {}) {
    const timeoutMs = opts.timeoutMs ?? 30000;
    const intervalMs = opts.intervalMs ?? 250;
    const start = Date.now();
    for (;;) {
        // Cheap TCP probe — no lsof/ps/docker per tick.
        const listening = await isListening(port);
        if (target === 'free' && !listening)
            return true;
        if (target === 'listen' && listening)
            return true;
        if (Date.now() - start >= timeoutMs)
            return false;
        await sleep(intervalMs);
    }
}
