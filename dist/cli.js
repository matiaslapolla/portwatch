#!/usr/bin/env node
import { jsx as _jsx } from "react/jsx-runtime";
import { render } from 'ink';
import App from './app.js';
import { cmdFree, cmdKill, cmdList, cmdWait } from './commands.js';
import { runMcp } from './mcp.js';
const HELP = `portwatch — watch, free and kill the processes holding your local ports

Usage:
  portwatch                 Interactive TUI (dev servers by default)
  portwatch free <port>     Terminate whatever is listening on a port
  portwatch kill <port|pid> Kill by port or pid        (--force = SIGKILL)
  portwatch wait <port>     Block until a port is free (--for=listen to invert)
  portwatch ports           One-shot list of listeners (--json, --health)
  portwatch mcp             Run as an MCP server over stdio (for AI agents)

Flags:
  --force            kill: send SIGKILL instead of SIGTERM
  --for=free|listen  wait: what to wait for (default free)
  --timeout=<sec>    wait: give up after N seconds (default 30)
  --json             ports: machine-readable output
  --health           ports: probe each port (ok/hung/closed)
  -h, --help         show this help

TUI keys:  ↑/↓ move   k kill   x force-kill   a all/dev   h health   r refresh   q quit`;
function flag(args, name) {
    return args.includes(`--${name}`);
}
function option(args, name) {
    const prefix = `--${name}=`;
    const hit = args.find(a => a.startsWith(prefix));
    return hit?.slice(prefix.length);
}
async function main() {
    const args = process.argv.slice(2);
    if (flag(args, 'help') || args.includes('-h')) {
        console.log(HELP);
        return;
    }
    const [command, positional] = args.filter(a => !a.startsWith('-'));
    switch (command) {
        case 'free':
            process.exitCode = await cmdFree(positional);
            return;
        case 'kill':
            process.exitCode = await cmdKill(positional, flag(args, 'force'));
            return;
        case 'wait': {
            const rawFor = option(args, 'for');
            if (rawFor !== undefined && rawFor !== 'free' && rawFor !== 'listen') {
                console.error("Invalid --for: expected 'free' or 'listen'.");
                process.exitCode = 2;
                return;
            }
            const rawTimeout = option(args, 'timeout');
            const timeoutSec = rawTimeout === undefined ? 30 : Number(rawTimeout);
            if (!Number.isFinite(timeoutSec) || timeoutSec <= 0) {
                console.error('Invalid --timeout: expected a positive number of seconds.');
                process.exitCode = 2;
                return;
            }
            const target = rawFor === 'listen' ? 'listen' : 'free';
            process.exitCode = await cmdWait(positional, { target, timeoutSec });
            return;
        }
        case 'ports':
            process.exitCode = await cmdList({
                json: flag(args, 'json'),
                health: flag(args, 'health'),
            });
            return;
        case 'mcp':
            await runMcp();
            return;
        default:
            break;
    }
    // Back-compat one-shot flags with no subcommand.
    if (flag(args, 'json') || flag(args, 'once')) {
        process.exitCode = await cmdList({
            json: flag(args, 'json'),
            health: flag(args, 'health'),
        });
        return;
    }
    render(_jsx(App, {}));
}
main().catch(err => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
});
