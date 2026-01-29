import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { z } from "zod";

import type { Env, DaemonEntry } from "./types";
import { loadRegistry, addActivityEvent, saveAnnouncedToKV, getAnnouncedFromKV } from "./lib/kv";
import { getDaemonCheckMinute, healthCheckDaemon } from "./lib/health";
import {
	META_TOOLS,
	getOrientation,
	getMcpConfig,
	getProtocolInfo,
	getAiBriefing,
	getStatus,
	getCapabilities,
	getChangelog,
	getRandomDaemon,
} from "./tools/meta";
import {
	REGISTRY_TOOLS,
	registryList,
	registrySearch,
	registryAnnounce,
	registryHealthCheck,
	registryActivity,
	discoverCapabilities,
} from "./tools/registry";

const TOOLS = [...META_TOOLS, ...REGISTRY_TOOLS];

// CORS headers
const corsHeaders = {
	"Content-Type": "application/json",
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "POST, OPTIONS",
	"Access-Control-Allow-Headers": "Content-Type",
};

// JSON-RPC handler
async function handleJsonRpc(body: any, kv?: KVNamespace, clientIp?: string): Promise<Response> {
	const { method, params, id } = body;

	try {
		// tools/list
		if (method === "tools/list") {
			return new Response(
				JSON.stringify({ jsonrpc: "2.0", result: { tools: TOOLS }, id }),
				{ headers: corsHeaders }
			);
		}

		// tools/call
		if (method === "tools/call") {
			const toolName = params?.name;
			const registry = await loadRegistry(kv);

			// Meta tools
			if (toolName === "get_orientation") {
				return jsonRpcResponse(getOrientation(), id);
			}
			if (toolName === "get_mcp_config") {
				return jsonRpcResponse(JSON.stringify(getMcpConfig(), null, 2), id);
			}
			if (toolName === "get_protocol_info") {
				return jsonRpcResponse(getProtocolInfo(), id);
			}
			if (toolName === "ai_briefing") {
				return jsonRpcResponse(getAiBriefing(), id);
			}
			if (toolName === "get_status") {
				const status = await getStatus(registry, TOOLS.length);
				return jsonRpcResponse(JSON.stringify(status, null, 2), id);
			}
			if (toolName === "get_capabilities") {
				const caps = getCapabilities(REGISTRY_TOOLS.map(t => ({ name: t.name, description: t.description })));
				return jsonRpcResponse(JSON.stringify(caps, null, 2), id);
			}
			if (toolName === "get_changelog") {
				return jsonRpcResponse(getChangelog(), id);
			}
			if (toolName === "daemon_registry_random") {
				const result = await getRandomDaemon(registry.entries);
				return jsonRpcResponse(JSON.stringify(result, null, 2), id);
			}

			// Registry tools
			if (toolName === "daemon_registry_list") {
				const { entries, updated } = await registryList(kv);
				return jsonRpcResponse(JSON.stringify({ count: entries.length, daemons: entries, updated }, null, 2), id);
			}
			if (toolName === "daemon_registry_search") {
				const { query, tag, status } = params?.arguments || {};
				const entries = await registrySearch(kv, query, tag, status);
				return jsonRpcResponse(JSON.stringify({ query, tag, status, count: entries.length, daemons: entries }, null, 2), id);
			}
			if (toolName === "daemon_registry_announce") {
				const args = params?.arguments || {};
				if (!args.url || !args.owner) {
					return jsonRpcError(-32602, "Missing required fields: url and owner", id);
				}
				const result = await registryAnnounce(kv, {
					id: args.id, // Optional - auto-derived from URL if not provided
					url: args.url,
					owner: args.owner,
					role: args.role,
					focus: args.focus,
					protocol: args.protocol || "unknown",
					mcp_url: args.mcp_url,
					tags: args.tags || [],
				}, clientIp);
				return jsonRpcResponse(JSON.stringify(result, null, 2), id);
			}
			if (toolName === "daemon_registry_health_check") {
				const url = params?.arguments?.url;
				if (!url) {
					return jsonRpcError(-32602, "Missing required field: url", id);
				}
				const result = await registryHealthCheck(kv, url);
				return jsonRpcResponse(JSON.stringify(result, null, 2), id);
			}
			if (toolName === "daemon_registry_activity") {
				const { limit, type } = params?.arguments || {};
				const result = await registryActivity(kv, limit, type);
				return jsonRpcResponse(JSON.stringify(result, null, 2), id);
			}
			if (toolName === "daemon_registry_capabilities") {
				const url = params?.arguments?.url;
				if (!url) {
					return jsonRpcError(-32602, "Missing required field: url", id);
				}
				const entry = registry.entries.find(e => e.url === url || e.mcp_url === url);
				const result = await discoverCapabilities(url, entry?.mcp_url);
				return jsonRpcResponse(JSON.stringify(result, null, 2), id);
			}

			return jsonRpcError(-32601, `Unknown tool: ${toolName}`, id);
		}

		return jsonRpcError(-32601, `Method not found: ${method}`, id);
	} catch (error) {
		return jsonRpcError(-32000, String(error), id);
	}
}

function jsonRpcResponse(text: string, id: any): Response {
	return new Response(
		JSON.stringify({
			jsonrpc: "2.0",
			result: { content: [{ type: "text", text }] },
			id,
		}),
		{ headers: corsHeaders }
	);
}

function jsonRpcError(code: number, message: string, id: any): Response {
	return new Response(
		JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id }),
		{ headers: corsHeaders }
	);
}

// Durable Object for SSE transport
export class RegistryMCP extends McpAgent {
	server = new McpServer({
		name: "Daemon Registry",
		version: "1.0.0",
	});

	async init() {
		const getKV = () => (this.env as Env)?.REGISTRY_DATA;

		// Meta tools
		this.server.tool("get_orientation", "START HERE - Community Daemon Registry", {}, async () => {
			return { content: [{ type: "text", text: getOrientation() }] };
		});

		this.server.tool("get_mcp_config", "Get MCP configuration snippet", {}, async () => {
			return { content: [{ type: "text", text: JSON.stringify(getMcpConfig(), null, 2) }] };
		});

		this.server.tool("get_protocol_info", "Get protocol details", {}, async () => {
			return { content: [{ type: "text", text: getProtocolInfo() }] };
		});

		this.server.tool("ai_briefing", "AI-specific usage guidance", {}, async () => {
			return { content: [{ type: "text", text: getAiBriefing() }] };
		});

		this.server.tool("get_status", "Get registry status", {}, async () => {
			const registry = await loadRegistry(getKV());
			const status = await getStatus(registry, TOOLS.length);
			return { content: [{ type: "text", text: JSON.stringify(status, null, 2) }] };
		});

		this.server.tool("get_capabilities", "Get categorized list of tools", {}, async () => {
			const caps = getCapabilities(REGISTRY_TOOLS.map(t => ({ name: t.name, description: t.description })));
			return { content: [{ type: "text", text: JSON.stringify(caps, null, 2) }] };
		});

		this.server.tool("get_changelog", "Get version history", {}, async () => {
			return { content: [{ type: "text", text: getChangelog() }] };
		});

		this.server.tool("daemon_registry_random", "Discover a random daemon", {}, async () => {
			const registry = await loadRegistry(getKV());
			const result = await getRandomDaemon(registry.entries);
			return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
		});

		// Registry tools
		this.server.tool("daemon_registry_list", "List all daemons", {}, async () => {
			const { entries, updated } = await registryList(getKV());
			return { content: [{ type: "text", text: JSON.stringify({ count: entries.length, daemons: entries, updated }, null, 2) }] };
		});

		this.server.tool(
			"daemon_registry_search",
			"Search daemons",
			{
				query: z.string().optional().describe("Search query"),
				tag: z.string().optional().describe("Filter by tag"),
				status: z.enum(["mcp", "web", "offline"]).optional().describe("Filter by status"),
			},
			async ({ query, tag, status }) => {
				const entries = await registrySearch(getKV(), query, tag, status);
				return { content: [{ type: "text", text: JSON.stringify({ query, tag, status, count: entries.length, daemons: entries }, null, 2) }] };
			}
		);

		this.server.tool(
			"daemon_registry_announce",
			"Register a new daemon",
			{
				id: z.string().optional().describe("Namespace-based ID (auto-derived from URL if not provided)"),
				url: z.string().describe("Daemon URL"),
				owner: z.string().describe("Owner name"),
				role: z.string().optional().describe("Role/title"),
				focus: z.array(z.string()).optional().describe("Focus areas"),
				protocol: z.string().optional().describe("Protocol type"),
				mcp_url: z.string().optional().describe("MCP API URL"),
				tags: z.array(z.string()).optional().describe("Tags"),
			},
			async ({ id, url, owner, role, focus, protocol, mcp_url, tags }) => {
				const result = await registryAnnounce(getKV(), {
					id, // Optional - auto-derived from URL if not provided
					url, owner, role, focus,
					protocol: protocol || "unknown",
					mcp_url,
					tags: tags || [],
				});
				return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
			}
		);

		this.server.tool(
			"daemon_registry_health_check",
			"Check daemon health",
			{ url: z.string().describe("Daemon URL") },
			async ({ url }) => {
				const result = await registryHealthCheck(getKV(), url);
				return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
			}
		);

		this.server.tool(
			"daemon_registry_activity",
			"Get activity feed",
			{
				limit: z.number().optional().describe("Max events"),
				type: z.enum(["daemon_announced", "health_changed", "daemon_verified"]).optional().describe("Event type"),
			},
			async ({ limit, type }) => {
				const result = await registryActivity(getKV(), limit, type);
				return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
			}
		);

		this.server.tool(
			"daemon_registry_capabilities",
			"Discover daemon capabilities",
			{ url: z.string().describe("Daemon URL") },
			async ({ url }) => {
				const kv = getKV();
				const registry = kv ? await loadRegistry(kv) : { entries: [] };
				const entry = registry.entries.find(e => e.url === url || e.mcp_url === url);
				const result = await discoverCapabilities(url, entry?.mcp_url);
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

		// JSON-RPC handler
		if ((url.pathname === "/" || url.pathname === "/mcp") && request.method === "POST") {
			try {
				const body = await request.json();
				const clientIp = request.headers.get("CF-Connecting-IP") ||
					request.headers.get("X-Forwarded-For")?.split(",")[0] || "unknown";
				return handleJsonRpc(body, env.REGISTRY_DATA, clientIp);
			} catch {
				return new Response(
					JSON.stringify({ jsonrpc: "2.0", error: { code: -32700, message: "Parse error" }, id: null }),
					{ headers: { "Content-Type": "application/json" } }
				);
			}
		}

		// SSE transport
		if (url.pathname === "/sse" || url.pathname === "/sse/message") {
			return RegistryMCP.serveSSE("/sse").fetch(request, env, ctx);
		}

		// Health check
		if (url.pathname === "/health") {
			return new Response(
				JSON.stringify({ status: "ok", service: "daemon-registry" }),
				{ headers: { "Content-Type": "application/json" } }
			);
		}

		return new Response("Daemon Registry. POST to / for JSON-RPC or connect to /sse for SSE transport.", { status: 200 });
	},

	// Cron trigger for health checks
	async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
		const kv = env.REGISTRY_DATA;
		const currentMinute = new Date(event.scheduledTime).getMinutes();

		const registry = await loadRegistry(kv);
		const updates: { url: string; owner: string; oldStatus?: string; update: Partial<DaemonEntry> }[] = [];

		for (const entry of registry.entries) {
			const checkMinute = getDaemonCheckMinute(entry.url);
			if (checkMinute !== currentMinute) continue;

			try {
				const healthUpdate = await healthCheckDaemon(entry);
				updates.push({ url: entry.url, owner: entry.owner, oldStatus: entry.status, update: healthUpdate });
			} catch (e) {
				console.error(`Health check failed for ${entry.url}:`, e);
			}
		}

		if (updates.length > 0) {
			const announced = await getAnnouncedFromKV(kv);
			let updated = false;

			for (const { url, owner, oldStatus, update } of updates) {
				const idx = announced.findIndex(e => e.url === url);
				if (idx >= 0) {
					announced[idx] = { ...announced[idx], ...update };
					updated = true;
				}

				if (oldStatus && update.status && oldStatus !== update.status) {
					await addActivityEvent(kv, {
						type: "health_changed",
						daemon_url: url,
						daemon_owner: owner,
						details: { old_status: oldStatus, new_status: update.status },
					});
				}
			}

			if (updated) {
				await saveAnnouncedToKV(kv, announced);
			}
		}

		console.log(`Health check at minute ${currentMinute}: ${updates.length} daemons checked`);
	},
};
