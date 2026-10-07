/**
 * Data shaping for the Pujya Santo home (/sant): turns the annotated schedules
 * from getSantSchedules() (the Santo general schedule and his own programme),
 * the Santo meals, the breakout blocks he can join, the utaro and the hotline into the small,
 * serialisable props the home's components take. Every date is formatted
 * here, in EVENT_TZ, so the client islands only do arithmetic and always
 * hydrate to the server's markup.
 *
 * The home counts its days over the Santo days (SANT_DAYS, Oct 5-15), not the
 * four NAAM days: santClockData() gives the hero clock buildClockData() from
 * src/lib/dashboard.ts re-based on them, and its `dayStarts` frame every other
 * row here ("day" = 1-based index into SANT_DAYS, 0 outside them).
 *
 * Only `import type` from modules that touch Prisma (the client islands import
 * this file's types).
 */
import type { ScheduleItem } from "@prisma/client";
import type { MealView, ScheduleItemView } from "@/lib/schedule";
import type { SantBlockView } from "@/lib/santBreakouts";
import { buildClockData, eventDayAt, type ClockData } from "@/lib/dashboard";
import { SANT_DAYS, dayKey, formatDayShort, formatTime, parseInEventTz } from "@/lib/time";

// ---------------------------------------------------------------------------
// "Your programme" card
// ---------------------------------------------------------------------------

/** A schedule row as the programme card needs it; labels are pre-formatted in EVENT_TZ. */
export type ProgrammeItem = {
  id: string;
  title: string;
  location: string | null;
  description: string | null;
  startsAt: string; // ISO
  endsAt: string; // ISO
  /** "5:30 AM" */
  startLabel: string;
  endLabel: string;
  /** "Thu, Oct 8" */
  dateLabel: string;
  /** 1-based Santo day (SANT_DAYS index + 1); 0 outside the Santo days. */
  day: number;
};

export type ProgrammeList = {
  /** Items not finished at render time, in start order. */
  items: ProgrammeItem[];
  /** How many items the whole list has, finished ones included. */
  total: number;
  /** Start of the list's earliest item (ISO), null when empty. Before it, "Next" reads "First up". */
  firstStart: string | null;
};

/**
 * The unfinished part of the sant's own programme for the programme card (a
 * handful of rows, so all of them: the card keeps ticking between refreshes
 * and during ?now= time travel).
 */
export function programmeList(items: ScheduleItemView[], now: Date, dayStarts: string[]): ProgrammeList {
  const t = now.getTime();
  const bounds = dayStarts.map((d) => Date.parse(d));
  const sorted = [...items].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  const ahead = sorted.filter((i) => Date.parse(i.endsAt) > t);
  return {
    items: ahead.map((i) => {
      const start = new Date(i.startsAt);
      return {
        id: i.id,
        title: i.title,
        location: i.location,
        description: i.description,
        startsAt: i.startsAt,
        endsAt: i.endsAt,
        startLabel: formatTime(start),
        endLabel: formatTime(new Date(i.endsAt)),
        dateLabel: formatDayShort(i.day),
        day: eventDayAt(start.getTime(), bounds),
      };
    }),
    total: items.length,
    firstStart: sorted[0]?.startsAt ?? null,
  };
}

// ---------------------------------------------------------------------------
// Hero clock
// ---------------------------------------------------------------------------

/** Midnight (EVENT_TZ) of each of `days` and of the day after the last, ISO: ClockData.dayStarts over the Santo days. */
export function santDayStarts(days: readonly string[] = SANT_DAYS): string[] {
  const [y, m, d] = days[days.length - 1].split("-").map(Number);
  const after = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
  return [...days, after].map((day) => (parseInEventTz(`${day}T00:00`) as Date).toISOString());
}

/** An all-day marker from the sheet ("Arrival All Day", "Departure All Day"): its clock time means nothing. */
const ALL_DAY = /\ball day\b/i;

/**
 * The hero clock's data on the Santo general schedule: buildClockData() (the
 * countdown to its first item, then now / next), with its day frame moved from
 * the four NAAM days to the Santo days (`dayStarts`, `dayLabels`, `weekdays`
 * and each item's `day`), so "Live · Day 4 of 11", "Tomorrow" and the weekday
 * labels hold from Oct 5 to Oct 15. When the first item is an all-day marker,
 * the countdown's "Opens ..." line gives its date only.
 */
export function santClockData(general: ScheduleItemView[], now: Date, days: readonly string[] = SANT_DAYS): ClockData {
  const base = buildClockData(withDates(general), now);
  const dayStarts = santDayStarts(days);
  const bounds = dayStarts.map((d) => Date.parse(d));
  const dayLabels = days.map((d) => formatDayShort(d));
  const first = general.reduce<ScheduleItemView | null>(
    (a, i) => (!a || Date.parse(i.startsAt) < Date.parse(a.startsAt) ? i : a),
    null,
  );
  return {
    ...base,
    opening:
      first && ALL_DAY.test(first.title)
        ? { ...base.opening, when: formatDayShort(dayKey(new Date(first.startsAt))) }
        : base.opening,
    items: base.items.map((i) => ({ ...i, day: eventDayAt(Date.parse(i.startsAt), bounds) })),
    dayStarts,
    dayLabels,
    weekdays: dayLabels.map((l) => l.split(",")[0]),
  };
}

/** The same rows with Date fields, for buildClockData() in src/lib/dashboard.ts. */
export function withDates(
  items: ScheduleItemView[],
): Pick<ScheduleItem, "id" | "title" | "location" | "startsAt" | "endsAt">[] {
  return items.map((i) => ({
    id: i.id,
    title: i.title,
    location: i.location,
    startsAt: new Date(i.startsAt),
    endsAt: new Date(i.endsAt),
  }));
}

// ---------------------------------------------------------------------------
// Tiles
// ---------------------------------------------------------------------------
// SantTiles is a client island that ticks with the hero clock, so its rows
// carry ISO bounds plus labels formatted here, and tiles.ts works out what each
// tile shows at any moment (the tiles follow ?now= time travel too).

/** A timed row for the tiles. */
export type TileRow = {
  id: string;
  startsAt: string; // ISO
  endsAt: string; // ISO
  /** 1-based Santo day (SANT_DAYS index + 1); 0 outside the Santo days. */
  day: number;
  /** "Fri" */
  weekday: string;
  /** "Fri, Oct 9" */
  dateLabel: string;
  /** "7:30 AM" */
  startLabel: string;
  endLabel: string;
};

/** A Pujya Santo meal (menu_for = SANT, open from the start: no reveal time). */
export type MealRow = TileRow & { name: string; location: string | null };

/** A breakout block he can join sessions in (santBlockViews()): "Friday afternoon", with how many sessions. */
export type BlockRow = TileRow & { label: string; count: number };

/** A Santo day for the tiles, with when the Santo general schedule starts and ends that day (ISO; null if nothing). */
export type TileDay = {
  day: string; // YYYY-MM-DD
  weekday: string; // "Fri"
  date: string; // "9"
  first: string | null;
  last: string | null;
};

/** Everything the home tiles need (all plain data: SantTiles is a client component). */
export type SantTilesData = {
  /** ClockData.dayStarts: midnight (EVENT_TZ) of each Santo day and of the day after, ISO. */
  dayStarts: string[];
  /** The Santo days (SANT_DAYS) in order, matching `dayStarts` (without its closing boundary). */
  days: TileDay[];
  /** The General schedule tile's subtitle outside the Santo days, e.g. "Oct 5–15" (during them: "Day 4 of 11"). */
  generalSubtitle: string;
  /** His own programme, for the beads and the chip on "My schedule". */
  mine: TileRow[];
  stay: {
    placeName: string;
    /** companionsLine(): "with Sampledas, Demodas", null when he is the only sant there. */
    withLine: string | null;
    /** The first two companions' initials, for the avatar stack. */
    avatars: { id: string; initial: string }[];
  } | null;
  transport: {
    hotline: {
      label: string;
      contactName: string | null;
      phoneDisplay: string;
      telHref: string;
      /** The line's Telegram chat (null: none on file): a Telegram button beside Call. */
      telegramHref: string | null;
    } | null;
    /** His TRAVEL items, in time order. */
    rides: TileRow[];
    /** The tile's line when no ride is ahead: the hotline's hours, or a generic line. */
    fallback: string;
  };
  menu: {
    /** The Santo meals in time order. */
    meals: MealRow[];
  };
  breakouts: {
    /** The breakout blocks (getSantBreakouts(): the Bhaio team breakouts he can join), in time order. */
    blocks: BlockRow[];
  };
};

/** The labels every tile row carries. `day` is the item's YYYY-MM-DD in EVENT_TZ (as the annotate helpers give it). */
function tileRow(item: { id: string; startsAt: string; endsAt: string; day: string }, bounds: number[]): TileRow {
  const start = new Date(item.startsAt);
  const dateLabel = formatDayShort(item.day);
  return {
    id: item.id,
    startsAt: item.startsAt,
    endsAt: item.endsAt,
    day: eventDayAt(start.getTime(), bounds),
    weekday: dateLabel.split(",")[0],
    dateLabel,
    startLabel: formatTime(start),
    endLabel: formatTime(new Date(item.endsAt)),
  };
}

const boundsOf = (dayStarts: string[]) => dayStarts.map((d) => Date.parse(d));

/** Schedule items (his programme, or just its rides) as tile rows. */
export function scheduleRows(items: ScheduleItemView[], dayStarts: string[]): TileRow[] {
  const bounds = boundsOf(dayStarts);
  return items.map((i) => tileRow(i, bounds));
}

/** annotateMeals(getMeals("SANT"), now) as tile rows. */
export function mealRows(meals: MealView[], dayStarts: string[]): MealRow[] {
  const bounds = boundsOf(dayStarts);
  return meals.map((m) => ({ ...tileRow(m, bounds), name: m.name, location: m.location }));
}

/** santBlockViews(getSantBreakouts().blocks, now, null) as tile rows. */
export function blockRows(blocks: SantBlockView[], dayStarts: string[]): BlockRow[] {
  const bounds = boundsOf(dayStarts);
  return blocks.map((b) => ({ ...tileRow(b, bounds), label: b.label, count: b.count }));
}

/** The Santo days, with the Santo general schedule's first start and last end on each (for the day strip). */
export function tileDays(general: ScheduleItemView[], days: readonly string[] = SANT_DAYS): TileDay[] {
  return days.map((day) => {
    const todays = general.filter((i) => i.day === day);
    const iso = (ms: number) => new Date(ms).toISOString();
    return {
      day,
      weekday: formatDayShort(day).split(",")[0],
      date: String(Number(day.slice(8))),
      first: todays.length ? iso(Math.min(...todays.map((i) => Date.parse(i.startsAt)))) : null,
      last: todays.length ? iso(Math.max(...todays.map((i) => Date.parse(i.endsAt)))) : null,
    };
  });
}

/** "with Sampledas, Demodas" (+N beyond `max` names); null when he is the only one placed there. */
export function companionsLine(companions: { name: string }[], max = 2): string | null {
  if (companions.length === 0) return null;
  const shown = companions.slice(0, max).map((c) => c.name);
  const more = companions.length - shown.length;
  return `with ${shown.join(", ")}${more > 0 ? ` +${more}` : ""}`;
}
