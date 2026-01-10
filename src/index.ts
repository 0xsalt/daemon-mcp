import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { z } from "zod";

// Daemon.md content - fetched from static site
const DAEMON_MD_URL = "https://saltedkeys.pages.dev/daemon.md";

// Cache for parsed daemon data
let daemonCache: { sections: Record<string, string>; lastFetch: number } | null = null;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Parse daemon.md content into sections
function parseDaemonMd(content: string): Record<string, string> {
	const sections: Record<string, string> = {};
	const lines = content.split("\n");
	let currentSection = "";
	let currentContent: string[] = [];

	for (const line of lines) {
		const sectionMatch = line.match(/^\[([A-Z_]+)\]$/);
		if (sectionMatch) {
			if (currentSection) {
				sections[currentSection] = currentContent.join("\n").trim();
			}
			currentSection = sectionMatch[1];
			currentContent = [];
		} else if (currentSection) {
			currentContent.push(line);
		}
	}

	if (currentSection) {
		sections[currentSection] = currentContent.join("\n").trim();
	}

	return sections;
}

// Fetch and cache daemon.md
async function getDaemonSections(): Promise<Record<string, string>> {
	const now = Date.now();

	if (daemonCache && now - daemonCache.lastFetch < CACHE_TTL) {
		return daemonCache.sections;
	}

	try {
		const response = await fetch(DAEMON_MD_URL);
		if (!response.ok) {
			throw new Error(`Failed to fetch daemon.md: ${response.status}`);
		}
		const content = await response.text();
		const sections = parseDaemonMd(content);

		daemonCache = { sections, lastFetch: now };
		return sections;
	} catch (error) {
		if (daemonCache) {
			return daemonCache.sections;
		}
		throw error;
	}
}

// Tool definitions for JSON-RPC response
const TOOLS = [
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

// Section name mapping (tool name -> daemon.md section)
const SECTION_MAP: Record<string, string> = {
	get_about: "ABOUT",
	get_current_location: "CURRENT_LOCATION",
	get_mission: "MISSION",
	get_telos: "TELOS",
	get_projects: "WHAT_IM_BUILDING",
	get_favorite_books: "FAVORITE_BOOKS",
	get_favorite_movies: "FAVORITE_MOVIES",
	get_favorite_tv: "FAVORITE_TV",
	get_preferences: "PREFERENCES",
	get_daily_routine: "DAILY_ROUTINE",
	get_predictions: "PREDICTIONS",
	get_philosophy: "PHILOSOPHY",
};

// Simple JSON-RPC handler (stateless, matches Daniel's pattern)
async function handleJsonRpc(body: any): Promise<Response> {
	const { method, params, id } = body;

	// CORS headers
	const headers = {
		"Content-Type": "application/json",
		"Access-Control-Allow-Origin": "*",
		"Access-Control-Allow-Methods": "POST, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type",
	};

	try {
		// tools/list - Return available tools
		if (method === "tools/list") {
			return new Response(
				JSON.stringify({
					jsonrpc: "2.0",
					result: { tools: TOOLS },
					id,
				}),
				{ headers }
			);
		}

		// tools/call - Execute a tool
		if (method === "tools/call") {
			const toolName = params?.name;
			const sections = await getDaemonSections();

			// get_all - Return all sections
			if (toolName === "get_all") {
				return new Response(
					JSON.stringify({
						jsonrpc: "2.0",
						result: { content: [{ type: "text", text: JSON.stringify(sections, null, 2) }] },
						id,
					}),
					{ headers }
				);
			}

			// get_section - Return specific section by name
			if (toolName === "get_section") {
				const sectionName = params?.arguments?.section?.toUpperCase().replace(/\s+/g, "_");
				const content = sections[sectionName];
				if (!content) {
					const available = Object.keys(sections).join(", ");
					return new Response(
						JSON.stringify({
							jsonrpc: "2.0",
							result: { content: [{ type: "text", text: `Section "${sectionName}" not found. Available: ${available}` }] },
							id,
						}),
						{ headers }
					);
				}
				return new Response(
					JSON.stringify({
						jsonrpc: "2.0",
						result: { content: [{ type: "text", text: content }] },
						id,
					}),
					{ headers }
				);
			}

			// Standard tools - Look up section
			const sectionKey = SECTION_MAP[toolName];
			if (sectionKey) {
				const content = sections[sectionKey] || `No ${sectionKey.toLowerCase()} found`;
				return new Response(
					JSON.stringify({
						jsonrpc: "2.0",
						result: { content: [{ type: "text", text: content }] },
						id,
					}),
					{ headers }
				);
			}

			// Unknown tool
			return new Response(
				JSON.stringify({
					jsonrpc: "2.0",
					error: { code: -32601, message: `Unknown tool: ${toolName}` },
					id,
				}),
				{ headers }
			);
		}

		// Unknown method
		return new Response(
			JSON.stringify({
				jsonrpc: "2.0",
				error: { code: -32601, message: `Method not found: ${method}` },
				id,
			}),
			{ headers }
		);
	} catch (error) {
		return new Response(
			JSON.stringify({
				jsonrpc: "2.0",
				error: { code: -32000, message: String(error) },
				id,
			}),
			{ headers }
		);
	}
}

// Define Daemon MCP agent for stateful SSE connections
export class DaemonMCP extends McpAgent {
	server = new McpServer({
		name: "Daemon MCP Server",
		version: "1.0.0",
	});

	async init() {
		// Register all tools for SSE-based MCP clients
		for (const tool of TOOLS) {
			if (tool.name === "get_section") {
				this.server.tool(
					tool.name,
					tool.description,
					{ section: z.string().describe("Section name") },
					async ({ section }) => {
						const sections = await getDaemonSections();
						const normalizedSection = section.toUpperCase().replace(/\s+/g, "_");
						const content = sections[normalizedSection];
						if (!content) {
							return { content: [{ type: "text", text: `Section not found. Available: ${Object.keys(sections).join(", ")}` }] };
						}
						return { content: [{ type: "text", text: content }] };
					}
				);
			} else if (tool.name === "get_all") {
				this.server.tool(tool.name, tool.description, {}, async () => {
					const sections = await getDaemonSections();
					return { content: [{ type: "text", text: JSON.stringify(sections, null, 2) }] };
				});
			} else {
				const sectionKey = SECTION_MAP[tool.name];
				this.server.tool(tool.name, tool.description, {}, async () => {
					const sections = await getDaemonSections();
					return { content: [{ type: "text", text: sections[sectionKey] || `No ${sectionKey?.toLowerCase()} found` }] };
				});
			}
		}
	}
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext) {
		const url = new URL(request.url);

		// CORS preflight
		if (request.method === "OPTIONS") {
			return new Response(null, {
				headers: {
					"Access-Control-Allow-Origin": "*",
					"Access-Control-Allow-Methods": "POST, OPTIONS",
					"Access-Control-Allow-Headers": "Content-Type",
				},
			});
		}

		// Simple JSON-RPC handler at root (matches Daniel's pattern)
		if ((url.pathname === "/" || url.pathname === "/mcp") && request.method === "POST") {
			try {
				const body = await request.json();
				return handleJsonRpc(body);
			} catch (e) {
				return new Response(
					JSON.stringify({ jsonrpc: "2.0", error: { code: -32700, message: "Parse error" }, id: null }),
					{ headers: { "Content-Type": "application/json" } }
				);
			}
		}

		// SSE transport for stateful MCP clients (Claude Desktop, etc.)
		if (url.pathname === "/sse" || url.pathname === "/sse/message") {
			return DaemonMCP.serveSSE("/sse").fetch(request, env, ctx);
		}

		// Health check
		if (url.pathname === "/health") {
			return new Response(JSON.stringify({ status: "ok", service: "daemon-mcp" }), {
				headers: { "Content-Type": "application/json" },
			});
		}

		return new Response("Daemon MCP Server. POST to / for JSON-RPC or connect to /sse for SSE transport.", { status: 200 });
	},
};
