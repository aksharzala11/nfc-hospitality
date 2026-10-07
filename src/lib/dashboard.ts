/**
 * Home-page (dashboard) helpers: the countdown / live-clock data handed to the
 * client island, the day strip on the Schedule tile and the Menu tile summary.
 *
 * Only `import type` from modules that touch Prisma: the client clock imports
 * the pure helpers below, so this file must stay safe to bundle for the browser.
 */
import type { ScheduleItem } from "@prisma/client";
import type { MealView } from "@/lib/schedule";
import { DAY_LABELS, EVENT_DAYS, EVENT_TZ, dayKey, formatDayShort, formatRelative, formatTime } from "@/lib/time";

/** First programme item, "Arrival & Check-In": Thu Oct 8 2026, 5:00 PM Eastern. */
export const NAAM_START_FALLBACK = "2026-10-08T21:00:00.000Z";
/** End of the last programme item, "Departures": Sun Oct 11 2026, 9:45 PM Eastern. */
export const NAAM_END_FALLBACK = "2026-10-12T01:45:00.000Z";

type ItemLike = Pick<ScheduleItem, "id" | "title" | "location" | "startsAt" | "endsAt">;

/**
 * How far ahead the clock gets schedule items. AutoRefresh re-sends fresh data
 * every minute, so this only has to outlast the longest gap in the programme
 * (overnight, ~9 h) with room to spare.
 */
const CLOCK_HORIZON_MS = 36 * 60 * 60 * 1000;

/** A schedule item as the client clock needs it. Labels are pre-formatted on the server. */
export type ClockItem = {
  id: string;
  title: string;
  location: string | null;
  startsAt: string; // ISO
  endsAt: string; // ISO
  startLabel: string; // "5:00 PM" in EVENT_TZ
  endLabel: string;
  /** 1-based programme day (EVENT_DAYS index + 1), 0 when outside the event days. */
  day: number;
};

export type ClockData = {
  /** Programme start (earliest item) and end (latest item end), ISO. */
  start: string;
  end: string;
  /** What the countdown points at, e.g. { when: "Thu, Oct 8 · 5:00 PM", title: "Arrival & Check-In" }. */
  opening: { when: string; title: string | null; location: string | null };
  /** Items not finished at render time that start within CLOCK_HORIZON_MS, in start order. */
  items: ClockItem[];
  /** Midnight (EVENT_TZ) at the start of each event day plus the one after the last day, ISO. */
  dayStarts: string[];
  /** "Thu, Oct 8" per event day. */
  dayLabels: string[];
  /** "Thu" per event day. */
  weekdays: string[];
};

/** Offset of EVENT_TZ from UTC at `at` (ms). */
function tzOffsetMs(at: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: EVENT_TZ,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(at));
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value);
  return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second")) - at;
}

/** UTC instant (ms) of 00:00 on `day` (YYYY-MM-DD) in EVENT_TZ. */
function startOfEventDay(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  const utcMidnight = Date.UTC(y, m - 1, d);
  // Guess with the offset at UTC midnight, then correct once (DST-safe).
  const guess = utcMidnight - tzOffsetMs(utcMidnight);
  return utcMidnight - tzOffsetMs(guess);
}

function nextDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

/** 1-based index of the event day containing `ms`, or 0 outside the event days. */
export function eventDayAt(ms: number, dayStarts: number[]): number {
  for (let i = 0; i < dayStarts.length - 1; i++) {
    if (ms >= dayStarts[i] && ms < dayStarts[i + 1]) return i + 1;
  }
  return 0;
}

/** Everything the hero clock needs, derived from the guest's (audience-filtered) schedule. */
export function buildClockData(items: ItemLike[], now: Date): ClockData {
  const t = now.getTime();
  const first = items.reduce<ItemLike | null>((a, i) => (!a || i.startsAt.getTime() < a.startsAt.getTime() ? i : a), null);
  const start = first ? first.startsAt : new Date(NAAM_START_FALLBACK);
  const end = items.length
    ? new Date(Math.max(...items.map((i) => i.endsAt.getTime())))
    : new Date(NAAM_END_FALLBACK);

  const boundaries = [...EVENT_DAYS.map(startOfEventDay), startOfEventDay(nextDay(EVENT_DAYS[EVENT_DAYS.length - 1]))];
  const dayLabels = EVENT_DAYS.map((d) => formatDayShort(d));

  return {
    start: start.toISOString(),
    end: end.toISOString(),
    opening: {
      when: `${formatDayShort(dayKey(start))} · ${formatTime(start)}`,
      title: first?.title ?? null,
      location: first?.location ?? null,
    },
    items: items
      .filter((i) => i.endsAt.getTime() > t && i.startsAt.getTime() < t + CLOCK_HORIZON_MS)
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
      .map((i) => ({
        id: i.id,
        title: i.title,
        location: i.location,
        startsAt: i.startsAt.toISOString(),
        endsAt: i.endsAt.toISOString(),
        startLabel: formatTime(i.startsAt),
        endLabel: formatTime(i.endsAt),
        day: eventDayAt(i.startsAt.getTime(), boundaries),
      })),
    dayStarts: boundaries.map((ms) => new Date(ms).toISOString()),
    dayLabels,
    weekdays: dayLabels.map((l) => l.split(",")[0]),
  };
}

// ---------------------------------------------------------------------------
// Pure clock maths (shared with the client island)
// ---------------------------------------------------------------------------

export type Countdown = { days: number; hours: number; minutes: number; seconds: number };

/**
 * Splits a remaining duration into d/h/m/s. Rounds up to the whole second so a
 * tick that lands a few ms late still shows the intended value, and 0:00:00 is
 * only ever reached at (or after) the target.
 */
export function splitCountdown(ms: number): Countdown {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return {
    days: Math.floor(total / 86_400),
    hours: Math.floor(total / 3_600) % 24,
    minutes: Math.floor(total / 60) % 60,
    seconds: total % 60,
  };
}

/** "in 12 min", "in 2 h 5 min", "in 3 days" (same wording as formatRelative). */
export function untilLabel(ms: number): string {
  if (ms <= 0) return "now";
  const mins = Math.ceil(ms / 60_000);
  if (mins < 60) return `in ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) {
    const rem = mins % 60;
    return rem ? `in ${hours} h ${rem} min` : `in ${hours} h`;
  }
  const days = Math.round(hours / 24);
  return `in ${days} day${days === 1 ? "" : "s"}`;
}

/** "14 days, 3 hours and 12 minutes" for screen readers (minute precision). */
export function spokenCountdown({ days, hours, minutes }: Countdown): string {
  const parts = [
    days ? `${days} day${days === 1 ? "" : "s"}` : "",
    hours ? `${hours} hour${hours === 1 ? "" : "s"}` : "",
    minutes ? `${minutes} minute${minutes === 1 ? "" : "s"}` : "",
  ].filter(Boolean);
  if (parts.length === 0) return "less than a minute";
  return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

// ---------------------------------------------------------------------------
// Tiles (server only)
// ---------------------------------------------------------------------------

export type DayChip = {
  day: string;
  weekday: string; // "Thu"
  date: string; // "8"
  label: string; // "Arrival", "Day 2", …
  state: "past" | "today" | "future";
  /** Share of today's programme already done (0–1); 0 for other days. */
  progress: number;
};

/** The four event days for the Schedule tile, with today's programme progress. */
export function buildDayStrip(items: ItemLike[], now: Date, today: string): DayChip[] {
  const t = now.getTime();
  const todays = items.filter((i) => dayKey(i.startsAt) === today);
  const first = Math.min(...todays.map((i) => i.startsAt.getTime()));
  const last = Math.max(...todays.map((i) => i.endsAt.getTime()));
  const todayProgress = todays.length && last > first ? Math.min(1, Math.max(0, (t - first) / (last - first))) : 0;

  return EVENT_DAYS.map((day) => {
    const state = day < today ? "past" : day === today ? "today" : "future";
    return {
      day,
      weekday: formatDayShort(day).split(",")[0],
      date: String(Number(day.slice(8))),
      label: DAY_LABELS[day] ?? formatDayShort(day),
      state,
      progress: state === "today" ? todayProgress : 0,
    };
  });
}

export type MenuSummary = {
  state: "serving" | "out" | "locked" | "served";
  /** "{meal} menu is out" / "{meal} reveals in 25 min" / "All meals served". */
  subtitle: string;
  /** When/where the featured meal is, e.g. "7:30 PM · Dining Hall" or "Thu, Oct 8 · 7:30 AM". */
  meta: string | null;
};

function mealMeta(meal: MealView, today: string): string {
  const start = formatTime(new Date(meal.startsAt));
  const when = meal.day === today ? start : `${formatDayShort(meal.day)} · ${start}`;
  return meal.location ? `${when} · ${meal.location}` : when;
}

/** The Menu tile: the meal whose menu is out, else the next one to be revealed. */
export function menuSummary(meals: MealView[], now: Date, today: string): MenuSummary {
  const revealed = meals.find((m) => m.status === "revealed");
  if (revealed) {
    const t = now.getTime();
    const serving = t >= Date.parse(revealed.startsAt) && t < Date.parse(revealed.endsAt);
    return { state: serving ? "serving" : "out", subtitle: `${revealed.name} menu is out`, meta: mealMeta(revealed, today) };
  }
  const locked = meals.find((m) => m.status === "locked");
  if (locked) {
    return {
      state: "locked",
      subtitle: `${locked.name} reveals ${formatRelative(now, new Date(locked.revealsAt))}`,
      meta: mealMeta(locked, today),
    };
  }
  return { state: "served", subtitle: "All meals served", meta: null };
}
