import {readFile} from 'node:fs/promises';
import {join} from 'node:path';

/** A single declared service in a `.portwatch` file. */
export type ExpectedService = {
	port: number;
	name?: string;
};

export type PortwatchConfig = {
	expected: ExpectedService[];
};

/**
 * Parse `.portwatch` (JSON) content. Supports two shapes:
 *   { "ports": [3000, 5432] }
 *   { "expected": [ {"port": 3000, "name": "web"} ] }
 * Unknown keys are ignored. Throws on invalid JSON so callers can warn.
 */
export function parseConfig(content: string): PortwatchConfig {
	const raw = JSON.parse(content) as unknown;
	const expected: ExpectedService[] = [];

	if (raw && typeof raw === 'object') {
		const obj = raw as Record<string, unknown>;
		if (Array.isArray(obj['ports'])) {
			for (const p of obj['ports']) {
				const port = Number(p);
				if (Number.isFinite(port)) expected.push({port});
			}
		}
		if (Array.isArray(obj['expected'])) {
			for (const entry of obj['expected']) {
				if (entry && typeof entry === 'object') {
					const e = entry as Record<string, unknown>;
					const port = Number(e['port']);
					if (Number.isFinite(port)) {
						expected.push({
							port,
							name: typeof e['name'] === 'string' ? e['name'] : undefined,
						});
					}
				}
			}
		}
	}

	return {expected};
}

/** Load `.portwatch` from a directory, returning null if absent or invalid. */
export async function loadConfig(
	dir: string = process.cwd(),
): Promise<PortwatchConfig | null> {
	try {
		return parseConfig(await readFile(join(dir, '.portwatch'), 'utf8'));
	} catch {
		return null;
	}
}
