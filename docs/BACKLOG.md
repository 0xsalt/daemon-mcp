# BACKLOG.md

> Single source of work.
> Review regularly.
> Top item is next.

---

## NOW

- [ ] Deploy registry tools to production
- [ ] Test KV persistence on production

## BACKLOG

- [ ] Daemon verification (fetch daemon.md, validate format)
- [ ] Rate limiting for announce endpoint

## ROADMAP

- [ ] Gossip protocol - `get_known_daemons` for peer discovery
- [ ] Change detection (content hashing)
- [ ] Cron triggers for polling
- [ ] Web of trust (vouching system)
- [ ] Activity feed
- [ ] Encrypted inbox messaging
- [ ] Compatibility matrix (tool auto-discovery)

## DONE

- [x] Cloudflare KV persistence for registry [2026-01-11]
- [x] `daemon_registry_list` tool [2026-01-11]
- [x] `daemon_registry_search` tool [2026-01-11]
- [x] `daemon_registry_announce` tool [2026-01-11]
- [x] `seed-registry.json` with 4 community daemons [2026-01-11]
- [x] Core MCP server with 14 tools [2026-01-10]
- [x] JSON-RPC transport [2026-01-10]
- [x] SSE transport for Claude Desktop [2026-01-10]
- [x] Health check endpoint [2026-01-10]
