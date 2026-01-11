# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Registry tools for daemon discovery (coming soon)

## [0.1.0-alpha] - 2026-01-11

### Added
- Initial MCP server implementation with 14 tools
- JSON-RPC transport (stateless, matches Daniel's pattern)
- SSE transport for Claude Desktop and stateful clients
- Health check endpoint at `/health`
- Automatic daemon.md parsing by `[SECTION_NAME]` headers
- 5-minute caching for daemon.md fetches
- Tools: get_about, get_telos, get_mission, get_projects, get_favorite_books, get_favorite_movies, get_favorite_tv, get_preferences, get_daily_routine, get_predictions, get_philosophy, get_all, get_section, get_current_location
