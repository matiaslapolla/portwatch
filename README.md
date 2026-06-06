# portwatch

[![npm](https://img.shields.io/npm/v/portwatch.svg)](https://www.npmjs.com/package/portwatch)
[![CI](https://github.com/matiaslapolla/portwatch/actions/workflows/ci.yml/badge.svg)](https://github.com/matiaslapolla/portwatch/actions/workflows/ci.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

Watch, free and kill the processes holding your local ports — built for the era of
AI/agentic coding, where your editor's agents spawn `next dev` / `vite` / MCP servers
faster than you can clean them up.

portwatch scans listening TCP sockets, tells you **which project and git worktree** each
one belongs to, flags **stale/orphaned** servers, resolves **docker** containers, and lets
you reclaim a port in one keystroke — or one command, or one MCP tool call from your agent.

```
  PORT   PID     CPU%    MEM   UPTIME  COMMAND
❯ 3000   67775    0.1%  120M   23h37m  web (main)          next-server   ⚠
  4322   48901    0.4%   95M    2h10m  api (feat/auth)     astro dev
  5432   13502    0.0%  210M     3d4h  🐳 postgres         docker
  6006   71204   12.0%  340M      45s  ui-kit (main)       storybook

  k kill   x force   h health   a all/dev   q quit
```

## Why

In agentic workflows the pain isn't one stale `:3000` — it's *fleets* of them:

- Agents start dev servers to test their work and don't always clean up.
- Parallel agents in **git worktrees** each grab a port → collisions and identical
  `next dev` rows you can't tell apart.
- An agent that needs `:3000` either drifts to a random port or blindly
  `kill -9`s whatever `lsof` returns (goodbye, Postgres).

portwatch gives **humans and agents** a safe, structured view and control of local ports.

## Install

```sh
# zero-install (recommended)
npx portwatch                 # interactive TUI
npx portwatch free 3000       # reclaim a port

# or global
npm i -g portwatch
```

Requires Node ≥ 18. Works on **macOS** and **Linux** (incl. WSL). Native Windows isn't
supported yet — run it inside WSL.

## Commands

```sh
portwatch                  # interactive TUI (dev servers by default)
portwatch free <port>      # SIGTERM listeners, then SIGKILL holdouts
portwatch kill <port|pid>  # kill by port or pid          (--force = SIGKILL)
portwatch wait <port>      # block until free   (--for=listen, --timeout=<sec> default 30)
portwatch ports            # one-shot list                 (--json, --health)
portwatch mcp              # run as an MCP server over stdio (for AI agents)
```

All commands return meaningful exit codes (0 success, 1 failure, 2 usage), so they drop
straight into `package.json` scripts and CI:

```jsonc
{
  "scripts": {
    "predev": "portwatch free 3000",      // always start on a clean :3000
    "dev": "next dev"
  }
}
```

### TUI keys

| Key   | Action                          |
| ----- | ------------------------------- |
| ↑ / ↓ | move selection                  |
| `k`   | kill selected (SIGTERM)         |
| `x`   | force kill (SIGKILL)            |
| `h`   | toggle health probe column      |
| `a`   | toggle dev-only / all listeners |
| `r`   | refresh now                     |
| `q`   | quit                            |

The list auto-refreshes every 2s. Stale (old + idle) servers are flagged `⚠`; with `h`
on, each port is probed: `●` responding, `✗` hung, `·` closed.

## Use it from your AI agent (MCP)

`portwatch mcp` exposes a [Model Context Protocol](https://modelcontextprotocol.io) server
over stdio so coding agents can inspect and reclaim ports safely instead of shelling out to
`lsof | grep | kill -9`.

**Tools:** `list_ports`, `whats_on_port`, `free_port`, `kill_process`, `wait_for_port`.
Both `free_port` and `kill_process` refuse to terminate a non-dev-server listener
(databases, etc.) unless called with `force: true` — so an agent can't accidentally nuke
your Postgres.

### Claude Code

```sh
claude mcp add portwatch -- npx -y portwatch mcp
```

### Cursor — `.cursor/mcp.json`

```json
{
  "mcpServers": {
    "portwatch": { "command": "npx", "args": ["-y", "portwatch", "mcp"] }
  }
}
```

### Codex — `~/.codex/config.toml`

```toml
[mcp_servers.portwatch]
command = "npx"
args = ["-y", "portwatch", "mcp"]
```

## Project & worktree awareness

Each listener is mapped to the process's working directory, then to the nearest
`package.json` name, git repo, branch, and — for linked **git worktrees** — the worktree
label. That's what lets you tell five identical `next dev` rows apart when several agents
are running in parallel worktrees.

## `.portwatch` (optional)

Drop a `.portwatch` file in a repo to declare the ports it expects. `portwatch ports` then
reports (on stderr) which expected ports are and aren't currently listening:

```
.portwatch:
  :3000 (web) — ✓ listening
  :5432 (postgres) — ✗ not listening
```

See [`.portwatch.example`](./.portwatch.example):

```json
{ "expected": [{ "port": 3000, "name": "web" }, { "port": 5432, "name": "postgres" }] }
```

## How it works

- **Listeners:** `lsof` on macOS, `ss` (falling back to `lsof`) on Linux.
- **Process detail:** a single `ps` call for full command line, CPU, memory, uptime.
- **Ownership:** the process `cwd` (`lsof`/`/proc`) resolved to project/repo/branch/worktree.
- **Docker:** `docker ps` maps published host ports to container names.
- **Health:** a short HTTP probe per port (opt-in).

Detection of "dev server" is heuristic (node/deno/bun/next/vite/astro/etc.); press `a` (or
pass nothing to `list_ports`) to see everything. Killing only works for processes you own —
no `sudo` — which covers all your dev servers.

## Development

```sh
npm install
npm run build      # tsc → dist/
npm test           # node:test, pure parsers + project resolution
npm start          # run the built TUI
```

Stack: [Ink](https://github.com/vadimdemedes/ink) (React for the terminal) + TypeScript +
[`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol/typescript-sdk).

## License

MIT
