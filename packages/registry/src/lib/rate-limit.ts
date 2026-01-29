import type { RateLimitRecord } from "../types";

// Rate limiting config
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const RATE_LIMIT_MAX_ANNOUNCES = 5; // Max 5 announces per hour per IP
const KV_RATE_LIMIT_PREFIX = "rate_limit:";

export async function checkRateLimit(
	kv: KVNamespace,
	ip: string
): Promise<{ allowed: boolean; remaining: number; resetIn: number }> {
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

	return {
		allowed: true,
		remaining: RATE_LIMIT_MAX_ANNOUNCES - record.count - 1,
		resetIn: RATE_LIMIT_WINDOW_MS - (now - record.windowStart)
	};
}

export async function recordRateLimitHit(kv: KVNamespace, ip: string): Promise<void> {
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
