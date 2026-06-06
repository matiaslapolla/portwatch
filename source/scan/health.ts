import {connect} from 'node:net';
import type {Health} from './types.js';

const PROBE_TIMEOUT_MS = 700;

/**
 * Probe a single port on localhost. We open a TCP connection and send a minimal
 * HTTP request:
 *   - any response bytes        -> "ok"  (something is alive and talking)
 *   - connects but stays silent -> "hung"
 *   - connection refused/reset  -> "closed"
 */
export function probePort(port: number): Promise<Health> {
	return new Promise(resolve => {
		let settled = false;
		const done = (h: Health) => {
			if (settled) return;
			settled = true;
			socket.destroy();
			resolve(h);
		};

		const socket = connect({host: '127.0.0.1', port});
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
export async function probePorts(ports: number[]): Promise<Map<number, Health>> {
	const unique = [...new Set(ports)];
	const results = await Promise.all(
		unique.map(async port => [port, await probePort(port)] as const),
	);
	return new Map(results);
}

function canConnect(host: string, port: number, timeoutMs: number): Promise<boolean> {
	return new Promise(resolve => {
		let settled = false;
		const done = (v: boolean) => {
			if (settled) return;
			settled = true;
			socket.destroy();
			resolve(v);
		};
		const socket = connect({host, port});
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
export async function isListening(port: number, timeoutMs = 300): Promise<boolean> {
	const [v4, v6] = await Promise.all([
		canConnect('127.0.0.1', port, timeoutMs),
		canConnect('::1', port, timeoutMs),
	]);
	return v4 || v6;
}
