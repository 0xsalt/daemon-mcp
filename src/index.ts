import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { z } from "zod";
import seedRegistry from "../seed-registry.json";

// Daemon.md content - fetched from static site
const DAEMON_MD_URL = "https://saltedkeys.pages.dev/daemon.md";

// Registry types
interface DaemonEntry {
	url: string;
	owner: string;
	role?: string;
	focus?: string[];
	protocol?: string;
	mcp_url?: string;
	api_url?: string;
	tags?: string[];
	announced_at?: string;
	last_verified?: string;
}

interface Registry {
	version: number;
	entries: DaemonEntry[];
	updated: string;
}

// KV key for storing announced daemons
const KV_ANNOUNCED_KEY = "announced_daemons";

// In-memory cache (refreshed from KV on each request)
let registryCache: Registry | null = null;

// Load registry from seed + KV
async function loadRegistry(kv?: KVNamespace): Promise<Registry> {
	// Start with seed entries
	const entries: DaemonEntry[] = [...seedRegistry.entries];

	// Load announced daemons from KV if available
	if (kv) {
		try {
			const announced = await kv.get<DaemonEntry[]>(KV_ANNOUNCED_KEY, "json");
			if (announced && Array.isArray(announced)) {
				entries.push(...announced);
			}
		} catch (e) {
			console.error("Failed to load announced daemons from KV:", e);
		}
	}

	return {
		version: seedRegistry.version,
		entries,
		updated: new Date().toISOString(),
	};
}

// Save announced daemons to KV
async function saveAnnouncedToKV(kv: KVNamespace, announced: DaemonEntry[]): Promise<void> {
	await kv.put(KV_ANNOUNCED_KEY, JSON.stringify(announced));
}

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
const DAEMON_TOOLS = [
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

// Registry tool definitions
const REGISTRY_TOOLS = [
	{
		name: "daemon_registry_list",
		description: "List all known daemons in the registry",
		inputSchema: { type: "object", properties: {}, required: [] }
	},
	{
		name: "daemon_registry_search",
		description: "Search daemons by name, owner, tags, or focus area",
		inputSchema: {
			type: "object",
			properties: {
				query: { type: "string", description: "Search query (matches owner, role, focus, tags)" },
				tag: { type: "string", description: "Filter by specific tag" }
			},
			required: []
		}
	},
	{
		name: "daemon_registry_announce",
		description: "Announce a new daemon to the registry",
		inputSchema: {
			type: "object",
			properties: {
				url: { type: "string", description: "Daemon URL (e.g., https://daemon.example.com/)" },
				owner: { type: "string", description: "Owner name" },
				role: { type: "string", description: "Owner's role or title" },
				focus: { type: "array", items: { type: "string" }, description: "Areas of focus" },
				protocol: { type: "string", description: "Protocol type: mcp-rpc, json-rpc, or unknown" },
				mcp_url: { type: "string", description: "MCP API URL if different from daemon URL" },
				tags: { type: "array", items: { type: "string" }, description: "Searchable tags" }
			},
			required: ["url", "owner"]
		}
	},
];

const TOOLS = [...DAEMON_TOOLS, ...REGISTRY_TOOLS];

// Registry functions
async function registryList(kv?: KVNamespace): Promise<{ entries: DaemonEntry[]; updated: string }> {
	const registry = await loadRegistry(kv);
	return { entries: registry.entries, updated: registry.updated };
}

async function registrySearch(kv: KVNamespace | undefined, query?: string, tag?: string): Promise<DaemonEntry[]> {
	const registry = await loadRegistry(kv);
	let results = registry.entries;

	if (tag) {
		const normalizedTag = tag.toLowerCase();
		results = results.filter(entry =>
			entry.tags?.some(t => t.toLowerCase() === normalizedTag)
		);
	}

	if (query) {
		const q = query.toLowerCase();
		results = results.filter(entry =>
			entry.owner.toLowerCase().includes(q) ||
			entry.role?.toLowerCase().includes(q) ||
			entry.focus?.some(f => f.toLowerCase().includes(q)) ||
			entry.tags?.some(t => t.toLowerCase().includes(q)) ||
			entry.url.toLowerCase().includes(q)
		);
	}

	return results;
}

async function registryAnnounce(
	kv: KVNamespace | undefined,
	entry: Omit<DaemonEntry, "announced_at">
): Promise<{ success: boolean; entry: DaemonEntry; message: string }> {
	const registry = await loadRegistry(kv);

	// Check if already exists
	const existing = registry.entries.find(e => e.url === entry.url);
	if (existing) {
		return { success: false, entry: existing, message: "Daemon already registered" };
	}

	// Validate URL format
	try {
		new URL(entry.url);
	} catch {
		return { success: false, entry: entry as DaemonEntry, message: "Invalid URL format" };
	}

	const newEntry: DaemonEntry = {
		...entry,
		announced_at: new Date().toISOString(),
	};

	// Persist to KV if available
	if (kv) {
		// Get current announced list (excluding seed entries)
		const announced = await kv.get<DaemonEntry[]>(KV_ANNOUNCED_KEY, "json") || [];
		announced.push(newEntry);
		await saveAnnouncedToKV(kv, announced);
	}

	return { success: true, entry: newEntry, message: "Daemon announced successfully" };
}

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
async function handleJsonRpc(body: any, kv?: KVNamespace): Promise<Response> {
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

			// Standard daemon tools - Look up section
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

			// Registry tools
			if (toolName === "daemon_registry_list") {
				const { entries, updated } = await registryList(kv);
				return new Response(
					JSON.stringify({
						jsonrpc: "2.0",
						result: {
							content: [{
								type: "text",
								text: JSON.stringify({
									count: entries.length,
									daemons: entries,
									updated
								}, null, 2)
							}]
						},
						id,
					}),
					{ headers }
				);
			}

			if (toolName === "daemon_registry_search") {
				const query = params?.arguments?.query;
				const tag = params?.arguments?.tag;
				const entries = await registrySearch(kv, query, tag);
				return new Response(
					JSON.stringify({
						jsonrpc: "2.0",
						result: {
							content: [{
								type: "text",
								text: JSON.stringify({
									query: query || null,
									tag: tag || null,
									count: entries.length,
									daemons: entries
								}, null, 2)
							}]
						},
						id,
					}),
					{ headers }
				);
			}

			if (toolName === "daemon_registry_announce") {
				const args = params?.arguments || {};
				if (!args.url || !args.owner) {
					return new Response(
						JSON.stringify({
							jsonrpc: "2.0",
							error: { code: -32602, message: "Missing required fields: url and owner" },
							id,
						}),
						{ headers }
					);
				}
				const result = await registryAnnounce(kv, {
					url: args.url,
					owner: args.owner,
					role: args.role,
					focus: args.focus,
					protocol: args.protocol || "unknown",
					mcp_url: args.mcp_url,
					tags: args.tags || [],
				});
				return new Response(
					JSON.stringify({
						jsonrpc: "2.0",
						result: {
							content: [{
								type: "text",
								text: JSON.stringify(result, null, 2)
							}]
						},
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
		// Register daemon tools for SSE-based MCP clients
		for (const tool of DAEMON_TOOLS) {
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

		// Register registry tools
		// Note: SSE transport uses this.env for KV access
		const getKV = () => (this.env as Env)?.DAEMON_REGISTRY;

		this.server.tool(
			"daemon_registry_list",
			"List all known daemons in the registry",
			{},
			async () => {
				const { entries, updated } = await registryList(getKV());
				return {
					content: [{
						type: "text",
						text: JSON.stringify({ count: entries.length, daemons: entries, updated }, null, 2)
					}]
				};
			}
		);

		this.server.tool(
			"daemon_registry_search",
			"Search daemons by name, owner, tags, or focus area",
			{
				query: z.string().optional().describe("Search query (matches owner, role, focus, tags)"),
				tag: z.string().optional().describe("Filter by specific tag"),
			},
			async ({ query, tag }) => {
				const entries = await registrySearch(getKV(), query, tag);
				return {
					content: [{
						type: "text",
						text: JSON.stringify({ query: query || null, tag: tag || null, count: entries.length, daemons: entries }, null, 2)
					}]
				};
			}
		);

		this.server.tool(
			"daemon_registry_announce",
			"Announce a new daemon to the registry",
			{
				url: z.string().describe("Daemon URL (e.g., https://daemon.example.com/)"),
				owner: z.string().describe("Owner name"),
				role: z.string().optional().describe("Owner's role or title"),
				focus: z.array(z.string()).optional().describe("Areas of focus"),
				protocol: z.string().optional().describe("Protocol type: mcp-rpc, json-rpc, or unknown"),
				mcp_url: z.string().optional().describe("MCP API URL if different from daemon URL"),
				tags: z.array(z.string()).optional().describe("Searchable tags"),
			},
			async ({ url, owner, role, focus, protocol, mcp_url, tags }) => {
				const result = await registryAnnounce(getKV(), {
					url,
					owner,
					role,
					focus,
					protocol: protocol || "unknown",
					mcp_url,
					tags: tags || [],
				});
				return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
			}
		);
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
				return handleJsonRpc(body, env.DAEMON_REGISTRY);
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
