import type { Event, Room, ScheduleConfig, ScheduleMeta, TagDefinition } from "../types/schedule";

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function assert(cond: unknown, msg: string): asserts cond {
	if (!cond) throw new Error(`[schedule] ${msg}`);
}

function isRecord(x: unknown): x is Record<string, unknown> {
	return typeof x === "object" && x !== null && !Array.isArray(x);
}

function isString(x: unknown): x is string {
	return typeof x === "string";
}

function isStringArray(x: unknown): x is string[] {
	return Array.isArray(x) && x.every(isString);
}

function isOptionalString(x: unknown): x is string | undefined {
	return x === undefined || typeof x === "string";
}

function isOptionalStringArray(x: unknown): x is string[] | undefined {
	return x === undefined || isStringArray(x);
}

function parseMeta(raw: unknown): ScheduleMeta {
	assert(isRecord(raw), "meta must be an object");
	const { conferenceName, year, timezone, disclaimer, days } = raw;
	assert(isString(conferenceName), "meta.conferenceName must be a string");
	assert(typeof year === "number" && Number.isInteger(year), "meta.year must be an integer");
	assert(isString(timezone), "meta.timezone must be a string");
	assert(isOptionalString(disclaimer), "meta.disclaimer must be a string if present");
	assert(Array.isArray(days) && days.length > 0, "meta.days must be a non-empty array");
	for (const d of days) {
		assert(isString(d) && ISO_DATE_RE.test(d), `meta.days entry invalid: ${String(d)}`);
	}
	return {
		conferenceName,
		year,
		timezone,
		disclaimer,
		days,
	};
}

function parseRoom(raw: unknown, index: number): Room {
	assert(isRecord(raw), `rooms[${index}] must be an object`);
	const { id, label, shortLabel, accent, headerTextColor } = raw;
	assert(isString(id) && id.length > 0, `rooms[${index}].id invalid`);
	assert(isString(label), `rooms[${index}].label must be a string`);
	assert(isOptionalString(shortLabel), `rooms[${index}].shortLabel invalid`);
	assert(isString(accent), `rooms[${index}].accent must be a string`);
	assert(
		headerTextColor === undefined || headerTextColor === "dark" || headerTextColor === "light",
		`rooms[${index}].headerTextColor must be dark|light`,
	);
	return { id, label, shortLabel, accent, headerTextColor };
}

function parseTag(raw: unknown, index: number): TagDefinition {
	assert(isRecord(raw), `tags[${index}] must be an object`);
	const { id, label, color, description } = raw;
	assert(isString(id) && id.length > 0, `tags[${index}].id invalid`);
	assert(isString(label), `tags[${index}].label must be a string`);
	assert(color === undefined || isString(color), `tags[${index}].color invalid`);
	assert(description === undefined || isString(description), `tags[${index}].description invalid`);
	return { id, label, color, description };
}

function parseEvent(raw: unknown, index: number): Event {
	assert(isRecord(raw), `events[${index}] must be an object`);
	const {
		id,
		day,
		roomId,
		tags,
		start,
		title,
		speakers,
		duration,
		highlight,
		notes,
	} = raw;
	assert(isString(id) && id.length > 0, `events[${index}].id invalid`);
	assert(isString(day) && ISO_DATE_RE.test(day), `events[${index}].day invalid`);
	assert(isString(roomId), `events[${index}].roomId must be a string`);
	const tagsRaw = tags;
	assert(Array.isArray(tagsRaw), `events[${index}].tags must be an array`);
	for (const t of tagsRaw) assert(isString(t), `events[${index}].tags must be strings`);
	assert(isString(start) && TIME_RE.test(start), `events[${index}].start must be HH:mm`);
	assert(isString(title), `events[${index}].title must be a string`);
	assert(isOptionalStringArray(speakers), `events[${index}].speakers invalid`);
	assert(
		duration === undefined ||
			(typeof duration === "number" && Number.isInteger(duration) && duration >= 0),
		`events[${index}].duration invalid`,
	);
	assert(highlight === undefined || typeof highlight === "boolean", `events[${index}].highlight invalid`);
	assert(isOptionalString(notes), `events[${index}].notes invalid`);
	return {
		id,
		day,
		roomId,
		tags: tagsRaw as string[],
		start,
		title,
		speakers,
		duration,
		highlight,
		notes,
	};
}

/** Validate and return typed config. Throws on invalid data so `astro build` fails. */
export function parseAndValidateSchedule(raw: unknown): ScheduleConfig {
	assert(isRecord(raw), "root must be an object");
	const meta = parseMeta(raw.meta);
	const roomsRaw = raw.rooms;
	const tagsRaw = raw.tags;
	const eventsRaw = raw.events;
	assert(Array.isArray(roomsRaw) && roomsRaw.length > 0, "rooms must be a non-empty array");
	assert(Array.isArray(tagsRaw), "tags must be an array");
	assert(Array.isArray(eventsRaw), "events must be an array");

	const rooms = roomsRaw.map(parseRoom);
	const tags = tagsRaw.map(parseTag);
	const events = eventsRaw.map(parseEvent);

	const roomIds = new Set(rooms.map((r) => r.id));
	const tagIds = new Set(tags.map((t) => t.id));
	const eventIds = new Set<string>();

	const daySet = new Set(meta.days);

	for (const e of events) {
		assert(roomIds.has(e.roomId), `event ${e.id}: unknown roomId ${e.roomId}`);
		for (const tid of e.tags) assert(tagIds.has(tid), `event ${e.id}: unknown tag id ${tid}`);
		assert(daySet.has(e.day), `event ${e.id}: day ${e.day} not in meta.days`);
		assert(!eventIds.has(e.id), `duplicate event id: ${e.id}`);
		eventIds.add(e.id);
	}

	return { meta, rooms, tags, events };
}
