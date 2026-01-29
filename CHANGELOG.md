# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.1.0] - 2026-01-28

### Added
- **Namespace-based daemon IDs** - Each daemon now has a stable, portable identifier
  - Format: `<reversed-domain>.<identifier>` (e.g., `io.saltedkeys.swift`)
  - Auto-derived from URL on announce if not provided
  - Designed for future ARC protocol integration
- `content_hash` field in `DaemonEntry` for future change detection
- `SECURITY.md` documenting zero code execution design
- New community daemon: `info.voidwire.daemon` (daemon.voidwire.info)

### Changed
- Registry seed data now includes `id` field for all daemons
- Search now matches against daemon ID in addition to other fields
- Bumped seed registry version to 2

### Security
- Documented and audited that the MCP server has zero code execution capability
- All tools are read-only queries or outbound HTTP fetches
- No shell commands, eval, or dynamic imports

## [1.0.0] - 2026-01-15

### Changed
- **BREAKING**: Separated UL Community Registry from personal daemon into two independent MCP servers
  - Registry: `registry.daemon.saltedkeys.io` (14 tools)
  - Telos (personal): `mcp.daemon.saltedkeys.io` (16 tools)
- Reorganized as monorepo with `packages/registry` and `packages/telos`
- Each package has its own wrangler.jsonc, dependencies, and deployment

### Migration
If you were using `mcp.daemon.saltedkeys.io`, update your MCP config:
```json
{
  "ul-daemon-registry": {
    "url": "https://registry.daemon.saltedkeys.io/sse",
    "transport": "sse"
  },
  "swift-daemon": {
    "url": "https://mcp.daemon.saltedkeys.io/sse",
    "transport": "sse"
  }
}
```

## [0.4.0-alpha] - 2026-01-11

### Added
- AI discoverability tools (8 new meta tools for first-contact experience):
  - `get_orientation` - START HERE intro for UL Community Daemon Registry
  - `get_mcp_config` - Integration snippet for Claude Code/Desktop
  - `get_protocol_info` - Transport details and example requests
  - `ai_briefing` - AI-specific usage guidance
  - `get_status` - Version, uptime, and registry stats
  - `get_capabilities` - Categorized tool listing (Meta, Personal, Registry)
  - `get_changelog` - Recent changes and version history
  - `daemon_registry_random` - Discover a random daemon for exploration
- Rate limiting for announce endpoint (5 announces per hour per IP)
- Per-daemon jitter for health checks (spreads checks across the hour based on URL hash)
- Filter by `health_status` in `daemon_registry_search` tool
- `daemon_registry_health_check` tool for manual health checks
- `daemon_registry_activity` tool for activity feed (announcements, health changes)
- `daemon_registry_capabilities` tool for MCP tool auto-discovery

### Changed
- Simplified `status` field to 3 clear values: `mcp`, `web`, `offline`
  - `mcp` = speaks MCP protocol (you can query it)
  - `web` = website only, no MCP capability
  - `offline` = can't reach it
- Added `healthy` boolean to signal intent (prevents clients from showing warnings for web-only sites)
- Cron trigger now runs every minute (jitter logic determines which daemons to check)
- Reframed `get_orientation` to emphasize UL Community Daemon Registry first, personal daemon second

## [0.3.0-alpha] - 2026-01-11

### Added
- Daemon verification on announce (fetches daemon.md to confirm existence)
- Health tracking fields: `verified`, `verified_at`, `last_checked`, `health_status`, `consecutive_failures`
- Cloudflare Cron trigger for hourly health checks
- Health status: "healthy", "degraded" (1-2 failures), "unreachable" (3+ failures)

### Changed
- `daemon_registry_announce` now returns verification status and error details
- Seed registry entries now include `verified` and `health_status` fields

## [0.2.0-alpha] - 2026-01-11

### Added
- `daemon_registry_list` - List all known daemons in the registry
- `daemon_registry_search` - Search daemons by name, owner, tags, or focus area
- `daemon_registry_announce` - Announce a new daemon to the registry
- `seed-registry.json` with 4 known community daemons
- Cloudflare KV persistence for announced daemons (survives worker restarts)

## [0.1.0-alpha] - 2026-01-11

### Added
- Initial MCP server implementation with 14 tools
- JSON-RPC transport (stateless, matches Daniel's pattern)
- SSE transport for Claude Desktop and stateful clients
- Health check endpoint at `/health`
- Automatic daemon.md parsing by `[SECTION_NAME]` headers
- 5-minute caching for daemon.md fetches
- Tools: get_about, get_telos, get_mission, get_projects, get_favorite_books, get_favorite_movies, get_favorite_tv, get_preferences, get_daily_routine, get_predictions, get_philosophy, get_all, get_section, get_current_location
