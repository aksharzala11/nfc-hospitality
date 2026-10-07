/**
 * Matching event room names to venue map rooms. Names and ids only (no geometry and no alias
 * table), so it is safe in the browser: the tables themselves (VENUE_ROOM_NAMES, VENUE_ALIASES)
 * are server only (src/lib/venue/aliasTable.ts), and the browser gets rooms that already carry
 * their team name and the alias list its page sends (aliasEntriesFor(), already narrowed to the
 * guest's track). Every function that needs the aliases takes them as an argument.
 *
 * A place there are two of, one per track ("Samp Square"), is one alias with `byTrack`: resolved
 * with a guest's track it is that track's room; with no track (no gender on file) both, as
 * alternatives (`either`: the nearer one is opened, the other offered).
 */
import type { VenueTrack } from "./types";

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

/** The separator of several rooms in one string ("Green Room 2 · Green Room 3"). */
const MULTI_ROOM = /\s*·\s*/;

/** The names in a room string: "A · B" -> ["A", "B"]; blanks dropped. */
export function splitVenueNames(value: string): string[] {
  return value
    .split(MULTI_ROOM)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * The key two spellings of one name share: lower case, accents and apostrophes dropped, "&" as
 * "and", every other run of punctuation or space as one space. "Ladies' Office 2 (Mezz)" ->
 * "ladies office 2 mezz".
 */
export function normalizeVenueName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’‘`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * A looser key: also without a floor note ("(Mezz)", "(Basement)", "(First Floor)") or a
 * leading "Mezzanine" / "Mezz", and "Room" / "No." noise. "Mezzanine Ladies Office 2" and
 * "Ladies' Office 2 (Mezz)" both -> "ladies office 2".
 */
export function looseVenueKey(value: string): string {
  const withoutNote = value.replace(/\((?:[^)]*)\)/g, " ");
  return normalizeVenueName(withoutNote)
    .replace(/^(?:mezzanine|mezz)\s+/, "")
    .replace(/\b(?:no|number)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * A room as matching needs it (public rooms only), under the name guests read (the organisers'
 * team name when it has one, `named`; else the blueprint's). A corridor can be the target of an
 * event name (the organisers' "2nd Floor Foyer" may be what the blueprint calls a corridor) but is
 * never found by its own blueprint name or number.
 */
export type VenueNameRoom = {
  id: string;
  name: string;
  number: string | null;
  level: string;
  kind?: string;
  named?: boolean;
  /** Staff only: on the map by name, no directions (ClientRoom.closed). */
  closed?: boolean;
};

/**
 * An event name and the map rooms it names ([] or null = not on the map yet).
 *  - `byTrack` (the server's table only): one room list per track; `roomIds` then holds both.
 *  - `either` (as sent to a guest with no track): `roomIds` are alternatives, not one place made
 *    of several rooms.
 */
export type VenueAliasEntry = {
  name: string;
  roomIds: string[] | null;
  byTrack?: Partial<Record<VenueTrack, string[]>>;
  either?: boolean;
};

/** An alias as the index keeps it: ids filtered to rooms on the map. */
export type VenueIndexAlias = { name: string; roomIds: string[]; byTrack?: Partial<Record<VenueTrack, string[]>>; either?: boolean };

export type VenueIndex = {
  /** Every public room by id. */
  rooms: Map<string, VenueNameRoom>;
  /** normalised event name -> entry (roomIds filtered to rooms on the map). */
  aliases: Map<string, VenueIndexAlias>;
  /** looseVenueKey(event name) -> the normalised names of the mapped aliases that share it. */
  looseAliases: Map<string, string[]>;
  /** normalised room name (the team name, else the blueprint's) -> ids. */
  roomNames: Map<string, string[]>;
  /** normalised room number ("999", "099b") -> ids. */
  roomNumbers: Map<string, string[]>;
  /** room id -> the event names mapped to it, in list order. */
  eventNames: Map<string, string[]>;
};

function push(map: Map<string, string[]>, key: string, id: string) {
  if (!key) return;
  const list = map.get(key);
  if (!list) map.set(key, [id]);
  else if (!list.includes(id)) list.push(id);
}

/**
 * The lookup tables for resolveVenueRoom(). The server passes VENUE_ALIAS_ENTRIES
 * (aliasTable.ts); the browser passes the list the page sent (already filtered to rooms on the
 * map). Ids naming no public room are dropped here (the import's --plan lists them).
 */
export function buildVenueIndex(rooms: VenueNameRoom[], aliases: VenueAliasEntry[]): VenueIndex {
  const index: VenueIndex = {
    rooms: new Map(rooms.map((r) => [r.id, r])),
    aliases: new Map(),
    looseAliases: new Map(),
    roomNames: new Map(),
    roomNumbers: new Map(),
    eventNames: new Map(),
  };
  for (const r of rooms) {
    // A corridor the organisers named is found by that name; a plain one never.
    if (r.kind === "corridor" && !r.named) continue;
    push(index.roomNames, normalizeVenueName(r.name), r.id);
    if (r.number) push(index.roomNumbers, normalizeVenueName(r.number), r.id);
  }
  const onMap = (ids: readonly string[] | null | undefined) => (ids ?? []).filter((id) => index.rooms.has(id));
  for (const a of aliases) {
    const ids = onMap(a.roomIds);
    const key = normalizeVenueName(a.name);
    if (!key || index.aliases.has(key)) continue;
    const entry: VenueIndexAlias = { name: a.name, roomIds: ids };
    if (a.byTrack) entry.byTrack = { BHAIO: onMap(a.byTrack.BHAIO), BEHNO: onMap(a.byTrack.BEHNO) };
    if (a.either) entry.either = true;
    index.aliases.set(key, entry);
    if (ids.length > 0) push(index.looseAliases, looseVenueKey(a.name), key);
    for (const id of ids) {
      const names = index.eventNames.get(id) ?? [];
      names.push(a.name);
      index.eventNames.set(id, names);
    }
  }
  return index;
}

/**
 * The rooms an alias names for a guest: their track's when it has one room per track, else all of
 * them; `either` = they are alternatives (a per-track place seen without a track).
 */
export function aliasRoomsFor(alias: VenueIndexAlias, track?: VenueTrack | null): { roomIds: string[]; either: boolean } {
  if (alias.byTrack && track) return { roomIds: alias.byTrack[track] ?? [], either: false };
  return { roomIds: alias.roomIds, either: Boolean(alias.byTrack || alias.either) && alias.roomIds.length > 1 };
}

/**
 * How one name resolved:
 *  - "event": an event name mapped in the alias table;
 *  - "room": a room's own name (the organisers' team name, else the blueprint's), its number
 *    ("999", "Room 999") or its map id ("2-999");
 *  - "unmapped": an event name listed but not mapped yet (or, a per-track place, not for this track);
 *  - "unknown": nothing by that name.
 * `either`: the rooms are alternatives (a per-track place resolved without a track).
 */
export type VenueNameMatch = {
  name: string;
  roomIds: string[];
  status: "event" | "room" | "unmapped" | "unknown";
  either?: boolean;
};

export type VenueResolution = {
  /** One per name in the string ("A · B" -> two). */
  parts: VenueNameMatch[];
  /** Every room found, in order, without repeats. */
  roomIds: string[];
};

function resolveOne(name: string, index: VenueIndex, track: VenueTrack | null | undefined): VenueNameMatch {
  const key = normalizeVenueName(name);
  const alias = index.aliases.get(key);
  if (alias) {
    const { roomIds, either } = aliasRoomsFor(alias, track);
    if (roomIds.length > 0) return { name, roomIds, status: "event", ...(either ? { either: true } : {}) };
    // One room per track and theirs isn't on the map: never the other track's by another way below.
    if (alias.byTrack) return { name, roomIds: [], status: "unmapped" };
  }

  // A map id ("2-999", "M-open-area-9"), exactly as the sheet shows it to admins.
  const byId = index.rooms.get(name.trim());
  if (byId) return { name, roomIds: [byId.id], status: "room" };

  const byName = index.roomNames.get(key);
  if (byName) return { name, roomIds: byName, status: "room" };

  // "999", "Room 999", "Rm. 999", "#999".
  const num = key.replace(/^(?:room|rm)\s+/, "");
  const byNumber = index.roomNumbers.get(num) ?? index.roomNumbers.get(num.replace(/\s+/g, ""));
  if (byNumber) return { name, roomIds: byNumber, status: "room" };

  // Another spelling of a mapped event name ("Ladies' Office 2 (Mezz)" for "Mezzanine Ladies
  // Office 2"). Only between event names: a blueprint name without its floor note could be
  // another floor's room.
  const loose: string[] = [];
  let looseEither = false;
  for (const k of index.looseAliases.get(looseVenueKey(name)) ?? []) {
    const other = index.aliases.get(k);
    if (!other) continue;
    const found = aliasRoomsFor(other, track);
    looseEither ||= found.either;
    for (const id of found.roomIds) if (!loose.includes(id)) loose.push(id);
  }
  if (loose.length > 0) return { name, roomIds: loose, status: "event", ...(looseEither ? { either: true } : {}) };

  return { name, roomIds: [], status: alias ? "unmapped" : "unknown" };
}

/**
 * Finds the map rooms a name means: an event name (the alias table), a room's own name (the
 * organisers' team name, else the blueprint's) or number, or a map id; "A · B" resolves each
 * part. Case, spacing and punctuation don't matter. `track` = the guest's track (null / omitted =
 * no gender on file): a place with one room per track resolves to theirs, without a track to
 * both, as alternatives.
 */
export function resolveVenueRoom(value: string, index: VenueIndex, track?: VenueTrack | null): VenueResolution {
  const parts = splitVenueNames(value).map((n) => resolveOne(n, index, track));
  const roomIds: string[] = [];
  for (const p of parts) for (const id of p.roomIds) if (!roomIds.includes(id)) roomIds.push(id);
  return { parts, roomIds };
}

/**
 * How a resolution that found several rooms should read (mapTypes.ts MatchSpread): "split" when
 * several names found rooms ("A · B"), "covers" when one event name maps to several rooms,
 * "same-name" when several rooms share a name (or an event name has one room per track and the
 * guest has no track): the nearest is opened, the others offered; else "one".
 */
export function spreadOf(res: VenueResolution): "one" | "split" | "covers" | "same-name" {
  const found = res.parts.filter((p) => p.roomIds.length > 0);
  if (found.length > 1 && res.roomIds.length > 1) return "split";
  if (res.roomIds.length <= 1) return "one";
  return found[0]?.status === "event" && !found[0].either ? "covers" : "same-name";
}

/**
 * The alias list the browser gets: every listed event name, ids filtered to rooms on the map and
 * narrowed to the guest's track (a per-track place: their room only; without a track both, marked
 * `either`). The per-track table itself never leaves the server.
 */
export function aliasEntriesFor(index: VenueIndex, track?: VenueTrack | null): { name: string; roomIds: string[]; either?: boolean }[] {
  return [...index.aliases.values()].map((a) => {
    const { roomIds, either } = aliasRoomsFor(a, track);
    return { name: a.name, roomIds, ...(either ? { either: true } : {}) };
  });
}

/**
 * Alias coverage for the import's printout and the admin note: counts and bad ids, no geometry.
 * `aliases` = VENUE_ALIAS_ENTRIES (server only).
 */
export function aliasCoverage(index: VenueIndex, aliases: VenueAliasEntry[]) {
  const missingIds: string[] = [];
  for (const a of aliases) {
    const ids = [...(a.roomIds ?? []), ...(a.byTrack?.BEHNO ?? []), ...(a.byTrack?.BHAIO ?? [])];
    for (const id of ids) if (!index.rooms.has(id) && !missingIds.includes(id)) missingIds.push(id);
  }
  const all = [...index.aliases.values()];
  const mapped = all.filter((a) => a.roomIds.length > 0).map((a) => a.name);
  const unmapped = all.filter((a) => a.roomIds.length === 0).map((a) => a.name);
  // An unmapped event name can still resolve (a blueprint room of the same name).
  const resolvable = unmapped.filter((n) => resolveVenueRoom(n, index).roomIds.length > 0);
  return { total: all.length, mapped, unmapped, resolvable, missingIds };
}
