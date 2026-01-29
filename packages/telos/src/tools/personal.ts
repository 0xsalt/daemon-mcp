const MCP_URL = "https://daemon.saltedkeys.io/mcp";
const OWNER = "Swift";

// Tool definitions for personal daemon
export const PERSONAL_TOOLS = [
	{ name: "get_about", description: "Get basic about/bio information", inputSchema: { type: "object", properties: {}, required: [] } },
	{ name: "get_current_location", description: "Get current location/timezone", inputSchema: { type: "object", properties: {}, required: [] } },
	{ name: "get_mission", description: "Get mission statement", inputSchema: { type: "object", properties: {}, required: [] } },
	{ name: "get_telos", description: "Get TELOS framework (problems, missions, goals)", inputSchema: { type: "object", properties: {}, required: [] } },
	{ name: "get_projects", description: "Get current projects and what I'm building", inputSchema: { type: "object", properties: {}, required: [] } },
	{ name: "get_favorite_books", description: "Get favorite book recommendations", inputSchema: { type: "object", properties: {}, required: [] } },
	{ name: "get_favorite_movies", description: "Get favorite movie recommendations", inputSchema: { type: "object", properties: {}, required: [] } },
	{ name: "get_favorite_tv", description: "Get favorite TV show recommendations", inputSchema: { type: "object", properties: {}, required: [] } },
	{ name: "get_preferences", description: "Get work preferences and style", inputSchema: { type: "object", properties: {}, required: [] } },
	{ name: "get_daily_routine", description: "Get daily routine information", inputSchema: { type: "object", properties: {}, required: [] } },
	{ name: "get_predictions", description: "Get predictions about the future", inputSchema: { type: "object", properties: {}, required: [] } },
	{ name: "get_philosophy", description: "Get core philosophy", inputSchema: { type: "object", properties: {}, required: [] } },
	{ name: "get_all", description: "Get all daemon information as JSON", inputSchema: { type: "object", properties: {}, required: [] } },
	{ name: "get_section", description: "Get any section by name (e.g., ABOUT, MISSION, TELOS)", inputSchema: { type: "object", properties: { section: { type: "string", description: "Section name (uppercase, underscores for spaces)" } }, required: ["section"] } },
];

// Meta tool for telos
export const META_TOOLS = [
	{
		name: "get_orientation",
		description: "START HERE - Learn about Swift's personal daemon",
		inputSchema: { type: "object", properties: {}, required: [] }
	},
	{
		name: "get_mcp_config",
		description: "Get MCP configuration snippet for Claude Code",
		inputSchema: { type: "object", properties: {}, required: [] }
	},
];

export function getOrientation(): string {
	return `# ${OWNER}'s Personal Daemon (Telos)

This is ${OWNER}'s personal daemon - an MCP server representing their identity, context, and preferences.

## What is a Daemon?
A Daemon is a personal API that represents a human's identity, context, and preferences in a format AIs can query.

## Available Tools

### Core Identity
- \`get_about\` - Background and identity
- \`get_telos\` - Core purpose and direction (TELOS framework)
- \`get_mission\` - Current mission statement
- \`get_philosophy\` - Philosophical views

### Current State
- \`get_projects\` - What I'm building
- \`get_current_location\` - Where I am
- \`get_daily_routine\` - My schedule
- \`get_predictions\` - Future predictions

### Preferences
- \`get_preferences\` - Work preferences and tech stack
- \`get_favorite_books\` - Book recommendations
- \`get_favorite_movies\` - Movie recommendations
- \`get_favorite_tv\` - TV show recommendations

### Utilities
- \`get_all\` - Complete daemon.md content
- \`get_section\` - Get any section by name

## Integration
Use \`get_mcp_config\` to add this daemon to your Claude Code setup.

## UL Community
For the community daemon registry, see: https://registry.daemon.saltedkeys.io`;
}

export function getMcpConfig(): object {
	return {
		description: "Add this to your Claude Code config (~/.claude/mcp_servers.json)",
		sse_config: {
			"swift-daemon": {
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
				params: { name: "get_telos", arguments: {} },
				id: 1
			}
		},
		note: "For the UL Community Daemon Registry, use: https://registry.daemon.saltedkeys.io/sse"
	};
}
