# daemon-mcp

MCP server for the [Daemon](https://github.com/danielmiessler/Daemon) ecosystem.
Exposes your personal daemon.md as AI-queryable tools via JSON-RPC and SSE.

**Author:** [Swift](https://daemon.saltedkeys.io/) (0xsalt)

## Features

- **14 MCP Tools:** get_telos, get_about, get_mission, get_projects, etc.
- **Dual Transport:** JSON-RPC (stateless) + SSE (stateful for Claude Desktop)
- **Registry Support:** (Coming) Discover and track other daemons
- **Plugin Architecture:** Extensible for community features

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) runtime
- [Cloudflare account](https://dash.cloudflare.com) (free tier works)
- Your daemon deployed (see [0xsalt/daemon](https://github.com/0xsalt/daemon))

### Deploy

```bash
# Clone
git clone https://github.com/0xsalt/daemon-mcp.git
cd daemon-mcp

# Install
bun install

# Configure
cp wrangler.jsonc.example wrangler.jsonc
# Edit wrangler.jsonc with your settings
# Edit src/index.ts line 6 - set DAEMON_MD_URL to your daemon.md URL

# Deploy
npx wrangler deploy
```

### Test

```bash
# List tools
curl -X POST https://YOUR-WORKER.workers.dev/ \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'

# Get TELOS
curl -X POST https://YOUR-WORKER.workers.dev/ \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"get_telos","arguments":{}},"id":2}'
```

## Configuration

1. Copy `wrangler.jsonc.example` to `wrangler.jsonc`
2. Edit `wrangler.jsonc` with your worker name and optional custom domain
3. Edit `src/index.ts` to set your daemon.md URL:

```typescript
const DAEMON_MD_URL = "https://YOUR-DOMAIN/daemon.md";
```

## Available Tools

| Tool | Description |
|------|-------------|
| `get_about` | Personal background and identity |
| `get_telos` | Core purpose and direction |
| `get_mission` | Current mission statement |
| `get_projects` | Active projects |
| `get_favorite_books` | Book recommendations |
| `get_favorite_movies` | Movie recommendations |
| `get_favorite_tv` | TV show recommendations |
| `get_preferences` | Personal preferences |
| `get_daily_routine` | Daily schedule |
| `get_predictions` | Future predictions |
| `get_philosophy` | Philosophical views |
| `get_all` | Complete daemon.md content |
| `get_section` | Get any section by name |
| `get_current_location` | Current location |

## Architecture

```
┌─────────────────────┐     ┌─────────────────────┐
│  daemon (static)    │     │  daemon-mcp (API)   │
│  Cloudflare Pages   │────▶│  Cloudflare Worker  │
│  your-site.pages.dev│     │  your-mcp.workers.dev│
└─────────────────────┘     └─────────────────────┘
         │                            │
         │ serves                     │ serves
         ▼                            ▼
    Human visitors              AI Agents (MCP)
```

## Roadmap

### Phase 1: Foundation (Current)

- [x] Core MCP server with 14 tools
- [x] JSON-RPC transport
- [x] SSE transport for Claude Desktop
- [x] Health check endpoint
- [x] GitHub release

### Phase 2: Registry Tools

- [ ] `daemon_registry_list` - list known daemons
- [ ] `daemon_registry_search` - search by tags/name
- [ ] `daemon_registry_announce` - self-registration
- [ ] `seed-registry.json` with community daemons
- [ ] Cloudflare KV for persistent storage

### Phase 3: Gossip Protocol

- [ ] `get_known_daemons` tool for peer discovery
- [ ] Crawl/merge logic for network discovery
- [ ] Change detection (content hashing)
- [ ] Cron triggers for polling

### Phase 4: Advanced Features

- [ ] Web of trust (vouching system)
- [ ] Activity feed
- [ ] Encrypted inbox messaging
- [ ] Compatibility matrix (tool auto-discovery)

## Known Community Daemons

| Daemon | Owner | Protocol |
|--------|-------|----------|
| [daemon.danielmiessler.com](https://daemon.danielmiessler.com) | Daniel Miessler | MCP-RPC |
| [daemon.saltedkeys.io](https://daemon.saltedkeys.io) | Swift | MCP-RPC |
| [daemon.nocooldowns.io](https://daemon.nocooldowns.io) | Scott Behrens | JSON-RPC |
| [wallykroeker.com/daemon](https://wallykroeker.com/daemon) | Wally Kroeker | TBD |

## Related Projects

- [danielmiessler/Daemon](https://github.com/danielmiessler/Daemon) - Original Daemon project
- [0xsalt/daemon](https://github.com/0xsalt/daemon) - Fork with enhanced docs

## License

MIT
