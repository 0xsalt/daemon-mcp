# daemon-mcp

**UL Community Daemon Registry** - An MCP server for the [Daemon](https://github.com/danielmiessler/Daemon) ecosystem.

Query personal daemons, discover the community network, and announce your own daemon to the registry.

**Author:** [Swift](https://daemon.saltedkeys.io/) (0xsalt)

## What is a Daemon?

A Daemon is a personal API that represents a human's identity, context, and preferences in a format AIs can query. Think of it as a machine-readable "About Me" that AI assistants can use to personalize interactions.

## Identity Format

Each daemon has a **namespace-based ID** that provides stable, portable identity:

```
<reversed-domain>.<identifier>
```

**Examples:**
| ID | URL | Owner |
|----|-----|-------|
| `com.danielmiessler.daniel` | daemon.danielmiessler.com | Daniel Miessler |
| `io.saltedkeys.swift` | daemon.saltedkeys.io | Swift |

**Why this format?**
- **Stable** - ID doesn't change even if URL changes
- **Self-sovereign** - You control your namespace via your domain
- **Human-readable** - Meaningful names, not hashes

## Architecture

This project is organized as a monorepo with two independent MCP servers:

```
┌─────────────────────────────────┐     ┌─────────────────────────────────┐
│  registry.daemon.saltedkeys.io  │     │  daemon.saltedkeys.io/mcp       │
│  (UL Community Registry)        │     │  (Telos - Swift's Daemon)       │
├─────────────────────────────────┤     ├─────────────────────────────────┤
│  14 tools:                      │     │  16 tools:                      │
│  - 8 meta (orientation, etc.)   │     │  - 14 personal (get_about, etc.)│
│  - 6 registry (search, announce)│     │  - 2 meta (orientation, config) │
│                                 │     │                                 │
│  KV: Registry data              │     │  No KV (fetches daemon.md)      │
│  Cron: Health checks            │     │  No cron                        │
│  Rate limiting: Yes             │     │  No rate limiting               │
└─────────────────────────────────┘     └─────────────────────────────────┘
         │                                        │
         │ queries                                │ queries
         ▼                                        ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  AI Agents (Claude, etc.)                                               │
└─────────────────────────────────────────────────────────────────────────┘
```

## Quick Start

### Add to Claude Code

Add to `~/.claude/mcp_servers.json`:

```json
{
  "ul-daemon-registry": {
    "url": "https://registry.daemon.saltedkeys.io/sse",
    "transport": "sse"
  },
  "swift-daemon": {
    "url": "https://daemon.saltedkeys.io/mcp/sse",
    "transport": "sse"
  }
}
```

### Query via JSON-RPC

```bash
# List all daemons in the registry
curl -X POST https://registry.daemon.saltedkeys.io/ \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"daemon_registry_list"},"id":1}'

# Search for security-focused daemons
curl -X POST https://registry.daemon.saltedkeys.io/ \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"daemon_registry_search","arguments":{"tag":"security"}},"id":1}'

# Query Swift's personal daemon
curl -X POST https://daemon.saltedkeys.io/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"get_telos"},"id":1}'
```

## Available Tools

### Registry Tools (registry.daemon.saltedkeys.io)

| Tool | Description |
|------|-------------|
| `get_orientation` | First-contact intro to the UL Community Registry |
| `get_mcp_config` | Integration snippet for Claude Code/Desktop |
| `get_protocol_info` | Transport details and example requests |
| `ai_briefing` | AI-specific usage guidance |
| `get_status` | Version and registry stats |
| `get_capabilities` | Categorized list of all tools |
| `get_changelog` | Recent changes and version history |
| `daemon_registry_random` | Discover a random daemon |
| `daemon_registry_list` | Browse all registered daemons |
| `daemon_registry_search` | Search by query, tag, or status |
| `daemon_registry_announce` | Register your daemon |
| `daemon_registry_health_check` | Manual health check for a daemon |
| `daemon_registry_activity` | Activity feed (announcements, status changes) |
| `daemon_registry_capabilities` | Discover tools offered by a daemon |

### Personal Tools (daemon.saltedkeys.io/mcp)

| Tool | Description |
|------|-------------|
| `get_orientation` | Intro to Swift's personal daemon |
| `get_mcp_config` | Integration snippet |
| `get_about` | Personal background and identity |
| `get_telos` | Core purpose and direction |
| `get_mission` | Current mission statement |
| `get_projects` | Active projects |
| `get_preferences` | Personal preferences |
| `get_philosophy` | Philosophical views |
| `get_daily_routine` | Daily schedule |
| `get_predictions` | Future predictions |
| `get_favorite_books` | Book recommendations |
| `get_favorite_movies` | Movie recommendations |
| `get_favorite_tv` | TV show recommendations |
| `get_current_location` | Current location |
| `get_all` | Complete daemon.md content |
| `get_section` | Get any section by name |

## Status Values

Each daemon in the registry has a `status` and `healthy` flag:

| Status | Healthy | Meaning |
|--------|---------|---------|
| `mcp` | `true` | MCP server responding - you can query it |
| `web` | `true` | Website only - no MCP, but working as intended |
| `offline` | `false` | Can't reach it |

## Project Structure

```
daemon-mcp/
├── packages/
│   ├── registry/              # UL Community Registry
│   │   ├── src/
│   │   │   ├── index.ts       # Worker entry point
│   │   │   ├── types.ts       # TypeScript types
│   │   │   ├── tools/         # Meta and registry tools
│   │   │   └── lib/           # KV, health checks, rate limiting
│   │   ├── wrangler.jsonc     # Cloudflare config
│   │   └── seed-registry.json # Initial daemon list
│   │
│   └── telos/                 # Swift's Personal Daemon
│       ├── src/
│       │   ├── index.ts       # Worker entry point
│       │   ├── tools/         # Personal tools
│       │   └── lib/           # daemon.md parsing
│       └── wrangler.jsonc     # Cloudflare config
│
├── package.json               # Workspace root
└── README.md
```

## Development

### Prerequisites

- [Bun](https://bun.sh) runtime
- [Cloudflare account](https://dash.cloudflare.com) (free tier works)

### Local Development

```bash
# Install dependencies
bun install

# Run registry locally
bun run registry:dev

# Run telos locally (in separate terminal)
bun run telos:dev
```

### Deployment

```bash
# Deploy registry
bun run registry:deploy

# Deploy telos
bun run telos:deploy
```

### Deploy Your Own Registry

1. Fork this repository
2. Update `packages/registry/seed-registry.json` with your daemon list
3. Create a KV namespace: `npx wrangler kv:namespace create REGISTRY_DATA`
4. Update `packages/registry/wrangler.jsonc` with your KV namespace ID and custom domain
5. Deploy: `bun run registry:deploy`

### Deploy Your Own Personal Daemon

1. Fork this repository
2. Update `DAEMON_MD_URL` in `packages/telos/src/lib/daemon-md.ts`
3. Update `packages/telos/wrangler.jsonc` with your custom domain
4. Deploy: `bun run telos:deploy`

## Roadmap

### Completed (v1.1.0)
- [x] Separated registry from personal daemon
- [x] Registry at `registry.daemon.saltedkeys.io`
- [x] Telos at `daemon.saltedkeys.io/mcp`
- [x] JSON-RPC + SSE transports
- [x] Health monitoring with mcp/web/offline status
- [x] Rate limiting and jitter-based health checks
- [x] Cloudflare KV persistence
- [x] **Namespace-based daemon IDs**
- [x] **Security audit documentation**

### Future
- [ ] Gossip protocol - peer discovery via `get_known_daemons`
- [ ] Content hashing for change detection
- [ ] Web of trust (vouching system)
- [ ] ARC protocol integration
- [ ] Encrypted inbox messaging
- [ ] OpenAPI spec for non-MCP clients

## Security

This MCP server has **zero code execution capability**. See [SECURITY.md](SECURITY.md) for the full audit.

## Related Projects

- [danielmiessler/Daemon](https://github.com/danielmiessler/Daemon) - Original Daemon project
- [0xsalt/daemon](https://github.com/0xsalt/daemon) - Fork with build-time parser

## License

MIT
