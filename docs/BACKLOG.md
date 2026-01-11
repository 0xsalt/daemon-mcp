# BACKLOG.md

> Single source of work.
> Review regularly.
> Top item is next.

---

## NOW

- [ ] Push initial release to GitHub

## BACKLOG

- [ ] `daemon_registry_list` - list known daemons
- [ ] `daemon_registry_search` - search by tags/name
- [ ] `daemon_registry_announce` - self-registration
- [ ] `seed-registry.json` with community daemons
- [ ] Cloudflare KV for persistent storage

## ROADMAP

- [ ] Gossip protocol - `get_known_daemons` for peer discovery
- [ ] Change detection (content hashing)
- [ ] Cron triggers for polling
- [ ] Web of trust (vouching system)
- [ ] Activity feed
- [ ] Encrypted inbox messaging
- [ ] Compatibility matrix (tool auto-discovery)

## DONE

- [x] Core MCP server with 14 tools [2026-01-10]
- [x] JSON-RPC transport [2026-01-10]
- [x] SSE transport for Claude Desktop [2026-01-10]
- [x] Health check endpoint [2026-01-10]
