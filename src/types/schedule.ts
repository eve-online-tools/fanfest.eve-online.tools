/** Contrast for text on solid accent headers. */
export type HeaderTextColor = "dark" | "light";

export interface Room {
	id: string;
	label: string;
	shortLabel?: string;
	accent: string;
	headerTextColor?: HeaderTextColor;
}

export interface TagDefinition {
	id: string;
	label: string;
	color?: string;
	/** Shown in a click-open popover on event tag pills when set. */
	description?: string;
}

export interface Event {
	id: string;
	/** ISO date `YYYY-MM-DD` (conference local calendar day). */
	day: string;
	roomId: string;
	/** Tag catalog ids (same key as root `tags` catalog). */
	tags: string[];
	/** `HH:mm` 24h, conference-local. */
	start: string;
	title: string;
	speakers?: string[];
	/** Minutes; omit or `0` = start time only (no displayed end). Positive = session length; start and end are shown. */
	duration?: number;
	highlight?: boolean;
	notes?: string;
}

export interface ScheduleMeta {
	conferenceName: string;
	year: number;
	/** IANA zone for “now” / Today (e.g. `Atlantic/Reykjavik`). */
	timezone: string;
	disclaimer?: string;
	/** Con days in order (Thu→Sat). */
	days: string[];
}

export interface ScheduleConfig {
	meta: ScheduleMeta;
	rooms: Room[];
	tags: TagDefinition[];
	events: Event[];
}

/** Event with computed end time and minute fields for sorting and “now”. */
export interface EnrichedEvent extends Event {
	duration: number;
	/** `HH:mm` end same day when the session has a length; empty when only start is shown. */
	end: string;
	startMinutes: number;
	endMinutes: number;
}
