/** Format `YYYY-MM-DD` for headings using conference timezone. */
export function formatDayHeading(isoDay: string, timeZone: string): string {
	const [yy, mm, dd] = isoDay.split("-").map((x) => parseInt(x, 10));
	const utcNoon = Date.UTC(yy, mm - 1, dd, 12, 0, 0);
	return new Intl.DateTimeFormat("en-GB", {
		timeZone,
		weekday: "long",
		month: "short",
		day: "numeric",
	}).format(new Date(utcNoon));
}

/** Same as heading style plus year (e.g. banners). */
export function formatDayWithYear(isoDay: string, timeZone: string): string {
	const [yy, mm, dd] = isoDay.split("-").map((x) => parseInt(x, 10));
	const utcNoon = Date.UTC(yy, mm - 1, dd, 12, 0, 0);
	return new Intl.DateTimeFormat("en-GB", {
		timeZone,
		weekday: "long",
		month: "short",
		day: "numeric",
		year: "numeric",
	}).format(new Date(utcNoon));
}
