import React, {useCallback, useEffect, useRef, useState} from 'react';
import {Box, Text, useApp, useInput} from 'ink';
import {killProc, scan, type Health, type Proc} from './scan/index.js';

const REFRESH_MS = 2000;

function padEnd(value: string, width: number): string {
	if (value.length > width) return value.slice(0, width - 1) + '…';
	return value.padEnd(width);
}

function padStart(value: string, width: number): string {
	if (value.length > width) return value.slice(0, width);
	return value.padStart(width);
}

/** Strip a long absolute path to the node/bun/deno binary down to just its name. */
function prettyCmd(cmdline: string): string {
	return cmdline.replace(/^\/\S+\/(node|bun|deno)\b/, '$1');
}

const HEALTH_GLYPH: Record<Health, string> = {
	ok: '●',
	hung: '✗',
	closed: '·',
	unknown: ' ',
};

/** Human label for the project/worktree/docker that owns a row. */
function ownerLabel(row: Proc): string {
	if (row.docker) return `🐳 ${row.docker}`;
	if (row.project && row.branch) return `${row.project} (${row.branch})`;
	return row.project ?? '';
}

export default function App() {
	const {exit} = useApp();
	const [rows, setRows] = useState<Proc[]>([]);
	const [selectedPid, setSelectedPid] = useState<number | null>(null);
	const [showAll, setShowAll] = useState(false);
	const [health, setHealth] = useState(false);
	const [status, setStatus] = useState('Scanning…');
	const [error, setError] = useState<string | null>(null);
	const scanning = useRef(false);

	const visible = rows.filter(row => showAll || row.isDev);
	const selectedIndex = visible.findIndex(row => row.pid === selectedPid);

	const refresh = useCallback(async () => {
		if (scanning.current) return;
		scanning.current = true;
		try {
			setRows(await scan({health}));
			setError(null);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			scanning.current = false;
		}
	}, [health]);

	useEffect(() => {
		void refresh();
		const id = setInterval(() => void refresh(), REFRESH_MS);
		return () => clearInterval(id);
	}, [refresh]);

	// Keep the selection pointed at a row that still exists.
	useEffect(() => {
		if (visible.length === 0) {
			if (selectedPid !== null) setSelectedPid(null);
			return;
		}
		if (selectedPid === null || !visible.some(row => row.pid === selectedPid)) {
			setSelectedPid(visible[0].pid);
		}
	}, [visible, selectedPid]);

	const move = (delta: number) => {
		if (visible.length === 0) return;
		const idx = selectedIndex < 0 ? 0 : selectedIndex;
		const next = (idx + delta + visible.length) % visible.length;
		setSelectedPid(visible[next].pid);
	};

	const kill = (target: Proc, signal: 'SIGTERM' | 'SIGKILL') => {
		try {
			killProc(target.pid, signal);
			setStatus(
				`${signal} → ${ownerLabel(target) || target.command} (pid ${target.pid}) on :${target.ports.join(',')}`,
			);
			setTimeout(() => void refresh(), 300);
		} catch (err) {
			setStatus(`Failed to kill ${target.pid}: ${err instanceof Error ? err.message : String(err)}`);
		}
	};

	useInput((input, key) => {
		if (input === 'q' || (key.ctrl && input === 'c')) return exit();
		if (key.upArrow) return move(-1);
		if (key.downArrow) return move(1);
		if (input === 'a') return setShowAll(value => !value);
		if (input === 'h') return setHealth(value => !value);
		if (input === 'r') {
			setStatus('Refreshing…');
			return void refresh();
		}

		if (input === 'k' || input === 'x') {
			const target = visible[selectedIndex];
			if (target) kill(target, input === 'x' ? 'SIGKILL' : 'SIGTERM');
		}
	});

	return (
		<Box flexDirection="column" paddingX={1}>
			<Box justifyContent="space-between">
				<Text bold color="cyan">
					portwatch
				</Text>
				<Text color="gray">
					{showAll ? 'all listeners' : 'dev servers'} · {visible.length} shown
					{health ? ' · health on' : ''}
				</Text>
			</Box>

			<Box marginTop={1}>
				<Text bold color="gray">
					{'  '}
					{padEnd(' PORT', 8)}
					{padEnd('PID', 8)}
					{padStart('CPU%', 6)}
					{'  '}
					{padStart('MEM', 7)}
					{'  '}
					{padEnd('UPTIME', 8)}
					COMMAND
				</Text>
			</Box>

			{visible.length === 0 && (
				<Text color="gray">
					{error ? `Error: ${error}` : 'Nothing listening. Press a to show all, r to refresh.'}
				</Text>
			)}

			{visible.map(row => {
				const selected = row.pid === selectedPid;
				const owner = ownerLabel(row);
				const glyph = health ? HEALTH_GLYPH[row.health ?? 'unknown'] : ' ';
				const marker = row.stale ? '⚠' : glyph;
				const command = owner ? `${owner}  ${prettyCmd(row.cmdline)}` : prettyCmd(row.cmdline);
				const line =
					(selected ? '❯' : ' ') +
					marker +
					padEnd(row.ports.join(','), 8) +
					padEnd(String(row.pid), 8) +
					padStart(row.cpu.toFixed(0), 6) +
					'  ' +
					padStart(`${row.rssMb.toFixed(0)}M`, 7) +
					'  ' +
					padEnd(row.uptime, 8) +
					command;

				const color = selected
					? 'black'
					: row.health === 'hung'
						? 'red'
						: row.stale
							? 'yellow'
							: row.isDev
								? undefined
								: 'gray';

				return (
					<Text
						key={row.pid}
						wrap="truncate-end"
						color={color}
						backgroundColor={selected ? 'cyan' : undefined}
					>
						{line}
					</Text>
				);
			})}

			<Box marginTop={1} flexDirection="column">
				<Text color="gray">{status}</Text>
				<Text color="gray">
					<Text color="white">↑/↓</Text> move{'  '}
					<Text color="white">k</Text> kill{'  '}
					<Text color="white">x</Text> force{'  '}
					<Text color="white">h</Text> health{'  '}
					<Text color="white">a</Text> {showAll ? 'dev only' : 'all'}
					{'  '}
					<Text color="white">r</Text> refresh{'  '}
					<Text color="white">q</Text> quit
				</Text>
			</Box>
		</Box>
	);
}
