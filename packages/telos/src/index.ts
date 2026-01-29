import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { z } from "zod";

import { getDaemonSections, SECTION_MAP } from "./lib/daemon-md";
import { PERSONAL_TOOLS, META_TOOLS, getOrientation, getMcpConfig } from "./tools/personal";

const TOOLS = [...META_TOOLS, ...PERSONAL_TOOLS];

// Cloudflare environment
interface Env {
	MCP_OBJECT: DurableObjectNamespace;
}

// CORS headers
const corsHeaders = {
	"Content-Type": "application/json",
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "POST, OPTIONS",
	"Access-Control-Allow-Headers": "Content-Type",
};

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

// JSON-RPC handler
async function handleJsonRpc(body: any): Promise<Response> {
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
			const sections = await getDaemonSections();

			// Meta tools
			if (toolName === "get_orientation") {
				return jsonRpcResponse(getOrientation(), id);
			}
			if (toolName === "get_mcp_config") {
				return jsonRpcResponse(JSON.stringify(getMcpConfig(), null, 2), id);
			}

			// get_all
			if (toolName === "get_all") {
				return jsonRpcResponse(JSON.stringify(sections, null, 2), id);
			}

			// get_section
			if (toolName === "get_section") {
				const sectionName = params?.arguments?.section?.toUpperCase().replace(/\s+/g, "_");
				const content = sections[sectionName];
				if (!content) {
					const available = Object.keys(sections).join(", ");
					return jsonRpcResponse(`Section "${sectionName}" not found. Available: ${available}`, id);
				}
				return jsonRpcResponse(content, id);
			}

			// Standard personal tools
			const sectionKey = SECTION_MAP[toolName];
			if (sectionKey) {
				const content = sections[sectionKey] || `No ${sectionKey.toLowerCase()} found`;
				return jsonRpcResponse(content, id);
			}

			return jsonRpcError(-32601, `Unknown tool: ${toolName}`, id);
		}

		return jsonRpcError(-32601, `Method not found: ${method}`, id);
	} catch (error) {
		return jsonRpcError(-32000, String(error), id);
	}
}

// Durable Object for SSE transport
export class TelosMCP extends McpAgent {
	server = new McpServer({
		name: "Swift's Personal Daemon",
		version: "1.0.0",
	});

	async init() {
		// Meta tools
		this.server.tool("get_orientation", "START HERE - Learn about Swift's daemon", {}, async () => {
			return { content: [{ type: "text", text: getOrientation() }] };
		});

		this.server.tool("get_mcp_config", "Get MCP configuration snippet", {}, async () => {
			return { content: [{ type: "text", text: JSON.stringify(getMcpConfig(), null, 2) }] };
		});

		// get_all
		this.server.tool("get_all", "Get all daemon information", {}, async () => {
			const sections = await getDaemonSections();
			return { content: [{ type: "text", text: JSON.stringify(sections, null, 2) }] };
		});

		// get_section
		this.server.tool(
			"get_section",
			"Get any section by name",
			{ section: z.string().describe("Section name (uppercase)") },
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

		// Register personal tools
		for (const tool of PERSONAL_TOOLS) {
			if (tool.name === "get_all" || tool.name === "get_section") continue;

			const sectionKey = SECTION_MAP[tool.name];
			if (sectionKey) {
				this.server.tool(tool.name, tool.description, {}, async () => {
					const sections = await getDaemonSections();
					return { content: [{ type: "text", text: sections[sectionKey] || `No ${sectionKey.toLowerCase()} found` }] };
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

		// JSON-RPC handler
		if ((url.pathname === "/" || url.pathname === "/mcp") && request.method === "POST") {
			try {
				const body = await request.json();
				return handleJsonRpc(body);
			} catch {
				return new Response(
					JSON.stringify({ jsonrpc: "2.0", error: { code: -32700, message: "Parse error" }, id: null }),
					{ headers: { "Content-Type": "application/json" } }
				);
			}
		}

		// SSE transport
		if (url.pathname === "/sse" || url.pathname === "/sse/message") {
			return TelosMCP.serveSSE("/sse").fetch(request, env, ctx);
		}

		// Health check
		if (url.pathname === "/health") {
			return new Response(
				JSON.stringify({ status: "ok", service: "telos-daemon" }),
				{ headers: { "Content-Type": "application/json" } }
			);
		}

		return new Response("Swift's Personal Daemon (Telos). POST to / for JSON-RPC or connect to /sse for SSE transport.", { status: 200 });
	},
};
