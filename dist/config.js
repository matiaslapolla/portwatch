import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
/**
 * Parse `.portwatch` (JSON) content. Supports two shapes:
 *   { "ports": [3000, 5432] }
 *   { "expected": [ {"port": 3000, "name": "web"} ] }
 * Unknown keys are ignored. Throws on invalid JSON so callers can warn.
 */
export function parseConfig(content) {
    const raw = JSON.parse(content);
    const expected = [];
    if (raw && typeof raw === 'object') {
        const obj = raw;
        if (Array.isArray(obj['ports'])) {
            for (const p of obj['ports']) {
                const port = Number(p);
                if (Number.isFinite(port))
                    expected.push({ port });
            }
        }
        if (Array.isArray(obj['expected'])) {
            for (const entry of obj['expected']) {
                if (entry && typeof entry === 'object') {
                    const e = entry;
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
    return { expected };
}
/** Load `.portwatch` from a directory, returning null if absent or invalid. */
export async function loadConfig(dir = process.cwd()) {
    try {
        return parseConfig(await readFile(join(dir, '.portwatch'), 'utf8'));
    }
    catch {
        return null;
    }
}
