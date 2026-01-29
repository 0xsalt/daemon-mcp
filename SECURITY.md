# Security Policy

## Design Principles

This MCP server is designed with **zero code execution** capability:

### What This Server CAN Do
- Read from Cloudflare KV storage
- Write to Cloudflare KV storage (rate-limited)
- Make outbound HTTP requests to verify daemons
- Parse JSON and markdown
- Return text responses

### What This Server CANNOT Do
- Execute shell commands
- Spawn processes
- Evaluate dynamic code
- Access the filesystem
- Import modules dynamically
- Run user-provided code

## Audit Checklist

To verify this server is safe, check for absence of:

```bash
# These patterns should return NO matches:
grep -r "exec\|spawn\|eval\|Function(" packages/
grep -r "child_process\|vm\.\|require(" packages/
grep -r "import(" packages/  # dynamic imports
```

## Tool Safety Matrix

| Tool | Input | Output | Side Effects |
|------|-------|--------|--------------|
| `get_orientation` | None | Static text | None |
| `get_mcp_config` | None | Static JSON | None |
| `daemon_registry_list` | None | KV read | None |
| `daemon_registry_search` | Query string | KV read + filter | None |
| `daemon_registry_announce` | URL, metadata | HTTP fetch, KV write | Adds entry |
| `daemon_registry_health_check` | URL | HTTP fetch | Updates status |
| `get_about`, `get_telos`, etc. | None | HTTP fetch daemon.md | None |

## Deployment Security

### Cloudflare Workers
- Runs in V8 isolate (sandboxed)
- No filesystem access
- No native code execution
- Network requests only to allowed origins

### KV Storage
- Managed by Cloudflare
- No direct database access
- Rate-limited writes

## Reporting Vulnerabilities

If you discover a security issue, please email: security@saltedkeys.io

Do NOT open a public GitHub issue for security vulnerabilities.

## License

This security policy applies to all code in this repository.
