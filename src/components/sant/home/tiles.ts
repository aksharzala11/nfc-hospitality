/**
 * What each tile of the Pujya Santo home shows at a given moment: plain
 * arithmetic over the rows data.ts prepares (ISO bounds, labels already
 * formatted in EVENT_TZ), so the server render, hydration and every later tick
 * of the SantTiles island agree. Days are the Santo days (SANT_DAYS, Oct 5-15).
 * Client-safe: no Prisma, no date formatting.
 */
import { eventDayAt, untilLabel } from "@/lib/dashboard";
import type { BlockRow, MealRow, SantTilesData, TileDay, TileRow } from "./data";

type Timed<T> = T & { s: number; e: number };

const timed = <T extends { startsAt: string; endsAt: string }>(rows: T[]): Timed<T>[] =>
  rows.map((r) => ({ ...r, s: Date.parse(r.startsAt), e: Date.parse(r.endsAt) }));

/** The tiles' data with every time parsed once (per server render), for tilesAt(). */
export type ParsedTiles = {
  data: SantTilesData;
  /** Midnight of each Santo day and of the day after (ms). */
  bounds: number[];
  mine: Timed<TileRow>[];
  rides: Timed<TileRow>[];
  meals: Timed<MealRow>[];
  blocks: Timed<BlockRow>[];
};

export function parseTiles(data: SantTilesData): ParsedTiles {
  return {
    data,
    bounds: data.dayStarts.map((d) => Date.parse(d)),
    mine: timed(data.mine),
    rides: timed(data.transport.rides),
    meals: timed(data.menu.meals),
    blocks: timed(data.breakouts.blocks),
  };
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

export type DayState = "past" | "today" | "future";

/** One bead per personal item: done, happening now, or still ahead. */
export type Bead = "done" | "now" | "ahead";

export type BeadDay = {
  day: string; // YYYY-MM-DD
  weekday: string; // "Fri"
  date: string; // "9"
  state: DayState;
  beads: Bead[];
};

/** A day chip on the General schedule tile. */
export type StripDay = {
  day: string; // YYYY-MM-DD
  weekday: string; // "Fri"
  date: string; // "9"
  state: DayState;
  /** Share of today's Santo general schedule already done (0–1); 0 for other days. */
  progress: number;
};

export type MineChip = {
  label: string;
  /** live: something of his is on now (pulsing dot); bright: a plain count; quiet: nothing pending. */
  tone: "live" | "bright" | "quiet";
  check?: boolean;
};

export type MenuTileView = {
  /**
   * The Santo menu is open from the start (no reveals): serving: a meal is
   * being served; next: the next meal, not yet started; served: every meal is
   * over; none: no Santo meals yet.
   */
  state: "serving" | "next" | "served" | "none";
  /** The featured meal's name ("Lunch"), else "All meals served" / "Menu coming soon". */
  headline: string;
  /** When the featured meal is: "Serving now · until 2:00 PM", "12:30 PM", "Tomorrow · 7:45 AM". */
  when: string | null;
  place: string | null;
};

export type BreakoutsTileView =
  | {
      /** now: a breakout block is under way; next: the next block, not yet started. */
      state: "now" | "next";
      /** The block's name: "Friday afternoon". */
      label: string;
      /** "Now · until 4:30 PM", "3:00 PM · in 25 min", "Tomorrow · 11:00 AM", "Sat · 11:00 AM". */
      when: string;
      /** "3 sessions" */
      sessions: string;
    }
  /** Every breakout block is over. */
  | { state: "done" }
  /** No breakout sessions published yet. */
  | { state: "none" };

export type TilesView = {
  /** `days`: the Santo days with any of his items on them, plus today. */
  mine: { chip: MineChip; days: BeadDay[] };
  /** `days`: a week of Santo days (STRIP_DAYS) from the day before today. */
  general: { subtitle: string; days: StripDay[] };
  /** The Transport tile's line: "Next ride 4:15 PM", "On the way · until 2:15 PM", or the fallback. */
  ride: string;
  menu: MenuTileView;
  breakouts: BreakoutsTileView;
};

/** Every tile at `now` (ms). */
export function tilesAt(p: ParsedTiles, now: number): TilesView {
  const today = eventDayAt(now, p.bounds);
  const states = p.data.days.map((_, i) => dayState(p.bounds, i, now));
  return {
    mine: { chip: mineChip(p.mine, today, now), days: beadDays(p.data.days, p.mine, states, now) },
    general: {
      subtitle: today ? `Day ${today} of ${p.data.days.length}` : p.data.generalSubtitle,
      days: stripWindow(dayStrip(p.data.days, states, now), today),
    },
    ride: rideLine(p.rides, today, now) ?? p.data.transport.fallback,
    menu: menuTile(p.meals, today, now),
    breakouts: breakoutsTile(p.blocks, today, now),
  };
}

// ---------------------------------------------------------------------------
// Days
// ---------------------------------------------------------------------------

function dayState(bounds: number[], i: number, now: number): DayState {
  if (now >= bounds[i + 1]) return "past";
  return now >= bounds[i] ? "today" : "future";
}

/**
 * "11:00 AM" today, "Tomorrow · 11:00 AM" or "Sat · 11:00 AM" during the Santo
 * days, "Fri, Oct 9 · 11:00 AM" before them.
 */
function startsWhen(row: TileRow, today: number): string {
  if (row.day > 0 && row.day === today) return row.startLabel;
  if (row.day > 0 && today > 0 && row.day === today + 1) return `Tomorrow · ${row.startLabel}`;
  return `${today > 0 ? row.weekday : row.dateLabel} · ${row.startLabel}`;
}

// ---------------------------------------------------------------------------
// My schedule
// ---------------------------------------------------------------------------

/**
 * A row of beads per Santo day that has any of his items, plus today (with a
 * dash when he has nothing on it): eleven rows would overrun the tile.
 */
function beadDays(days: TileDay[], mine: Timed<TileRow>[], states: DayState[], now: number): BeadDay[] {
  return days
    .map((d, i) => ({
      day: d.day,
      weekday: d.weekday,
      date: d.date,
      state: states[i],
      beads: mine
        .filter((r) => r.day === i + 1)
        .map((r): Bead => (r.e <= now ? "done" : r.s <= now ? "now" : "ahead")),
    }))
    .filter((d) => d.beads.length > 0 || d.state === "today");
}

/** Status chip on the "My schedule" tile. `today` is the 1-based Santo day, 0 outside them. */
function mineChip(mine: Timed<TileRow>[], today: number, now: number): MineChip {
  if (mine.length === 0) return { label: "Being prepared", tone: "quiet" };
  if (mine.every((r) => r.e <= now)) return { label: "Complete", tone: "quiet", check: true };
  if (!today) return { label: `${mine.length} ${mine.length === 1 ? "item" : "items"}`, tone: "bright" };

  const todays = mine.filter((r) => r.day === today);
  if (todays.length === 0) return { label: "Nothing today", tone: "quiet" };
  const left = todays.filter((r) => r.e > now).length;
  if (left === 0) return { label: "Done for today", tone: "quiet", check: true };
  return { label: `${left} left today`, tone: todays.some((r) => r.s <= now && now < r.e) ? "live" : "bright" };
}

// ---------------------------------------------------------------------------
// General schedule
// ---------------------------------------------------------------------------

/** Every Santo day; today carries how much of its Santo general schedule is done (0–1). */
function dayStrip(days: TileDay[], states: DayState[], now: number): StripDay[] {
  return days.map((d, i) => {
    const first = d.first ? Date.parse(d.first) : 0;
    const last = d.last ? Date.parse(d.last) : 0;
    const progress =
      states[i] === "today" && last > first ? Math.min(1, Math.max(0, (now - first) / (last - first))) : 0;
    return { day: d.day, weekday: d.weekday, date: d.date, state: states[i], progress };
  });
}

/** How many day chips fit the tile's width on a 375px screen. */
export const STRIP_DAYS = 7;

/**
 * A week of the strip: from the day before today (so today sits second and
 * the days ahead show), held inside the Santo days; the first week before
 * them and the last one after. `today` is the 1-based Santo day, 0 outside.
 */
function stripWindow(days: StripDay[], today: number): StripDay[] {
  if (days.length <= STRIP_DAYS) return days;
  const last = days.length - STRIP_DAYS;
  const start = today > 0 ? Math.min(Math.max(today - 2, 0), last) : days.every((d) => d.state === "past") ? last : 0;
  return days.slice(start, start + STRIP_DAYS);
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

/** "Next ride 4:15 PM" / "Next ride Sun 1:30 PM" / "On the way · until 2:15 PM"; null when no ride is ahead. */
function rideLine(rides: Timed<TileRow>[], today: number, now: number): string | null {
  const ride = rides.find((r) => r.e > now);
  if (!ride) return null;
  if (ride.s <= now) return `On the way · until ${ride.endLabel}`;
  return ride.day > 0 && ride.day === today
    ? `Next ride ${ride.startLabel}`
    : `Next ride ${ride.weekday} ${ride.startLabel}`;
}

// ---------------------------------------------------------------------------
// Menu
// ---------------------------------------------------------------------------

/**
 * The meal on now, else the next one. Every Santo menu is open from the start
 * (menuIsTimed() in src/lib/schedule.ts), so there is no reveal to count down to.
 */
function menuTile(meals: ParsedTiles["meals"], today: number, now: number): MenuTileView {
  if (meals.length === 0) return { state: "none", headline: "Menu coming soon", when: null, place: null };

  const meal = meals.find((m) => now < m.e);
  if (meal) {
    const serving = now >= meal.s;
    return {
      state: serving ? "serving" : "next",
      headline: meal.name,
      when: serving ? `Serving now · until ${meal.endLabel}` : startsWhen(meal, today),
      place: meal.location,
    };
  }

  return { state: "served", headline: "All meals served", when: null, place: null };
}

// ---------------------------------------------------------------------------
// Breakouts
// ---------------------------------------------------------------------------

/** How close a block has to be for the tile to count down to it ("11:00 AM · in 20 min"). */
const SOON_MS = 60 * 60_000;

const sessionCount = (n: number) => `${n} ${n === 1 ? "session" : "sessions"}`;

/**
 * The breakout block on now (as blockStatuses() in src/lib/santBreakouts.ts has it), else the
 * next one, else "done" (all over); "none" when there are no blocks. Santos have no sessions of
 * their own: a block is a choice of sessions to join.
 */
function breakoutsTile(blocks: Timed<BlockRow>[], today: number, now: number): BreakoutsTileView {
  if (blocks.length === 0) return { state: "none" };

  const current = blocks.find((b) => b.s <= now && now < b.e);
  if (current) {
    return { state: "now", label: current.label, when: `Now · until ${current.endLabel}`, sessions: sessionCount(current.count) };
  }

  const next = blocks.find((b) => b.s > now);
  if (next) {
    // Within the hour, count down to it; otherwise just say when.
    const when =
      next.s - now <= SOON_MS ? `${next.startLabel} · ${untilLabel(next.s - now)}` : startsWhen(next, today);
    return { state: "next", label: next.label, when, sessions: sessionCount(next.count) };
  }

  return { state: "done" };
}
