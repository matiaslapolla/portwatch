import { connect } from 'node:net';
const PROBE_TIMEOUT_MS = 700;
/**
 * Probe a single port on localhost. We open a TCP connection and send a minimal
 * HTTP request:
 *   - any response bytes        -> "ok"  (something is alive and talking)
 *   - connects but stays silent -> "hung"
 *   - connection refused/reset  -> "closed"
 */
export function probePort(port) {
    return new Promise(resolve => {
        let settled = false;
        const done = (h) => {
            if (settled)
                return;
            settled = true;
            socket.destroy();
            resolve(h);
        };
        const socket = connect({ host: '127.0.0.1', port });
        socket.setTimeout(PROBE_TIMEOUT_MS);
        socket.on('connect', () => {
            socket.write(`GET / HTTP/1.0\r\nHost: localhost:${port}\r\n\r\n`);
        });
        socket.on('data', () => done('ok'));
        socket.on('timeout', () => done('hung'));
        socket.on('error', () => done('closed'));
        socket.on('end', () => done('closed'));
    });
}
/** Probe many ports concurrently, returning port -> health. */
export async function probePorts(ports) {
    const unique = [...new Set(ports)];
    const results = await Promise.all(unique.map(async (port) => [port, await probePort(port)]));
    return new Map(results);
}
function canConnect(host, port, timeoutMs) {
    return new Promise(resolve => {
        let settled = false;
        const done = (v) => {
            if (settled)
                return;
            settled = true;
            socket.destroy();
            resolve(v);
        };
        const socket = connect({ host, port });
        socket.setTimeout(timeoutMs);
        socket.on('connect', () => done(true));
        socket.on('timeout', () => done(false));
        socket.on('error', () => done(false)); // ECONNREFUSED => nothing there
    });
}
/**
 * Cheap liveness check: is anything accepting connections on this port? Probes
 * both IPv4 and IPv6 loopback so a server bound to either is detected. Used by
 * the wait/free poll loops to avoid a full process scan on every tick.
 */
export async function isListening(port, timeoutMs = 300) {
    const [v4, v6] = await Promise.all([
        canConnect('127.0.0.1', port, timeoutMs),
        canConnect('::1', port, timeoutMs),
    ]);
    return v4 || v6;
}
