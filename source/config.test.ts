import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseConfig} from './config.js';
import {parsePort} from './commands.js';

test('parseConfig accepts the "ports" shorthand', () => {
	const cfg = parseConfig('{"ports": [3000, 5432]}');
	assert.deepEqual(
		cfg.expected.map(e => e.port),
		[3000, 5432],
	);
});

test('parseConfig accepts the "expected" long form with names', () => {
	const cfg = parseConfig('{"expected": [{"port": 3000, "name": "web"}, {"port": 8025}]}');
	assert.deepEqual(cfg.expected, [
		{port: 3000, name: 'web'},
		{port: 8025, name: undefined},
	]);
});

test('parseConfig ignores junk entries', () => {
	const cfg = parseConfig('{"ports": ["x", 3000], "other": true}');
	assert.deepEqual(
		cfg.expected.map(e => e.port),
		[3000],
	);
});

test('parsePort accepts plain and colon-prefixed ports, rejects bad input', () => {
	assert.equal(parsePort('3000'), 3000);
	assert.equal(parsePort(':8080'), 8080);
	assert.equal(parsePort('0'), undefined);
	assert.equal(parsePort('70000'), undefined);
	assert.equal(parsePort('abc'), undefined);
	assert.equal(parsePort(undefined), undefined);
});
