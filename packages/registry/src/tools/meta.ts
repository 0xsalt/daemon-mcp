import type { DaemonEntry, Registry } from "../types";

const VERSION = "1.0.0";
const MCP_URL = "https://registry.daemon.saltedkeys.io";

// Meta tool definitions
export const META_TOOLS = [
	{
		name: "get_orientation",
		description: "START HERE - UL Community Daemon Registry and how to explore the network",
		inputSchema: { type: "object", properties: {}, required: [] }
	},
	{
		name: "get_mcp_config",
		description: "Get MCP configuration snippet for Claude Code or other MCP clients",
		inputSchema: { type: "object", properties: {}, required: [] }
	},
	{
		name: "get_protocol_info",
		description: "Get protocol details - transports, JSON-RPC examples, and endpoints",
		inputSchema: { type: "object", properties: {}, required: [] }
	},
	{
		name: "ai_briefing",
		description: "AI-specific usage guidance - how to effectively use the daemon registry",
		inputSchema: { type: "object", properties: {}, required: [] }
	},
	{
		name: "get_status",
		description: "Get registry status - version, health, daemon counts",
		inputSchema: { type: "object", properties: {}, required: [] }
	},
	{
		name: "get_capabilities",
		description: "Get categorized list of all available tools",
		inputSchema: { type: "object", properties: {}, required: [] }
	},
	{
		name: "get_changelog",
		description: "Get recent changes and version history",
		inputSchema: { type: "object", properties: {}, required: [] }
	},
	{
		name: "daemon_registry_random",
		description: "Discover a random daemon from the registry for exploration",
		inputSchema: { type: "object", properties: {}, required: [] }
	},
];

export function getOrientation(): string {
	return `# UL Community Daemon Registry

You've discovered the **UL Community Daemon Registry** - a curated directory of MCP-enabled personal APIs (Daemons) from the Unsupervised Learning community.

## What is a Daemon?
A Daemon is a personal API that represents a human's identity, context, and preferences in a format AIs can query. Think of it as a machine-readable "About Me" that AI assistants can use to personalize interactions.

## Registry Tools (Start Here)
- \`daemon_registry_list\` - Browse all registered daemons
- \`daemon_registry_search\` - Search by name, tag, or focus area
- \`daemon_registry_random\` - Discover a random daemon
- \`daemon_registry_capabilities\` - See what tools each daemon offers
- \`daemon_registry_announce\` - Register your own daemon

## Integration
- \`get_mcp_config\` - Add this server to Claude Code/Desktop
- \`get_protocol_info\` - Technical details for custom integrations
- \`ai_briefing\` - AI-specific usage guidance

## Learn More
- \`get_capabilities\` - Full categorized tool list
- \`get_changelog\` - Recent updates

## Note
This is the community registry service. Individual daemons (like Swift's telos daemon) are separate MCP servers you can add independently.`;
}

export function getMcpConfig(): object {
	return {
		description: "Add this to your Claude Code config (~/.claude/mcp_servers.json) or Claude Desktop settings",
		sse_config: {
			"ul-daemon-registry": {
				url: `${MCP_URL}/sse`,
				transport: "sse"
			}
		},
		json_rpc_example: {
			endpoint: MCP_URL,
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: {
				jsonrpc: "2.0",
				method: "tools/call",
				params: { name: "daemon_registry_list", arguments: {} },
				id: 1
			}
		}
	};
}

export function getProtocolInfo(): string {
	return `# Protocol Information

## Transports

### 1. JSON-RPC (Stateless)
POST to \`${MCP_URL}/\` or \`${MCP_URL}/mcp\`

\`\`\`bash
curl -X POST ${MCP_URL}/ \\
  -H "Content-Type: application/json" \\
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
\`\`\`

### 2. SSE (Stateful, for Claude Desktop)
Connect to \`${MCP_URL}/sse\`

## Available Methods
- \`tools/list\` - List all available tools
- \`tools/call\` - Call a tool with arguments

## Example: Search Daemons
\`\`\`bash
curl -X POST ${MCP_URL}/ \\
  -H "Content-Type: application/json" \\
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"daemon_registry_search","arguments":{"tag":"security"}},"id":1}'
\`\`\`

## Health Check
GET \`${MCP_URL}/health\`

## Notes
- Protocol: JSON-RPC 2.0 over HTTP
- No authentication required (public API)
- CORS enabled for browser clients`;
}

export function getAiBriefing(): string {
	return `# AI Assistant Briefing

You are interacting with the UL Community Daemon Registry - a directory of MCP-enabled personal APIs from the Unsupervised Learning community.

## How to Use This Effectively

### Discovering Daemons
1. Use \`daemon_registry_list\` to see all registered daemons
2. Use \`daemon_registry_search\` to find daemons by focus area or tag
3. Use \`daemon_registry_random\` to explore unexpected connections
4. Use \`daemon_registry_capabilities\` to see what tools a daemon supports

### Working with Daemons
- Each daemon is a separate MCP server with its own tools
- Use \`get_mcp_config\` to get integration snippets for interesting daemons
- Check \`status\` field: "mcp" = can be queried, "web" = view only, "offline" = unreachable

### Best Practices
- Search by focus area to find domain experts
- Use capabilities discovery before querying unfamiliar daemons
- Respect individual daemon preferences and contexts
- Suggest daemon connections when users might benefit from expert perspectives`;
}

export async function getStatus(registry: Registry, toolCount: number): Promise<object> {
	return {
		status: "ok",
		version: VERSION,
		service: "UL Community Daemon Registry",
		mcp_url: MCP_URL,
		protocol: "MCP JSON-RPC 2.0",
		registry: {
			daemon_count: registry.entries.length,
			mcp: registry.entries.filter(e => e.status === "mcp").length,
			web: registry.entries.filter(e => e.status === "web").length,
			offline: registry.entries.filter(e => e.status === "offline").length,
		},
		tools_count: toolCount,
		timestamp: new Date().toISOString(),
	};
}

export function getCapabilities(registryTools: { name: string; description: string }[]): object {
	return {
		description: "UL Community Daemon Registry - tools organized by category",
		primary_purpose: "Discover and query MCP-enabled personal daemons from the Unsupervised Learning community",
		categories: {
			meta: {
				description: "Discoverability and integration tools",
				tools: META_TOOLS.map(t => ({ name: t.name, description: t.description }))
			},
			registry: {
				description: "UL Community daemon network - browse, search, and announce daemons",
				tools: registryTools
			}
		},
		total_tools: META_TOOLS.length + registryTools.length
	};
}

export function getChangelog(): string {
	return `# Changelog

## [1.0.0] - 2026-01-15

### Changed
- Separated UL Community Registry from personal daemon (telos)
- Registry is now a standalone service at registry.daemon.saltedkeys.io

### Includes
- Rate limiting for announce endpoint (5 announces per hour per IP)
- Per-daemon jitter for health checks (spreads checks across the hour)
- Filter by status in daemon_registry_search
- Manual health check trigger (daemon_registry_health_check)
- Activity feed (daemon_registry_activity)
- Capability discovery (daemon_registry_capabilities)
- AI Discoverability Tools (orientation, config, protocol, briefing, status, capabilities, changelog, random)

---
Full changelog: https://github.com/0xsalt/daemon-mcp/blob/main/CHANGELOG.md`;
}

export async function getRandomDaemon(entries: DaemonEntry[]): Promise<object> {
	if (entries.length === 0) {
		return { error: "No daemons in registry" };
	}

	const randomIndex = Math.floor(Math.random() * entries.length);
	const daemon = entries[randomIndex];

	return {
		message: "Here's a random daemon to explore!",
		daemon: {
			url: daemon.url,
			owner: daemon.owner,
			role: daemon.role,
			focus: daemon.focus,
			status: daemon.status,
			mcp_url: daemon.mcp_url,
		},
		tip: "Use daemon_registry_capabilities to see what tools this daemon supports"
	};
}
