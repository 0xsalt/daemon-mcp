// Registry types

export interface DaemonEntry {
	// Identity (stable, namespace-based, ARC-compatible)
	// Format: <reversed-domain>.<identifier>
	// Example: "io.saltedkeys.swift", "com.danielmiessler.daniel"
	// Future: prefix with "arc:" when ARC spec finalizes
	id: string;

	// Endpoints (can change without breaking identity)
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

	// Future ARC fields (optional until ARC integration)
	content_hash?: string; // SHA256 of daemon.md content
}

export interface Registry {
	version: number;
	entries: DaemonEntry[];
	updated: string;
}

// Activity feed types
export interface ActivityEvent {
	type: "daemon_announced" | "health_changed" | "daemon_verified";
	daemon_url: string;
	daemon_owner: string;
	timestamp: string;
	details?: Record<string, unknown>;
}

// Rate limiting
export interface RateLimitRecord {
	count: number;
	windowStart: number;
}

// Daemon capabilities (from tools/list response)
export interface DaemonCapabilities {
	url: string;
	mcp_url?: string;
	supports_mcp: boolean;
	tools?: { name: string; description: string }[];
	error?: string;
	checked_at: string;
}

// Cloudflare environment bindings
export interface Env {
	REGISTRY_DATA: KVNamespace;
	MCP_OBJECT: DurableObjectNamespace;
}
