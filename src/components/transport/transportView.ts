/**
 * Pure presentation helpers for a delegate's own transport (the /transportation
 * cards and the home tile). No Prisma: the legs come from getTransportFor() in
 * src/lib/transport.ts as plain TransportLegView objects.
 *
 * Times: a leg's localDate / localTime are the wall-clock date and time AT
 * THAT AIRPORT, exactly as the organisers' sheet gives them. The labels here
 * show them as they are; only legPhase() compares them with "now", through
 * sortAt (the same wall-clock read as Eastern), which is exact for the
 * Eastern airports nearly everyone uses.
 */
import type { TransportFor, TransportLegView } from "@/lib/transport";
import { EVENT_DAYS, dayKey } from "@/lib/time";

/** Where a leg stands at `now`: still ahead, on today's date, or over. */
export type LegPhase = "upcoming" | "today" | "done";

/**
 * An arrival stays live this long after the flight's arrival time (landing,
 * baggage, the pickup ride), then reads as done. A departure is done at its
 * departure time.
 */
const ARRIVAL_LIVE_MS = 3 * 60 * 60 * 1000;

export function legPhase(leg: TransportLegView, now: Date): LegPhase {
  const today = dayKey(now);
  if (leg.sortAt && leg.localTime) {
    const at = new Date(leg.sortAt).getTime();
    const over = leg.direction === "ARRIVAL" ? at + ARRIVAL_LIVE_MS : at;
    if (now.getTime() >= over) return "done";
    // Landed (possibly just past midnight): the pickup is under way.
    if (now.getTime() >= at) return "today";
  } else if (leg.localDate && leg.localDate < today) {
    // Date only: done once that day is over.
    return "done";
  }
  return leg.localDate === today ? "today" : "upcoming";
}

export function isDriving(leg: TransportLegView): boolean {
  return leg.mode?.toUpperCase() === "DRIVING";
}

/** "FLYING" -> "Flying", "DRIVING" -> "Driving", anything else as given; null when blank. */
export function modeLabel(mode: string | null): string | null {
  const m = mode?.trim();
  if (!m) return null;
  const upper = m.toUpperCase();
  if (upper === "FLYING") return "Flying";
  if (upper === "DRIVING") return "Driving";
  return m.charAt(0).toUpperCase() + m.slice(1);
}

/** "United Airlines · UA 1234", or whichever half is known; null for neither. */
export function flightLabel(leg: TransportLegView): string | null {
  const parts = [leg.airline?.trim(), leg.flight?.trim()].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** "Thu, Oct 8 · 5:26 AM" (either half alone when only one is known), or null. */
export function legWhenLabel(leg: TransportLegView): string | null {
  const parts = [leg.dateLabel, leg.timeLabel].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** For <time dateTime>: "2026-10-08T05:26", "2026-10-08" or "05:26" (local, no zone). */
export function legDateTimeAttr(leg: TransportLegView): string | undefined {
  if (leg.localDate && leg.localTime) return `${leg.localDate}T${leg.localTime}`;
  return leg.localDate ?? leg.localTime ?? undefined;
}

/** "Pickup" for an arrival, "Drop-off" for a departure. */
export function serviceNoun(leg: Pick<TransportLegView, "direction">): "Pickup" | "Drop-off" {
  return leg.direction === "ARRIVAL" ? "Pickup" : "Drop-off";
}

// ---------------------------------------------------------------------------
// The home tile
// ---------------------------------------------------------------------------

export type TransportTileChip = { label: string; tone: "today" | "group" | "done" };

/** What the home Transportation tile shows under its title. */
export type TransportTileSummary = {
  /** e.g. "Arrive PHL · Thu 5:26 AM", "Arrived PHL · Thu", "No pickup on file". */
  line: string;
  chip: TransportTileChip | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const utcDay = (day: string) => Date.parse(`${day}T12:00:00Z`);

/**
 * A compact day for the tile: the weekday ("Thu") within a week of the event,
 * where the weekday is unambiguous, otherwise the date ("Sep 25").
 */
function tileDay(localDate: string | null): string | null {
  if (!localDate || !/^\d{4}-\d{2}-\d{2}$/.test(localDate)) return null;
  const t = utcDay(localDate);
  const near = t >= utcDay(EVENT_DAYS[0]) - 6 * DAY_MS && t <= utcDay(EVENT_DAYS[EVENT_DAYS.length - 1]) + 6 * DAY_MS;
  const format: Intl.DateTimeFormatOptions = near ? { weekday: "short" } : { month: "short", day: "numeric" };
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", ...format }).format(new Date(t));
}

/** [ahead, done] verbs per direction and mode. */
const TILE_VERB = {
  ARRIVAL: { flying: ["Arrive", "Arrived"], driving: ["Driving in", "Drove in"] },
  DEPARTURE: { flying: ["Depart", "Departed"], driving: ["Driving home", "Drove home"] },
} as const;

function tileLine(leg: TransportLegView, done: boolean): string {
  const driving = isDriving(leg);
  const verb = TILE_VERB[leg.direction][driving ? "driving" : "flying"][done ? 1 : 0];
  const where = !driving && leg.airportCode ? ` ${leg.airportCode}` : "";
  // Once done, the day alone is enough. "Thu 5:26 AM", but "Sep 25, 5:26 AM".
  const day = tileDay(leg.localDate);
  const when = [day, done ? null : leg.timeLabel].filter(Boolean).join(day && /\d/.test(day) ? ", " : " ");
  return `${verb}${where}${when ? ` · ${when}` : ""}`;
}

/**
 * The tile's summary: the next leg that isn't over ("Arrive PHL · Thu 5:26 AM",
 * with a Today or "Pickup group 3" chip), else the last leg as done, else
 * "No pickup on file".
 */
export function transportTileSummary(transport: TransportFor, now: Date): TransportTileSummary {
  const legs = [transport.arrival, transport.departure].filter((l): l is TransportLegView => l !== null);
  if (legs.length === 0) return { line: "No pickup on file", chip: null };

  const next = legs.find((l) => legPhase(l, now) !== "done");
  if (!next) return { line: tileLine(legs[legs.length - 1], true), chip: { label: "Done", tone: "done" } };

  let chip: TransportTileChip | null = null;
  if (legPhase(next, now) === "today") chip = { label: "Today", tone: "today" };
  // As on the card, the transport team's group stands whatever the registration said.
  // "Pickup group 3", not "Group 3": the Breakouts tile beside it shows their goshthi group.
  else if (next.groupNumber !== null && next.groupKey && !isDriving(next)) {
    chip = { label: `${serviceNoun(next)} group ${next.groupNumber}`, tone: "group" };
  }
  return { line: tileLine(next, false), chip };
}
