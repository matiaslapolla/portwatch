import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
	addressFromSocket,
	etimeToSeconds,
	formatEtime,
	isDev,
	isStale,
	parseDockerPs,
	parseHead,
	parseLsofListeners,
	parsePs,
	parseSsListeners,
	portFromSocket,
} from './parse.js';

test('parseLsofListeners groups sockets by pid', () => {
	const stdout = [
		'p1234',
		'cnode',
		'n*:3000',
		'n127.0.0.1:3001',
		'p5678',
		'cpostgres',
		'n[::1]:5432',
		'',
	].join('\n');

	const map = parseLsofListeners(stdout);
	assert.equal(map.size, 2);
	assert.equal(map.get(1234)?.command, 'node');
	assert.deepEqual([...(map.get(1234)?.sockets ?? [])], ['*:3000', '127.0.0.1:3001']);
	assert.deepEqual([...(map.get(5678)?.sockets ?? [])], ['[::1]:5432']);
});

test('parseSsListeners parses LISTEN rows and skips non-listen', () => {
	const stdout = [
		'LISTEN 0      511          0.0.0.0:3000      0.0.0.0:*    users:(("node",pid=1234,fd=20))',
		'LISTEN 0      4096            [::1]:5432         [::]:*    users:(("postgres",pid=5678,fd=7))',
		'ESTAB  0      0          10.0.0.2:55000   10.0.0.3:443',
		'LISTEN 0      128          0.0.0.0:8080      0.0.0.0:*',
	].join('\n');

	const map = parseSsListeners(stdout);
	assert.equal(map.size, 2, 'ESTAB and process-less LISTEN are skipped');
	assert.equal(map.get(1234)?.command, 'node');
	assert.deepEqual([...(map.get(1234)?.sockets ?? [])], ['0.0.0.0:3000']);
	assert.equal(map.get(5678)?.command, 'postgres');
});

test('parseSsListeners merges a socket shared by two pids', () => {
	const stdout =
		'LISTEN 0 511 0.0.0.0:3000 0.0.0.0:* users:(("node",pid=10,fd=20),("node",pid=11,fd=21))';
	const map = parseSsListeners(stdout);
	assert.deepEqual([...map.keys()], [10, 11]);
});

test('parsePs reads pid/etime/cpu/rss/command with spaces', () => {
	const stdout = [
		' 1234    01:02:03  1.5  204800 next-server (v15.5.18)',
		' 5678       05:00  0.0   10240 node /path/to/server.js --flag x',
	].join('\n');

	const map = parsePs(stdout);
	const a = map.get(1234)!;
	assert.equal(a.cpu, 1.5);
	assert.equal(Math.round(a.rssMb), 200);
	assert.equal(a.uptime, '1h2m');
	assert.equal(a.cmdline, 'next-server (v15.5.18)');

	const b = map.get(5678)!;
	assert.equal(b.uptime, '5m0s');
	assert.equal(b.cmdline, 'node /path/to/server.js --flag x');
});

test('etimeToSeconds handles all ps formats', () => {
	assert.equal(etimeToSeconds('05'), 5);
	assert.equal(etimeToSeconds('01:30'), 90);
	assert.equal(etimeToSeconds('02:03:04'), 7384);
	assert.equal(etimeToSeconds('2-03:00:00'), 2 * 86400 + 3 * 3600);
});

test('formatEtime renders compact durations', () => {
	assert.equal(formatEtime('05'), '5s');
	assert.equal(formatEtime('01:30'), '1m30s');
	assert.equal(formatEtime('02:03:04'), '2h3m');
	assert.equal(formatEtime('2-03:00:00'), '2d3h');
});

test('isDev matches tooling but not random binaries', () => {
	assert.equal(isDev('next-server (v15)', 'node'), true);
	assert.equal(isDev('/usr/bin/python app.py', 'python'), false);
	assert.equal(isDev('vite', 'vite'), true);
	assert.equal(isDev('/opt/foo/bar', 'bun'), true); // bun by command name
});

test('isStale needs both age and idleness', () => {
	assert.equal(isStale(7200, 0.2), true);
	assert.equal(isStale(7200, 40), false, 'busy process is not stale');
	assert.equal(isStale(60, 0), false, 'young process is not stale');
});

test('parseDockerPs maps host ports to container names', () => {
	const stdout = [
		'pg-main\t0.0.0.0:5432->5432/tcp, :::5432->5432/tcp',
		'redis\t0.0.0.0:6379->6379/tcp',
		'web\t8080/tcp', // exposed but not published — no host port
	].join('\n');

	const map = parseDockerPs(stdout);
	assert.equal(map.get(5432), 'pg-main');
	assert.equal(map.get(6379), 'redis');
	assert.equal(map.has(8080), false);
});

test('parseHead reads branch and detached HEAD', () => {
	assert.equal(parseHead('ref: refs/heads/feature/login\n'), 'feature/login');
	assert.equal(parseHead('ref: refs/heads/main'), 'main');
	assert.equal(parseHead('a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0'), 'a1b2c3d');
	assert.equal(parseHead('garbage'), undefined);
});

test('portFromSocket / addressFromSocket split host:port', () => {
	assert.equal(portFromSocket('127.0.0.1:3000'), 3000);
	assert.equal(portFromSocket('[::1]:5432'), 5432);
	assert.equal(portFromSocket('nonsense'), undefined);
	assert.equal(addressFromSocket('127.0.0.1:3000'), '127.0.0.1');
	assert.equal(addressFromSocket('[::1]:5432'), '::1');
	assert.equal(addressFromSocket(':3000'), '*');
});
