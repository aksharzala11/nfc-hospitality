/** Props the /map page hands the client map (plain, serialisable). */

/**
 * How a name that finds several rooms reads in the room sheet:
 *  - "split": several names ("Green Room 2 · Green Room 3"): the session is split amongst them;
 *  - "covers": one event name mapped to several rooms (a hall made of two rooms);
 *  - "same-name": a name several rooms share ("Multipurpose Room"), or a place with one room per
 *    track seen by a guest with no gender on file ("Samp Square"): the one nearest the start is
 *    picked, the others offered;
 *  - "one": a single room (or none).
 */
export type MatchSpread = "one" | "split" | "covers" | "same-name";

/** A place offered as a one-tap destination or start: one of the guest's rooms, or a main hall. */
export type QuickPlace = {
  /** Stable React key. */
  key: string;
  /** The event's name for it ("Niyam", "Main Hall"). */
  label: string;
  /** Why it's offered: "BM RA · Fri 11:00 AM", "Your goshthi group". */
  context: string;
  /** Map rooms it resolves to; empty = not on the map yet. */
  roomIds: string[];
  spread: MatchSpread;
};

/** A ?to= / ?from= deep link as the server resolved it. */
export type MapDeepLink = { query: string; roomIds: string[]; spread: MatchSpread };

/**
 * An NFC tag's place (?here=, from /here/<place>: src/lib/here.ts) as the server resolved it
 * (mapHereLink()): `roomIds` = the one room it names, or [] (not on the map, or a name several
 * rooms share). `name` = the event name it was given by, as the programme spells it ("Main
 * Hall"), when it is one; `label` = the place as the tag gives it, in words ("main foyer").
 */
export type MapHere = { label: string; name: string | null; roomIds: string[] };

/**
 * The alias list the browser searches (event name -> rooms on the map; [] = not mapped yet),
 * already narrowed to the guest's track. `either`: the rooms are alternatives (one per track; the
 * guest has no gender on file), not one place made of several rooms.
 */
export type MapAlias = { name: string; roomIds: string[]; either?: boolean };

/**
 * Admin-only: how much of the alias table is filled in (names only), the mappings still to be
 * confirmed with the organisers (`tentative`, event names), how many rooms carry the organisers'
 * team name, and why the map needs extracting and importing again (routing errors, no stair
 * sides; empty = nothing).
 */
export type MapCoverage = {
  total: number;
  mapped: number;
  unmapped: string[];
  tentative: string[];
  /** Listed rooms (not stairs / elevators) and how many of them the team-name table names. */
  rooms: number;
  namedRooms: number;
  problems: string[];
};
