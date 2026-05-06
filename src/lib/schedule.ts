import type { EnrichedEvent, Room, ScheduleConfig } from "../types/schedule";

/** When `duration` is omitted or 0, UI shows start only; this span drives overlap / “now” / day bounds. */
const INTERNAL_POINT_EVENT_MINUTES = 60;

/** Minutes from midnight for `HH:mm`. */
export function timeToMinutes(hhmm: string): number {
	const [h, m] = hhmm.split(":").map(Number);
	return h * 60 + m;
}

/** `HH:mm` from minutes since midnight (clamped to same day). */
export function minutesToTime(total: number): string {
	const m = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
	const h = Math.floor(m / 60);
	const min = m % 60;
	return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

export function enrichEvent(e: ScheduleConfig["events"][number]): EnrichedEvent {
	const raw = e.duration;
	const hasDisplaySpan = raw != null && raw > 0;
	const spanMinutes = hasDisplaySpan ? raw : INTERNAL_POINT_EVENT_MINUTES;
	const startMinutes = timeToMinutes(e.start);
	const endMinutes = startMinutes + spanMinutes;
	const end = hasDisplaySpan ? minutesToTime(endMinutes) : "";
	return {
		...e,
		duration: hasDisplaySpan ? raw : 0,
		end,
		startMinutes,
		endMinutes,
	};
}

export interface EnrichedSchedule {
	config: ScheduleConfig;
	events: EnrichedEvent[];
	/** events grouped by day then room id (sorted by start). */
	byDayRoom: Map<string, Map<string, EnrichedEvent[]>>;
}

export function buildEnrichedSchedule(config: ScheduleConfig): EnrichedSchedule {
	const events = config.events.map(enrichEvent);
	const byDayRoom = new Map<string, Map<string, EnrichedEvent[]>>();

	for (const day of config.meta.days) {
		const roomMap = new Map<string, EnrichedEvent[]>();
		for (const r of config.rooms) roomMap.set(r.id, []);
		byDayRoom.set(day, roomMap);
	}

	for (const ev of events) {
		const roomMap = byDayRoom.get(ev.day);
		if (!roomMap) continue;
		const list = roomMap.get(ev.roomId);
		if (list) list.push(ev);
	}

	for (const [, roomMap] of byDayRoom) {
		for (const [, list] of roomMap) {
			list.sort((a, b) => a.startMinutes - b.startMinutes || a.id.localeCompare(b.id));
		}
	}

	return { config, events, byDayRoom };
}

/** Room ids that have at least one event on `day`, in catalog order. */
export function roomsUsedOnDay(config: ScheduleConfig, day: string): string[] {
	const ids = new Set(config.events.filter((e) => e.day === day).map((e) => e.roomId));
	return config.rooms.map((r) => r.id).filter((id) => ids.has(id));
}

export function getRoom(config: ScheduleConfig, roomId: string): Room | undefined {
	return config.rooms.find((r) => r.id === roomId);
}

export interface ClientBootstrap {
	meta: ScheduleConfig["meta"];
	rooms: ScheduleConfig["rooms"];
	tags: ScheduleConfig["tags"];
	events: EnrichedEvent[];
	days: string[];
}

export function toClientBootstrap(enriched: EnrichedSchedule): ClientBootstrap {
	return {
		meta: enriched.config.meta,
		rooms: enriched.config.rooms,
		tags: enriched.config.tags,
		events: enriched.events,
		days: enriched.config.meta.days,
	};
}
