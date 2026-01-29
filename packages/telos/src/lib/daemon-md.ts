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
export async function getDaemonSections(): Promise<Record<string, string>> {
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

// Section name mapping (tool name -> daemon.md section)
export const SECTION_MAP: Record<string, string> = {
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
