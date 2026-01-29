import type { DaemonEntry, ActivityEvent, DaemonCapabilities } from "../types";
import { loadRegistry, addActivityEvent, saveAnnouncedToKV, loadActivityFeed, getAnnouncedFromKV } from "../lib/kv";
import { checkRateLimit, recordRateLimitHit } from "../lib/rate-limit";
import { verifyDaemon, healthCheckDaemon } from "../lib/health";

/**
 * Derive a namespace-based ID from a daemon URL.
 * Format: <reversed-domain>.<identifier>
 * Example: https://daemon.saltedkeys.io/ -> io.saltedkeys.daemon
 *          https://daemon.danielmiessler.com/ -> com.danielmiessler.daemon
 */
function deriveIdFromUrl(url: string, owner?: string): string {
	try {
		const parsed = new URL(url);
		const host = parsed.hostname;

		// Reverse the domain parts
		const parts = host.split('.').reverse();

		// Try to extract a meaningful identifier from the path or use owner name
		const pathPart = parsed.pathname.replace(/^\/|\/$/g, '').split('/')[0];
		let identifier = pathPart || 'daemon';

		// If owner is provided, use a sanitized version as identifier
		if (owner) {
			identifier = owner.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 20) || identifier;
		}

		return [...parts, identifier].join('.');
	} catch {
		// Fallback: use a hash of the URL
		return `unknown.${url.replace(/[^a-z0-9]/gi, '').substring(0, 32)}`;
	}
}

// Registry tool definitions
export const REGISTRY_TOOLS = [
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
				status: { type: "string", enum: ["mcp", "web", "offline"], description: "Filter by status" }
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
				id: { type: "string", description: "Namespace-based ID (e.g., io.saltedkeys.swift). Auto-derived from URL if not provided." },
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

// Registry functions
export async function registryList(kv?: KVNamespace): Promise<{ entries: DaemonEntry[]; updated: string }> {
	const registry = await loadRegistry(kv);
	return { entries: registry.entries, updated: registry.updated };
}

export async function registrySearch(
	kv: KVNamespace | undefined,
	query?: string,
	tag?: string,
	healthStatus?: "mcp" | "web" | "offline"
): Promise<DaemonEntry[]> {
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
			entry.id?.toLowerCase().includes(q) ||
			entry.owner.toLowerCase().includes(q) ||
			entry.role?.toLowerCase().includes(q) ||
			entry.focus?.some(f => f.toLowerCase().includes(q)) ||
			entry.tags?.some(t => t.toLowerCase().includes(q)) ||
			entry.url.toLowerCase().includes(q)
		);
	}

	return results;
}

export async function registryAnnounce(
	kv: KVNamespace | undefined,
	entry: Omit<DaemonEntry, "id" | "announced_at" | "verified" | "verified_at"> & { id?: string },
	clientIp?: string
): Promise<{
	success: boolean;
	entry: DaemonEntry;
	message: string;
	verification_error?: string;
	rate_limit?: { remaining: number; resetIn: number }
}> {
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

	// Derive ID from URL if not provided
	const id = entry.id || deriveIdFromUrl(entry.url, entry.owner);

	// Check if already exists (by URL or ID)
	const existingByUrl = registry.entries.find(e => e.url === entry.url);
	if (existingByUrl) {
		return { success: false, entry: existingByUrl, message: "Daemon already registered (URL exists)" };
	}
	const existingById = registry.entries.find(e => e.id === id);
	if (existingById) {
		return { success: false, entry: existingById, message: `Daemon ID already registered: ${id}` };
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
		id, // Use derived or provided ID
		announced_at: now,
		verified: verification.verified,
		verified_at: now,
		last_checked: now,
		status: verification.verified ? "mcp" : "web",
		healthy: true,
	};

	// Persist to KV if available
	if (kv) {
		const announced = await getAnnouncedFromKV(kv);
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

export async function registryHealthCheck(
	kv: KVNamespace | undefined,
	url: string
): Promise<{ success: boolean; entry?: DaemonEntry; health_update?: Partial<DaemonEntry>; message: string }> {
	const registry = await loadRegistry(kv);

	const entry = registry.entries.find(e => e.url === url);
	if (!entry) {
		return { success: false, message: `Daemon not found: ${url}` };
	}

	const healthUpdate = await healthCheckDaemon(entry);
	const updatedEntry = { ...entry, ...healthUpdate };

	// Update in KV if it's an announced daemon
	if (kv) {
		const announced = await getAnnouncedFromKV(kv);
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

export async function registryActivity(
	kv: KVNamespace | undefined,
	limit?: number,
	eventType?: ActivityEvent["type"]
): Promise<{ events: ActivityEvent[]; total: number }> {
	if (!kv) {
		return { events: [], total: 0 };
	}

	let events = await loadActivityFeed(kv);

	if (eventType) {
		events = events.filter(e => e.type === eventType);
	}

	const total = events.length;
	const maxEvents = limit || 20;
	events = events.slice(0, maxEvents);

	return { events, total };
}

export async function discoverCapabilities(url: string, mcpUrl?: string): Promise<DaemonCapabilities> {
	const targetUrl = mcpUrl || url;
	const now = new Date().toISOString();

	try {
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
