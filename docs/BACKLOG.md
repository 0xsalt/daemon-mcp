# BACKLOG.md

> Single source of work.
> Review regularly.
> Top item is next.

---

## NOW

(empty)

## BACKLOG

## ROADMAP

- [ ] Gossip protocol - `get_known_daemons` for peer discovery
- [ ] Change detection (content hashing)
- [ ] Web of trust (vouching system)
- [ ] Encrypted inbox messaging
- [ ] `get_openapi_spec` - For non-MCP clients
- [ ] `suggest_query` - Common use case hints
- [ ] `get_collaboration_hooks` - Meeting/collab proposals

## DONE

- [x] Simplified status to mcp/web/offline (replaced health_status) [2026-01-11]
- [x] AI Discoverability Tools (8 meta tools) [2026-01-11]
  - [x] `get_mcp_config` - Integration snippet for Claude Code
  - [x] `get_orientation` - First-contact intro
  - [x] `get_protocol_info` - Transport and example requests
  - [x] `ai_briefing` - AI-specific usage guidance
  - [x] `get_status` - Enhanced health with version/stats
  - [x] `get_capabilities` - Categorized tool listing
  - [x] `get_changelog` - What's new
  - [x] `daemon_registry_random` - Discovery exploration
- [x] Compatibility matrix (`daemon_registry_capabilities`) [2026-01-11]
- [x] Activity feed (`daemon_registry_activity`) [2026-01-11]
- [x] Manual health check trigger (`daemon_registry_health_check`) [2026-01-11]
- [x] Filter by status in search [2026-01-11]
- [x] Per-daemon jitter for health checks (URL hash-based) [2026-01-11]
- [x] Rate limiting for announce endpoint (5/hr/IP) [2026-01-11]
- [x] Daemon verification on announce [2026-01-11]
- [x] Health tracking fields (verified, status, etc.) [2026-01-11]
- [x] Cloudflare Cron trigger for health checks [2026-01-11]
- [x] Cloudflare KV persistence for registry [2026-01-11]
- [x] `daemon_registry_list` tool [2026-01-11]
- [x] `daemon_registry_search` tool [2026-01-11]
- [x] `daemon_registry_announce` tool [2026-01-11]
- [x] `seed-registry.json` with 4 community daemons [2026-01-11]
- [x] Core MCP server with 14 tools [2026-01-10]
- [x] JSON-RPC transport [2026-01-10]
- [x] SSE transport for Claude Desktop [2026-01-10]
- [x] Health check endpoint [2026-01-10]
