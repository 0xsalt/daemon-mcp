import type { DaemonEntry } from "../types";

// Health check jitter config
const HEALTH_CHECK_INTERVAL_MINUTES = 60;

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
export function getDaemonCheckMinute(url: string): number {
	return hashCode(url) % HEALTH_CHECK_INTERVAL_MINUTES;
}

// Verify a daemon by fetching its daemon.md
export async function verifyDaemon(daemonUrl: string): Promise<{ verified: boolean; error?: string }> {
	const baseUrl = daemonUrl.endsWith("/") ? daemonUrl : `${daemonUrl}/`;
	const daemonMdUrl = `${baseUrl}daemon.md`;

	try {
		const response = await fetch(daemonMdUrl, {
			headers: { "User-Agent": "DaemonRegistry/1.0" },
			signal: AbortSignal.timeout(10000),
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
export async function checkMcpCapability(daemonUrl: string): Promise<boolean> {
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
		return data?.result?.tools !== undefined;
	} catch {
		return false;
	}
}

// Check if URL is reachable as a web page
export async function checkWebReachable(daemonUrl: string): Promise<boolean> {
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
export async function healthCheckDaemon(entry: DaemonEntry): Promise<Partial<DaemonEntry>> {
	const now = new Date().toISOString();

	// Check both web and MCP availability in parallel
	const [webReachable, mcpReachable] = await Promise.all([
		checkWebReachable(entry.url),
		checkMcpCapability(entry.url)
	]);

	// Also check daemon.md for legacy verification
	const { verified } = await verifyDaemon(entry.url);

	// Determine status: mcp > web > offline
	if (mcpReachable || verified) {
		return {
			last_checked: now,
			status: "mcp",
			healthy: true,
		};
	}

	if (webReachable) {
		return {
			last_checked: now,
			status: "web",
			healthy: true,
		};
	}

	return {
		last_checked: now,
		status: "offline",
		healthy: false,
	};
}
