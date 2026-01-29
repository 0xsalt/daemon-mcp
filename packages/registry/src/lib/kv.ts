import type { DaemonEntry, Registry, ActivityEvent } from "../types";
import seedRegistry from "../../seed-registry.json";

// KV keys
const KV_ANNOUNCED_KEY = "announced_daemons";
const KV_ACTIVITY_KEY = "activity_feed";

// Activity feed config
const ACTIVITY_FEED_MAX_EVENTS = 100;

// Load registry from seed + KV
export async function loadRegistry(kv?: KVNamespace): Promise<Registry> {
	// Start with seed entries
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
export async function loadActivityFeed(kv: KVNamespace): Promise<ActivityEvent[]> {
	try {
		const events = await kv.get<ActivityEvent[]>(KV_ACTIVITY_KEY, "json");
		return events || [];
	} catch (e) {
		console.error("Failed to load activity feed from KV:", e);
		return [];
	}
}

export async function addActivityEvent(kv: KVNamespace, event: Omit<ActivityEvent, "timestamp">): Promise<void> {
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
export async function saveAnnouncedToKV(kv: KVNamespace, announced: DaemonEntry[]): Promise<void> {
	await kv.put(KV_ANNOUNCED_KEY, JSON.stringify(announced));
}

// Get announced daemons from KV
export async function getAnnouncedFromKV(kv: KVNamespace): Promise<DaemonEntry[]> {
	try {
		const announced = await kv.get<DaemonEntry[]>(KV_ANNOUNCED_KEY, "json");
		return announced || [];
	} catch {
		return [];
	}
}
