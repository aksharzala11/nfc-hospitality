/**
 * Logic behind the admin rooming board (/admin/rooming): the URL format
 * (?stay=, ?hotel=), the notes a room group and its occupants carry, and the
 * counts.
 *
 * Pure and client-safe: only type imports from the server lib
 * (src/lib/rooming.ts), so the board's search runs in the browser.
 *
 * Organiser decisions (see src/lib/hotels.ts): the numbers are room
 * ASSIGNMENTS, shown as "Room group N", never as hotel room numbers (those
 * come at check-in). Rooms that mix Bhaio and Behno are fine as family /
 * couple rooms: noted, never fixed. The board changes nothing: the next
 * `npm run rooming:import` replaces it.
 */
import type { RoomingBoardOccupant, RoomingBoardRoom, Stay } from "@/lib/rooming";
import { STAY_FIRST_NIGHT, isHotelKey } from "@/lib/hotels";
import { withSevaFilter } from "@/lib/admin/sevaFilter";
import { withNow } from "@/components/sant/shell/links";
import { formatDayShort } from "@/lib/time";
import { plural } from "@/components/admin/transport/board";

// ---------------------------------------------------------------------------
// Vocabulary and URLs
// ---------------------------------------------------------------------------

export const STAY_PARAM = "stay";
export const HOTEL_PARAM = "hotel";

/** With no ?stay=: the main stay, from Thu, Oct 8 (everyone has one). */
export const DEFAULT_STAY: Stay = "MAIN";

const PARAM_OF: Record<Stay, string> = { WED: "wed", MAIN: "main" };

/** "Wed, Oct 7" / "Thu, Oct 8". */
const FIRST_NIGHT: Record<Stay, string> = {
  WED: formatDayShort(STAY_FIRST_NIGHT.WED),
  MAIN: formatDayShort(STAY_FIRST_NIGHT.MAIN),
};

/** The words for each stay. */
export const STAY_WORDS: Record<Stay, { title: string; date: string; long: string }> = {
  WED: { title: "Wednesday night", date: FIRST_NIGHT.WED.split(", ")[1], long: `Night of ${FIRST_NIGHT.WED}` },
  MAIN: { title: "From Thursday", date: FIRST_NIGHT.MAIN.split(", ")[1], long: `From ${FIRST_NIGHT.MAIN}` },
};

type ParamValue = string | string[] | undefined;
const first = (v: ParamValue) => (Array.isArray(v) ? v[0] : v)?.trim().toLowerCase() ?? "";

/** ?stay=wed / main (a few spellings), else the main stay. */
export function readStay(value: ParamValue): Stay {
  const v = first(value);
  if (v === "wed" || v === "wednesday") return "WED";
  return DEFAULT_STAY;
}

/** ?hotel=<key> when it names one of the hotels (src/lib/hotels.ts), else null (every hotel). */
export function readHotel(value: ParamValue): string | null {
  const v = first(value);
  return isHotelKey(v) ? v : null;
}

export type Keep = { now: string | null; sevas: readonly string[] };

/**
 * A board link with the demo ?now= (while time-travelling) and the console's
 * seva filter kept, e.g. "/admin/rooming?stay=main&hotel=hilton&seva=BM%20RA".
 */
export function roomingHref(stay: Stay, hotel: string | null, keep: Keep): string {
  const query = [`${STAY_PARAM}=${PARAM_OF[stay]}`];
  if (hotel) query.push(`${HOTEL_PARAM}=${encodeURIComponent(hotel)}`);
  return withSevaFilter(withNow(`/admin/rooming?${query.join("&")}`, keep.now), keep.sevas);
}

/** A room group card's anchor on the board, e.g. "room-MAIN-hilton-49". */
export function roomAnchor(roomKey: string): string {
  return `room-${roomKey}`;
}

// ---------------------------------------------------------------------------
// Notes (shown, never fixed)
// ---------------------------------------------------------------------------

/** `info`: worth knowing (ink). `warn`: something to check with the organisers (coral). */
export type Note = { text: string; tone: "info" | "warn" };

/** A room group's own notes: tracks mixed, beds held by a skipped User Id, genders missing. */
export function roomNotes(room: RoomingBoardRoom): Note[] {
  const out: Note[] = [];
  if (room.mixedTrack) {
    out.push({
      tone: "info",
      text: `Bhaio and Behno together (${room.bhaio} + ${room.behno}): a family / couple room`,
    });
  }
  if (room.heldBeds > 0) {
    const ids = [...new Set(room.heldRegistrationIds)];
    const who =
      ids.length === 0
        ? "a User Id on two rows of the sheet"
        : `User Id ${ids.join(", ")}, on ${ids.length === 1 && room.heldRegistrationIds.length > 1 ? "both" : "two"} rows of the sheet`;
    out.push({ tone: "warn", text: `${plural(room.heldBeds, "bed")} held by ${who} (not placed)` });
  }
  if (room.noTrack > 0) {
    out.push({ tone: "warn", text: `${room.noTrack} with no gender on file (no track)` });
  }
  return out;
}

/**
 * How an occupant's master-list "Registration Status" shows:
 *   "none"     Registered (the usual) or blank: nothing, it would only be noise;
 *   "pending"  "Pending …" (transport info, liability form): a quiet info pill;
 *   "other"    anything else (Refunded, Cancelled, …): a warn note, since they still hold a bed.
 */
export type StatusKind = "none" | "pending" | "other";

export function statusKind(status: string | null): StatusKind {
  const s = (status ?? "").trim().toLowerCase();
  if (s === "" || s === "registered") return "none";
  return s.startsWith("pending") ? "pending" : "other";
}

/**
 * What to check about an occupant:
 * - a registration status other than Registered / Pending (e.g. Refunded): warn,
 *   they still hold a bed.
 * - where they are in the other stay, when it isn't the usual: on the main
 *   board, a different Wednesday room group (info; keeping the same room group
 *   from Wednesday is the usual, shown as a quiet "Since Wed" pill); on the
 *   Wednesday board, no room from Thursday (warn) or a different one (info).
 */
export function occupantNotes(o: RoomingBoardOccupant, stay: Stay): Note[] {
  const out: Note[] = [];
  const status = o.status?.trim();
  if (status && statusKind(status) === "other") out.push({ tone: "warn", text: `${status}: still holds a bed` });
  if (stay === "WED") {
    if (o.otherStay === null) out.push({ tone: "warn", text: `No room from ${FIRST_NIGHT.MAIN}` });
    else if (o.otherStay === "OTHER_ROOM") out.push({ tone: "info", text: `From Thu: ${o.otherStayLabel ?? "another room group"}` });
  } else if (o.otherStay === "OTHER_ROOM") {
    out.push({ tone: "info", text: `Wed night: ${o.otherStayLabel ?? "another room group"}` });
  }
  return out;
}

/** On the main board: kept the same room group from Wednesday night. */
export function sinceWednesday(o: RoomingBoardOccupant, stay: Stay): boolean {
  return stay === "MAIN" && o.otherStay === "SAME_ROOM";
}

// ---------------------------------------------------------------------------
// Counts
// ---------------------------------------------------------------------------

/**
 * Room groups by size, largest first, for cross-checking the organisers'
 * room-type totals: "23 × 4 beds · 3 × 2 beds".
 */
export function sizeBreakdown(rooms: readonly Pick<RoomingBoardRoom, "capacity">[]): string {
  const bySize = new Map<number, number>();
  for (const r of rooms) bySize.set(r.capacity, (bySize.get(r.capacity) ?? 0) + 1);
  return [...bySize]
    .sort((a, b) => b[0] - a[0])
    .map(([size, n]) => `${n} × ${plural(size, "bed")}`)
    .join(" · ");
}

/** Occupants who match the console seva filter (all of them without one). */
export function inFilterCount(rooms: readonly RoomingBoardRoom[]): number {
  let n = 0;
  for (const r of rooms) for (const o of r.occupants) if (o.inFilter) n++;
  return n;
}
