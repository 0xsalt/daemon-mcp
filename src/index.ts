import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { z } from "zod";
import seedRegistry from "../seed-registry.json";

// Version info
const VERSION = "0.3.0-alpha";
const MCP_URL = "https://mcp.daemon.saltedkeys.io";
const DAEMON_OWNER = "Swift";

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

	// Verification (checked on announce)
	verified: boolean;
	verified_at?: string;

	// Health tracking (updated by cron)
	// status: mcp = speaks MCP, web = website only, offline = can't reach
	// healthy: true = working as expected, false = something wrong
	last_checked?: string;
	status?: "mcp" | "web" | "offline";
	healthy?: boolean;
}

interface Registry {
	version: number;
	entries: DaemonEntry[];
	updated: string;
}

// Activity feed types
interface ActivityEvent {
	type: "daemon_announced" | "health_changed" | "daemon_verified";
	daemon_url: string;
	daemon_owner: string;
	timestamp: string;
	details?: Record<string, unknown>;
}

// Activity feed config
const ACTIVITY_FEED_MAX_EVENTS = 100; // Keep last 100 events

// KV keys
const KV_ANNOUNCED_KEY = "announced_daemons";
const KV_RATE_LIMIT_PREFIX = "rate_limit:";
const KV_ACTIVITY_KEY = "activity_feed";

// Rate limiting config
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const RATE_LIMIT_MAX_ANNOUNCES = 5; // Max 5 announces per hour per IP

// Health check jitter config
const HEALTH_CHECK_INTERVAL_MINUTES = 60; // Check each daemon every 60 minutes

// Simple hash function for URL-based jitter offset
function hashCode(str: string): number {
	let hash = 0;
	for (let i = 0; i < str.length; i++) {
		const char = str.charCodeAt(i);
		hash = ((hash << 5) - hash) + char;
		hash = hash & hash; // Convert to 32bit integer
	}
	return Math.abs(hash);
}

// Get the minute offset for a daemon based on its URL hash
function getDaemonCheckMinute(url: string): number {
	return hashCode(url) % HEALTH_CHECK_INTERVAL_MINUTES;
}

// In-memory cache (refreshed from KV on each request)
let registryCache: Registry | null = null;

// Load registry from seed + KV
async function loadRegistry(kv?: KVNamespace): Promise<Registry> {
	// Start with seed entries (cast to handle JSON import types)
	const entries: DaemonEntry[] = (seedRegistry.entries as unknown as DaemonEntry[]).map(e => ({ ...e }));

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

// Activity feed functions
async function loadActivityFeed(kv: KVNamespace): Promise<ActivityEvent[]> {
	try {
		const events = await kv.get<ActivityEvent[]>(KV_ACTIVITY_KEY, "json");
		return events || [];
	} catch (e) {
		console.error("Failed to load activity feed from KV:", e);
		return [];
	}
}

async function addActivityEvent(kv: KVNamespace, event: Omit<ActivityEvent, "timestamp">): Promise<void> {
	const events = await loadActivityFeed(kv);
	const newEvent: ActivityEvent = {
		...event,
		timestamp: new Date().toISOString(),
	};

	// Add to front, keep max events
	events.unshift(newEvent);
	if (events.length > ACTIVITY_FEED_MAX_EVENTS) {
		events.length = ACTIVITY_FEED_MAX_EVENTS;
	}

	await kv.put(KV_ACTIVITY_KEY, JSON.stringify(events));
}

// Save announced daemons to KV
async function saveAnnouncedToKV(kv: KVNamespace, announced: DaemonEntry[]): Promise<void> {
	await kv.put(KV_ANNOUNCED_KEY, JSON.stringify(announced));
}

// Rate limiting
interface RateLimitRecord {
	count: number;
	windowStart: number;
}

async function checkRateLimit(kv: KVNamespace, ip: string): Promise<{ allowed: boolean; remaining: number; resetIn: number }> {
	const key = `${KV_RATE_LIMIT_PREFIX}${ip}`;
	const now = Date.now();

	const record = await kv.get<RateLimitRecord>(key, "json");

	if (!record || now - record.windowStart > RATE_LIMIT_WINDOW_MS) {
		// New window
		return { allowed: true, remaining: RATE_LIMIT_MAX_ANNOUNCES - 1, resetIn: RATE_LIMIT_WINDOW_MS };
	}

	if (record.count >= RATE_LIMIT_MAX_ANNOUNCES) {
		const resetIn = RATE_LIMIT_WINDOW_MS - (now - record.windowStart);
		return { allowed: false, remaining: 0, resetIn };
	}

	return { allowed: true, remaining: RATE_LIMIT_MAX_ANNOUNCES - record.count - 1, resetIn: RATE_LIMIT_WINDOW_MS - (now - record.windowStart) };
}

async function recordRateLimitHit(kv: KVNamespace, ip: string): Promise<void> {
	const key = `${KV_RATE_LIMIT_PREFIX}${ip}`;
	const now = Date.now();

	const record = await kv.get<RateLimitRecord>(key, "json");

	if (!record || now - record.windowStart > RATE_LIMIT_WINDOW_MS) {
		// New window
		await kv.put(key, JSON.stringify({ count: 1, windowStart: now }), { expirationTtl: 3600 });
	} else {
		// Increment existing
		await kv.put(key, JSON.stringify({ count: record.count + 1, windowStart: record.windowStart }), { expirationTtl: 3600 });
	}
}

// Verify a daemon by fetching its daemon.md
async function verifyDaemon(daemonUrl: string): Promise<{ verified: boolean; error?: string }> {
	// Normalize URL and construct daemon.md path
	const baseUrl = daemonUrl.endsWith("/") ? daemonUrl : `${daemonUrl}/`;
	const daemonMdUrl = `${baseUrl}daemon.md`;

	try {
		const response = await fetch(daemonMdUrl, {
			headers: { "User-Agent": "DaemonRegistry/1.0" },
			signal: AbortSignal.timeout(10000), // 10 second timeout
		});

		if (!response.ok) {
			return { verified: false, error: `HTTP ${response.status}` };
		}

		const content = await response.text();

		// Basic validation: should have at least one section header
		if (!content.includes("[") || content.length < 50) {
			return { verified: false, error: "Invalid daemon.md format" };
		}

		return { verified: true };
	} catch (e) {
		const error = e instanceof Error ? e.message : "Unknown error";
		return { verified: false, error };
	}
}

// Check if URL responds to MCP tools/list
async function checkMcpCapability(daemonUrl: string): Promise<boolean> {
	const baseUrl = daemonUrl.endsWith("/") ? daemonUrl.slice(0, -1) : daemonUrl;

	try {
		const response = await fetch(baseUrl, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"User-Agent": "DaemonRegistry/1.0"
			},
			body: JSON.stringify({
				jsonrpc: "2.0",
				method: "tools/list",
				id: 1
			}),
			signal: AbortSignal.timeout(10000),
		});

		if (!response.ok) return false;

		const data = await response.json() as { result?: { tools?: unknown[] } };
		// Check for valid MCP response structure
		return data?.result?.tools !== undefined;
	} catch {
		return false;
	}
}

// Check if URL is reachable as a web page
async function checkWebReachable(daemonUrl: string): Promise<boolean> {
	try {
		const response = await fetch(daemonUrl, {
			method: "GET",
			headers: { "User-Agent": "DaemonRegistry/1.0" },
			signal: AbortSignal.timeout(10000),
		});
		return response.ok;
	} catch {
		return false;
	}
}

// Health check a daemon (called by cron)
// Returns status: mcp (speaks MCP), web (website only), offline (can't reach)
async function healthCheckDaemon(entry: DaemonEntry): Promise<Partial<DaemonEntry>> {
	const now = new Date().toISOString();

	// Check both web and MCP availability in parallel
	const [webReachable, mcpReachable] = await Promise.all([
		checkWebReachable(entry.url),
		checkMcpCapability(entry.url)
	]);

	// Also check daemon.md for legacy verification (counts as MCP-capable)
	const { verified } = await verifyDaemon(entry.url);

	// Determine status: mcp > web > offline
	// MCP capability (either tools/list responds OR has valid daemon.md)
	if (mcpReachable || verified) {
		return {
			last_checked: now,
			status: "mcp",
			healthy: true,
		};
	}

	// Web only - site is up but no MCP capability (still healthy - it's working as intended)
	if (webReachable) {
		return {
			last_checked: now,
			status: "web",
			healthy: true,
		};
	}

	// Nothing responds
	return {
		last_checked: now,
		status: "offline",
		healthy: false,
	};
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
		description: "Search daemons by name, owner, tags, focus area, or health status",
		inputSchema: {
			type: "object",
			properties: {
				query: { type: "string", description: "Search query (matches owner, role, focus, tags)" },
				tag: { type: "string", description: "Filter by specific tag" },
				status: { type: "string", enum: ["mcp", "web", "offline"], description: "Filter by status (mcp=speaks MCP, web=website only, offline=unreachable)" }
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
	{
		name: "daemon_registry_health_check",
		description: "Manually trigger a health check for a specific daemon",
		inputSchema: {
			type: "object",
			properties: {
				url: { type: "string", description: "Daemon URL to check" }
			},
			required: ["url"]
		}
	},
	{
		name: "daemon_registry_activity",
		description: "Get recent activity feed (announcements, health changes)",
		inputSchema: {
			type: "object",
			properties: {
				limit: { type: "number", description: "Maximum number of events to return (default: 20)" },
				type: { type: "string", enum: ["daemon_announced", "health_changed", "daemon_verified"], description: "Filter by event type" }
			},
			required: []
		}
	},
	{
		name: "daemon_registry_capabilities",
		description: "Discover MCP tools/capabilities supported by a daemon",
		inputSchema: {
			type: "object",
			properties: {
				url: { type: "string", description: "Daemon URL or MCP URL to query for capabilities" }
			},
			required: ["url"]
		}
	},
];

// Meta/discoverability tool definitions
const META_TOOLS = [
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
		description: "AI-specific usage guidance - how to effectively use this daemon as an AI assistant",
		inputSchema: { type: "object", properties: {}, required: [] }
	},
	{
		name: "get_status",
		description: "Get daemon status - version, health, registry stats",
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

// Order matters: META first (orientation), then REGISTRY (primary purpose), then DAEMON (personal, secondary)
const TOOLS = [...META_TOOLS, ...REGISTRY_TOOLS, ...DAEMON_TOOLS];

// Registry functions
async function registryList(kv?: KVNamespace): Promise<{ entries: DaemonEntry[]; updated: string }> {
	const registry = await loadRegistry(kv);
	return { entries: registry.entries, updated: registry.updated };
}

async function registrySearch(kv: KVNamespace | undefined, query?: string, tag?: string, healthStatus?: "mcp" | "web" | "offline"): Promise<DaemonEntry[]> {
	const registry = await loadRegistry(kv);
	let results = registry.entries;

	if (tag) {
		const normalizedTag = tag.toLowerCase();
		results = results.filter(entry =>
			entry.tags?.some(t => t.toLowerCase() === normalizedTag)
		);
	}

	if (healthStatus) {
		results = results.filter(entry => entry.status === healthStatus);
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
	entry: Omit<DaemonEntry, "announced_at" | "verified" | "verified_at">,
	clientIp?: string
): Promise<{ success: boolean; entry: DaemonEntry; message: string; verification_error?: string; rate_limit?: { remaining: number; resetIn: number } }> {
	// Rate limiting check
	if (kv && clientIp) {
		const rateLimit = await checkRateLimit(kv, clientIp);
		if (!rateLimit.allowed) {
			return {
				success: false,
				entry: entry as DaemonEntry,
				message: `Rate limit exceeded. Try again in ${Math.ceil(rateLimit.resetIn / 60000)} minutes.`,
				rate_limit: { remaining: 0, resetIn: rateLimit.resetIn }
			};
		}
	}

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

	// Verify the daemon by fetching daemon.md
	const verification = await verifyDaemon(entry.url);
	const now = new Date().toISOString();

	const newEntry: DaemonEntry = {
		...entry,
		announced_at: now,
		verified: verification.verified,
		verified_at: now,
		last_checked: now,
		status: verification.verified ? "mcp" : "web",
		healthy: true, // If we can reach it at all, it's healthy
	};

	// Persist to KV if available
	if (kv) {
		// Get current announced list (excluding seed entries)
		const announced = await kv.get<DaemonEntry[]>(KV_ANNOUNCED_KEY, "json") || [];
		announced.push(newEntry);
		await saveAnnouncedToKV(kv, announced);

		// Record rate limit hit for successful announce
		if (clientIp) {
			await recordRateLimitHit(kv, clientIp);
		}

		// Add activity event
		await addActivityEvent(kv, {
			type: "daemon_announced",
			daemon_url: entry.url,
			daemon_owner: entry.owner,
			details: { verified: verification.verified },
		});
	}

	const message = verification.verified
		? "Daemon announced and verified successfully"
		: "Daemon announced but verification failed (daemon.md not accessible)";

	// Get remaining rate limit for response
	let rateLimit: { remaining: number; resetIn: number } | undefined;
	if (kv && clientIp) {
		const rl = await checkRateLimit(kv, clientIp);
		rateLimit = { remaining: rl.remaining, resetIn: rl.resetIn };
	}

	return {
		success: true,
		entry: newEntry,
		message,
		verification_error: verification.error,
		rate_limit: rateLimit,
	};
}

// Manual health check for a specific daemon
async function registryHealthCheck(
	kv: KVNamespace | undefined,
	url: string
): Promise<{ success: boolean; entry?: DaemonEntry; health_update?: Partial<DaemonEntry>; message: string }> {
	const registry = await loadRegistry(kv);

	// Find the daemon
	const entry = registry.entries.find(e => e.url === url);
	if (!entry) {
		return { success: false, message: `Daemon not found: ${url}` };
	}

	// Perform health check
	const healthUpdate = await healthCheckDaemon(entry);
	const updatedEntry = { ...entry, ...healthUpdate };

	// Update in KV if it's an announced daemon
	if (kv) {
		const announced = await kv.get<DaemonEntry[]>(KV_ANNOUNCED_KEY, "json") || [];
		const idx = announced.findIndex(e => e.url === url);
		if (idx >= 0) {
			announced[idx] = { ...announced[idx], ...healthUpdate };
			await saveAnnouncedToKV(kv, announced);
		}
	}

	return {
		success: true,
		entry: updatedEntry,
		health_update: healthUpdate,
		message: `Health check completed: ${healthUpdate.status}`
	};
}

// Get activity feed with optional filters
async function registryActivity(
	kv: KVNamespace | undefined,
	limit?: number,
	eventType?: ActivityEvent["type"]
): Promise<{ events: ActivityEvent[]; total: number }> {
	if (!kv) {
		return { events: [], total: 0 };
	}

	let events = await loadActivityFeed(kv);

	// Filter by type if specified
	if (eventType) {
		events = events.filter(e => e.type === eventType);
	}

	const total = events.length;

	// Apply limit
	const maxEvents = limit || 20;
	events = events.slice(0, maxEvents);

	return { events, total };
}

// Discover MCP capabilities of a daemon
interface DaemonCapabilities {
	url: string;
	mcp_url?: string;
	supports_mcp: boolean;
	tools?: { name: string; description: string }[];
	error?: string;
	checked_at: string;
}

async function discoverCapabilities(url: string, mcpUrl?: string): Promise<DaemonCapabilities> {
	const targetUrl = mcpUrl || url;
	const now = new Date().toISOString();

	try {
		// Try to list tools via JSON-RPC
		const response = await fetch(targetUrl, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"User-Agent": "DaemonRegistry/1.0",
			},
			body: JSON.stringify({
				jsonrpc: "2.0",
				method: "tools/list",
				id: 1,
			}),
			signal: AbortSignal.timeout(10000),
		});

		if (!response.ok) {
			return {
				url,
				mcp_url: mcpUrl,
				supports_mcp: false,
				error: `HTTP ${response.status}`,
				checked_at: now,
			};
		}

		const result = await response.json() as { result?: { tools?: { name: string; description: string }[] }; error?: { message: string } };

		if (result.error) {
			return {
				url,
				mcp_url: mcpUrl,
				supports_mcp: false,
				error: result.error.message,
				checked_at: now,
			};
		}

		const tools = result.result?.tools || [];

		return {
			url,
			mcp_url: mcpUrl,
			supports_mcp: true,
			tools: tools.map(t => ({ name: t.name, description: t.description })),
			checked_at: now,
		};
	} catch (e) {
		const error = e instanceof Error ? e.message : "Unknown error";
		return {
			url,
			mcp_url: mcpUrl,
			supports_mcp: false,
			error,
			checked_at: now,
		};
	}
}

// Meta tool functions
function getOrientation(): string {
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

## About This Server
This registry is hosted by ${DAEMON_OWNER} and also serves as ${DAEMON_OWNER}'s personal daemon. You can explore ${DAEMON_OWNER}'s info if you're curious:
- \`get_about\`, \`get_telos\`, \`get_mission\` - Personal info
- \`get_projects\` - Current work
- \`get_preferences\` - Tech/tool preferences

## Integration
- \`get_mcp_config\` - Add this server to Claude Code/Desktop
- \`get_protocol_info\` - Technical details for custom integrations
- \`ai_briefing\` - AI-specific usage guidance

## Learn More
- \`get_capabilities\` - Full categorized tool list
- \`get_changelog\` - Recent updates`;
}

function getMcpConfig(): object {
	return {
		description: "Add this to your Claude Code config (~/.claude/mcp_servers.json) or Claude Desktop settings",
		sse_config: {
			"daemon-saltedkeys": {
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
				params: { name: "get_about", arguments: {} },
				id: 1
			}
		}
	};
}

function getProtocolInfo(): string {
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

## Example: Call a Tool
\`\`\`bash
curl -X POST ${MCP_URL}/ \\
  -H "Content-Type: application/json" \\
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"get_telos","arguments":{}},"id":1}'
\`\`\`

## Health Check
GET \`${MCP_URL}/health\`

## Notes
- Protocol: JSON-RPC 2.0 over HTTP
- No authentication required (public API)
- CORS enabled for browser clients`;
}

function getAiBriefing(): string {
	return `# AI Assistant Briefing

You are interacting with ${DAEMON_OWNER}'s personal daemon - an API representing their identity, context, and preferences.

## How to Use This Effectively

### Before Making Recommendations
1. **Check preferences first**: Query \`get_preferences\` before suggesting tools, workflows, or approaches
2. **Understand context**: Use \`get_about\` and \`get_telos\` to understand their goals and focus areas
3. **Know their work**: \`get_projects\` shows what they're building

### When to Use Which Tools
- **Scheduling/availability**: Check \`get_daily_routine\`
- **Content recommendations**: Check \`get_favorite_books\`, \`get_favorite_movies\`, \`get_favorite_tv\` first
- **Technical decisions**: Align with philosophy from \`get_philosophy\`
- **Collaboration**: Explore \`daemon_registry_list\` to find other daemons

### The Daemon Network
This daemon is part of a decentralized network. You can:
- List known daemons: \`daemon_registry_list\`
- Search by focus area: \`daemon_registry_search\`
- Discover randomly: \`daemon_registry_random\`
- Check capabilities: \`daemon_registry_capabilities\`

### Best Practices
- Query context before making assumptions
- Respect stated preferences
- Reference their projects when relevant
- Suggest connections to other daemons when appropriate`;
}

async function getStatus(kv?: KVNamespace): Promise<object> {
	const registry = await loadRegistry(kv);

	return {
		status: "ok",
		version: VERSION,
		owner: DAEMON_OWNER,
		mcp_url: MCP_URL,
		protocol: "MCP JSON-RPC 2.0",
		registry: {
			daemon_count: registry.entries.length,
			mcp: registry.entries.filter(e => e.status === "mcp").length,
			web: registry.entries.filter(e => e.status === "web").length,
			offline: registry.entries.filter(e => e.status === "offline").length,
		},
		tools_count: TOOLS.length,
		timestamp: new Date().toISOString(),
	};
}

function getCapabilities(): object {
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
				tools: REGISTRY_TOOLS.map(t => ({ name: t.name, description: t.description }))
			},
			personal: {
				description: "Personal information about Swift (this server's host)",
				tools: DAEMON_TOOLS.map(t => ({ name: t.name, description: t.description }))
			}
		},
		total_tools: TOOLS.length
	};
}

function getChangelog(): string {
	return `# Changelog

## [0.3.0-alpha] - 2026-01-11

### Added
- Rate limiting for announce endpoint (5 announces per hour per IP)
- Per-daemon jitter for health checks (spreads checks across the hour)
- Filter by status in daemon_registry_search
- Manual health check trigger (daemon_registry_health_check)
- Activity feed (daemon_registry_activity)
- Capability discovery (daemon_registry_capabilities)
- **AI Discoverability Tools**:
  - get_orientation - First-contact intro
  - get_mcp_config - Integration snippets
  - get_protocol_info - Protocol details
  - ai_briefing - AI usage guidance
  - get_status - Enhanced health info
  - get_capabilities - Categorized tools
  - get_changelog - This changelog
  - daemon_registry_random - Random discovery

## [0.2.0-alpha] - 2026-01-11

### Added
- daemon_registry_list, daemon_registry_search, daemon_registry_announce
- Cloudflare KV persistence
- seed-registry.json with 4 community daemons

## [0.1.0-alpha] - 2026-01-10

### Added
- Initial MCP server with 14 tools
- JSON-RPC and SSE transports
- Health check endpoint

---
Full changelog: https://github.com/0xsalt/daemon-mcp/blob/main/CHANGELOG.md`;
}

async function getRandomDaemon(kv?: KVNamespace): Promise<object> {
	const registry = await loadRegistry(kv);
	if (registry.entries.length === 0) {
		return { error: "No daemons in registry" };
	}

	const randomIndex = Math.floor(Math.random() * registry.entries.length);
	const daemon = registry.entries[randomIndex];

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
async function handleJsonRpc(body: any, kv?: KVNamespace, clientIp?: string): Promise<Response> {
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

			// Meta/discoverability tools
			if (toolName === "get_orientation") {
				return new Response(
					JSON.stringify({
						jsonrpc: "2.0",
						result: { content: [{ type: "text", text: getOrientation() }] },
						id,
					}),
					{ headers }
				);
			}

			if (toolName === "get_mcp_config") {
				return new Response(
					JSON.stringify({
						jsonrpc: "2.0",
						result: { content: [{ type: "text", text: JSON.stringify(getMcpConfig(), null, 2) }] },
						id,
					}),
					{ headers }
				);
			}

			if (toolName === "get_protocol_info") {
				return new Response(
					JSON.stringify({
						jsonrpc: "2.0",
						result: { content: [{ type: "text", text: getProtocolInfo() }] },
						id,
					}),
					{ headers }
				);
			}

			if (toolName === "ai_briefing") {
				return new Response(
					JSON.stringify({
						jsonrpc: "2.0",
						result: { content: [{ type: "text", text: getAiBriefing() }] },
						id,
					}),
					{ headers }
				);
			}

			if (toolName === "get_status") {
				const status = await getStatus(kv);
				return new Response(
					JSON.stringify({
						jsonrpc: "2.0",
						result: { content: [{ type: "text", text: JSON.stringify(status, null, 2) }] },
						id,
					}),
					{ headers }
				);
			}

			if (toolName === "get_capabilities") {
				return new Response(
					JSON.stringify({
						jsonrpc: "2.0",
						result: { content: [{ type: "text", text: JSON.stringify(getCapabilities(), null, 2) }] },
						id,
					}),
					{ headers }
				);
			}

			if (toolName === "get_changelog") {
				return new Response(
					JSON.stringify({
						jsonrpc: "2.0",
						result: { content: [{ type: "text", text: getChangelog() }] },
						id,
					}),
					{ headers }
				);
			}

			if (toolName === "daemon_registry_random") {
				const result = await getRandomDaemon(kv);
				return new Response(
					JSON.stringify({
						jsonrpc: "2.0",
						result: { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] },
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
				const statusFilter = params?.arguments?.status;
				const entries = await registrySearch(kv, query, tag, statusFilter);
				return new Response(
					JSON.stringify({
						jsonrpc: "2.0",
						result: {
							content: [{
								type: "text",
								text: JSON.stringify({
									query: query || null,
									tag: tag || null,
									status: statusFilter || null,
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
				}, clientIp);
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

			if (toolName === "daemon_registry_health_check") {
				const url = params?.arguments?.url;
				if (!url) {
					return new Response(
						JSON.stringify({
							jsonrpc: "2.0",
							error: { code: -32602, message: "Missing required field: url" },
							id,
						}),
						{ headers }
					);
				}
				const result = await registryHealthCheck(kv, url);
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

			if (toolName === "daemon_registry_activity") {
				const limit = params?.arguments?.limit;
				const eventType = params?.arguments?.type;
				const result = await registryActivity(kv, limit, eventType);
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

			if (toolName === "daemon_registry_capabilities") {
				const url = params?.arguments?.url;
				if (!url) {
					return new Response(
						JSON.stringify({
							jsonrpc: "2.0",
							error: { code: -32602, message: "Missing required field: url" },
							id,
						}),
						{ headers }
					);
				}

				// Check if this is a known daemon to get its mcp_url
				const registry = await loadRegistry(kv);
				const entry = registry.entries.find(e => e.url === url || e.mcp_url === url);
				const mcpUrl = entry?.mcp_url;

				const result = await discoverCapabilities(url, mcpUrl);
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
			"Search daemons by name, owner, tags, focus area, or status",
			{
				query: z.string().optional().describe("Search query (matches owner, role, focus, tags)"),
				tag: z.string().optional().describe("Filter by specific tag"),
				status: z.enum(["mcp", "web", "offline"]).optional().describe("Filter by status (mcp=speaks MCP, web=website only, offline=unreachable)"),
			},
			async ({ query, tag, status }) => {
				const entries = await registrySearch(getKV(), query, tag, status);
				return {
					content: [{
						type: "text",
						text: JSON.stringify({ query: query || null, tag: tag || null, status: status || null, count: entries.length, daemons: entries }, null, 2)
					}]
				};
			}
		);

		// Note: SSE transport doesn't have rate limiting (no easy access to client IP)
		// This is acceptable as SSE is used by Claude Desktop, not likely for abuse
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

		this.server.tool(
			"daemon_registry_health_check",
			"Manually trigger a health check for a specific daemon",
			{
				url: z.string().describe("Daemon URL to check"),
			},
			async ({ url }) => {
				const result = await registryHealthCheck(getKV(), url);
				return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
			}
		);

		this.server.tool(
			"daemon_registry_activity",
			"Get recent activity feed (announcements, health changes)",
			{
				limit: z.number().optional().describe("Maximum number of events to return (default: 20)"),
				type: z.enum(["daemon_announced", "health_changed", "daemon_verified"]).optional().describe("Filter by event type"),
			},
			async ({ limit, type }) => {
				const result = await registryActivity(getKV(), limit, type);
				return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
			}
		);

		this.server.tool(
			"daemon_registry_capabilities",
			"Discover MCP tools/capabilities supported by a daemon",
			{
				url: z.string().describe("Daemon URL or MCP URL to query for capabilities"),
			},
			async ({ url }) => {
				// Check if this is a known daemon to get its mcp_url
				const kv = getKV();
				const registry = kv ? await loadRegistry(kv) : { entries: [] };
				const entry = registry.entries.find(e => e.url === url || e.mcp_url === url);
				const mcpUrl = entry?.mcp_url;

				const result = await discoverCapabilities(url, mcpUrl);
				return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
			}
		);

		// Meta/discoverability tools
		this.server.tool(
			"get_orientation",
			"START HERE - Learn what this daemon is, who owns it, and how to use it",
			{},
			async () => {
				return { content: [{ type: "text", text: getOrientation() }] };
			}
		);

		this.server.tool(
			"get_mcp_config",
			"Get MCP configuration snippet for Claude Code or other MCP clients",
			{},
			async () => {
				return { content: [{ type: "text", text: JSON.stringify(getMcpConfig(), null, 2) }] };
			}
		);

		this.server.tool(
			"get_protocol_info",
			"Get protocol details - transports, JSON-RPC examples, and endpoints",
			{},
			async () => {
				return { content: [{ type: "text", text: getProtocolInfo() }] };
			}
		);

		this.server.tool(
			"ai_briefing",
			"AI-specific usage guidance - how to effectively use this daemon as an AI assistant",
			{},
			async () => {
				return { content: [{ type: "text", text: getAiBriefing() }] };
			}
		);

		this.server.tool(
			"get_status",
			"Get daemon status - version, health, registry stats",
			{},
			async () => {
				const status = await getStatus(getKV());
				return { content: [{ type: "text", text: JSON.stringify(status, null, 2) }] };
			}
		);

		this.server.tool(
			"get_capabilities",
			"Get categorized list of all available tools",
			{},
			async () => {
				return { content: [{ type: "text", text: JSON.stringify(getCapabilities(), null, 2) }] };
			}
		);

		this.server.tool(
			"get_changelog",
			"Get recent changes and version history",
			{},
			async () => {
				return { content: [{ type: "text", text: getChangelog() }] };
			}
		);

		this.server.tool(
			"daemon_registry_random",
			"Discover a random daemon from the registry for exploration",
			{},
			async () => {
				const result = await getRandomDaemon(getKV());
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
				// Get client IP for rate limiting (CF-Connecting-IP header in production)
				const clientIp = request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For")?.split(",")[0] || "unknown";
				return handleJsonRpc(body, env.DAEMON_REGISTRY, clientIp);
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

	// Cron trigger for health checks (runs every minute, uses jitter to spread checks)
	async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
		const kv = env.DAEMON_REGISTRY;
		const currentMinute = new Date(event.scheduledTime).getMinutes();

		// Load all daemons (seed + announced)
		const registry = await loadRegistry(kv);

		// Health check only daemons whose URL hash matches current minute
		const updates: { url: string; owner: string; oldStatus?: string; update: Partial<DaemonEntry> }[] = [];
		const checkedDaemons: string[] = [];

		for (const entry of registry.entries) {
			const checkMinute = getDaemonCheckMinute(entry.url);

			// Only check this daemon if current minute matches its designated check minute
			if (checkMinute !== currentMinute) {
				continue;
			}

			try {
				const healthUpdate = await healthCheckDaemon(entry);
				updates.push({ url: entry.url, owner: entry.owner, oldStatus: entry.status, update: healthUpdate });
				checkedDaemons.push(entry.url);
			} catch (e) {
				console.error(`Health check failed for ${entry.url}:`, e);
			}
		}

		// Update announced daemons in KV with health data
		if (updates.length > 0) {
			const announced = await kv.get<DaemonEntry[]>(KV_ANNOUNCED_KEY, "json") || [];
			let updated = false;

			for (const { url, owner, oldStatus, update } of updates) {
				const idx = announced.findIndex(e => e.url === url);
				if (idx >= 0) {
					announced[idx] = { ...announced[idx], ...update };
					updated = true;
				}

				// Add activity event if status changed
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

		console.log(`Health check at minute ${currentMinute}: ${updates.length} daemons checked (${checkedDaemons.join(", ") || "none"})`);
	},
};
