import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseDockerPs } from './parse.js';
const run = promisify(execFile);
/**
 * Map host ports to docker container names via `docker ps`. Returns an empty
 * map when docker is absent or the daemon isn't running — never throws.
 */
export async function resolveDocker() {
    try {
        const { stdout } = await run('docker', ['ps', '--format', '{{.Names}}\t{{.Ports}}'], { maxBuffer: 4 * 1024 * 1024, timeout: 2000 });
        return parseDockerPs(stdout);
    }
    catch {
        return new Map();
    }
}
