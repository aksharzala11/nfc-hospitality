/**
 * Time helpers. All schedule times are stored in UTC and displayed in the
 * event's timezone (EVENT_TZ). "Now" can be overridden for demos via the
 * ?now= query parameter when ALLOW_TIME_TRAVEL=true.
 */

export const EVENT_TZ = process.env.EVENT_TZ ?? "America/New_York";

/** Programme days (Thu arrival evening through Sun departures), as YYYY-MM-DD in EVENT_TZ. */
export const EVENT_DAYS = ["2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11"] as const;
export type EventDay = (typeof EVENT_DAYS)[number];

/** Short label for each day, matching the printed schedule/menu. */
export const DAY_LABELS: Record<string, string> = {
  "2026-10-08": "Arrival",
  "2026-10-09": "Day 2",
  "2026-10-10": "Day 3",
  "2026-10-11": "Departure",
};

export function dayLabel(day: string) {
  return DAY_LABELS[day] ?? formatDayShort(day);
}

/**
 * Days of the Pujya Santo general schedule (Mon Oct 5 through Thu Oct 15), as
 * YYYY-MM-DD in EVENT_TZ: the Santo view's day tabs and home. Must equal
 * SANT_SCHEDULE_DAYS in prisma/sant-schedule-data.ts (the sync refuses to run
 * otherwise); a superset of EVENT_DAYS.
 */
export const SANT_DAYS: readonly string[] = [
  "2026-10-05",
  "2026-10-06",
  "2026-10-07",
  "2026-10-08",
  "2026-10-09",
  "2026-10-10",
  "2026-10-11",
  "2026-10-12",
  "2026-10-13",
  "2026-10-14",
  "2026-10-15",
];

/** The Santo day (SANT_DAYS) containing `date` in EVENT_TZ, or null outside them. */
export function santDayOf(date: Date): string | null {
  const day = dayKey(date);
  return SANT_DAYS.includes(day) ? day : null;
}

/** e.g. "Oct 5–15" for a run of days in one month, else "Oct 30 – Nov 2". Empty for no days. */
export function formatDayRange(days: readonly string[]): string {
  if (days.length === 0) return "";
  const md = (day: string) =>
    new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" }).format(new Date(`${day}T12:00:00Z`));
  const first = days[0];
  const last = days[days.length - 1];
  if (first === last) return md(first);
  if (first.slice(0, 7) === last.slice(0, 7)) return `${md(first)}–${Number(last.slice(8))}`;
  return `${md(first)} – ${md(last)}`;
}

export function timeTravelAllowed() {
  return process.env.ALLOW_TIME_TRAVEL === "true";
}

/**
 * Resolve "now" for a request. Accepts an ISO-ish string such as
 * 2026-10-09T12:30 (interpreted in EVENT_TZ when no offset is given).
 */
export function resolveNow(nowParam?: string | string[] | null): Date {
  const raw = Array.isArray(nowParam) ? nowParam[0] : nowParam;
  if (raw && timeTravelAllowed()) {
    const parsed = parseInEventTz(raw);
    if (parsed && !Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}

/**
 * Parse "YYYY-MM-DDTHH:mm" (no offset) as EVENT_TZ wall-clock time, e.g. the
 * value of an <input type="datetime-local">, or `${day}T${hhmm}` for a time on a
 * known event day. Strings with an explicit offset/Z are parsed as-is.
 */
export function parseInEventTz(value: string): Date | null {
  if (/[zZ]|[+-]\d{2}:\d{2}$/.test(value)) return new Date(value);
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?$/);
  if (!m) return null;
  const [, y, mo, d, h = "00", mi = "00"] = m;
  // Find the UTC instant whose wall-clock in EVENT_TZ equals the given fields.
  const guess = Date.UTC(+y, +mo - 1, +d, +h, +mi);
  const offset = tzOffsetMinutes(new Date(guess));
  return new Date(guess - offset * 60 * 1000);
}

/** Offset of EVENT_TZ from UTC, in minutes, at the given instant. */
function tzOffsetMinutes(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: EVENT_TZ,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return (asUtc - date.getTime()) / 60000;
}

/**
 * Wall-clock "YYYY-MM-DDTHH:mm" of an instant in EVENT_TZ: the inverse of
 * parseInEventTz(), for prefilling <input type="datetime-local"> (slice(11) gives
 * "HH:mm" for <input type="time">).
 */
export function toEventLocalInput(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: EVENT_TZ,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

/** One formatter for dayKey(), which the schedule, menu and breakout views call per row. */
const DAY_KEY_FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: EVENT_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** YYYY-MM-DD of the instant in EVENT_TZ. */
export function dayKey(date: Date): string {
  return DAY_KEY_FORMAT.format(date);
}

export function formatTime(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: EVENT_TZ,
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function formatTimeRange(start: Date, end: Date): string {
  return `${formatTime(start)} – ${formatTime(end)}`;
}

/** e.g. "Thu, Oct 8" */
export function formatDayShort(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }).format(d);
}

/** e.g. "Thursday, October 8" */
export function formatDayLong(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric" }).format(d);
}

/** e.g. "Thursday" */
export function formatWeekday(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long" }).format(d);
}

/** e.g. "October 8" */
export function formatMonthDay(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", day: "numeric" }).format(d);
}

export function minutesBetween(a: Date, b: Date) {
  return Math.round((b.getTime() - a.getTime()) / 60000);
}

/** "in 25 min", "in 2 h 10 min", "in 3 days" */
export function formatRelative(from: Date, to: Date): string {
  const mins = minutesBetween(from, to);
  if (mins <= 0) return "now";
  if (mins < 60) return `in ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) {
    const rem = mins % 60;
    return rem ? `in ${hours} h ${rem} min` : `in ${hours} h`;
  }
  const days = Math.round(hours / 24);
  return `in ${days} day${days === 1 ? "" : "s"}`;
}
