/**
 * Server only: the venue map as the browser gets it. No database and no file system here, so the
 * hub's pages (through src/lib/venue/data.ts) and `npm run venue:import` build exactly the same
 * payload from a parsed map.
 *
 * toClientVenue() is the only way the map reaches the browser: public rooms keep their number and
 * entry (a staff-only room, `closed`, never an entry) and go out under the organisers' team name
 * when the room has one (VENUE_ROOM_NAMES in aliasTable.ts, server only: `named`), else the
 * blueprint's; back-of-house rooms (public: false) become bare outlines with no id, name, number
 * or entry, so their names never leave the server (a team name given to one is never applied).
 * Stairs and elevators go out by kind and place, never by the blueprint's number (the building
 * has no stair signs): a connector's name is connectorLabel(), its room's shaftRoomName(),
 * whatever the stored map says. Every object is rebuilt field by field, so a key the stored JSON
 * may carry beyond VenueMapData never reaches the browser.
 *
 * Two payloads:
 *  - toClientVenue(): everyone's (delegates, admins, and santos when the map has no valid santo
 *    extras). The sadhus' residence is bare outlines in it like any private room.
 *  - toSantClientVenue(): the Pujya Santo view's (only src/lib/venue/data.ts's getVenueForPages()
 *    for a viewer with role SANT, and the import scripts, use it; it is not re-exported from
 *    data.ts). The same payload plus the residence rooms santos are shown (VenueRoom.sant "own"),
 *    each under the name the user gave it (SANT_ROOM_NAMES) with no number and its entry on the
 *    santos' floor; the level's grid is the santos' floor (santGrid) with everyone else's as
 *    `guestGrid`, and connectors carry their santo landings. The residence floor santos walk (a
 *    "way" or "shared" room) is sent as nothing at all, not even an outline, so it reads as plain
 *    floor, as a corridor does, under their routes (a grey block means "no way through"); any other
 *    residence room (one santos don't walk, an "own" one the table doesn't name) stays a bare
 *    outline. Never a name, number or id of either.
 */
import "server-only";
import type { VenueConnector, VenueLevel, VenueLevelId, VenueMapData, VenuePoint, VenueRoom, VenueSantClass } from "./types";
import { SANT_ROOM_NAME_BY_ID, VENUE_ALIAS_ENTRIES, VENUE_ROOM_NAME_BY_ID } from "./aliasTable";
import { connectorLabel, connectorOfRoom, shaftRoomName, type ClientLevel, type ClientRoom, type ClientVenue } from "./view";

/** Client payloads per parsed map. */
const clientCache = new WeakMap<VenueMapData, ClientVenue>();
/** The Pujya Santo view's payloads per parsed map. */
const santCache = new WeakMap<VenueMapData, ClientVenue>();

const SANT_CLASSES: ReadonlySet<string> = new Set<VenueSantClass>(["own", "shared", "way"]);
const isShaft = (kind: string) => kind === "stair" || kind === "elevator";

/** A room of the sadhus' residence (VenueRoom.sant), as only the Pujya Santo view may use it. */
export function isSantRoom(r: VenueRoom): boolean {
  return !r.public && !r.closed && typeof r.sant === "string" && SANT_CLASSES.has(r.sant);
}

/** A residence room santos are shown by name: an "own" room (not a shaft) SANT_ROOM_NAMES names. */
function shownToSantos(r: VenueRoom): boolean {
  return isSantRoom(r) && r.sant === "own" && !isShaft(r.kind) && SANT_ROOM_NAME_BY_ID.has(r.id);
}

const r1 = (v: number) => Math.round(v * 10) / 10;
const flat = (polygon: VenuePoint[]) => polygon.flatMap(([x, y]) => [r1(x), r1(y)]);
const point = ([x, y]: VenuePoint): VenuePoint => [r1(x), r1(y)];

/**
 * Path data with every number rounded to 0.1 unit (the blueprint's points carry more precision
 * than a phone can show). Only paths made of M/L/H/V/C/S/Q/T/Z are rewritten; anything else
 * (arcs, whose flags can't be tokenised this simply) is passed through as is.
 */
export function roundPath(d: string): string {
  if (/[Aa]/.test(d)) return d;
  const tokens = d.match(/[MmLlHhVvCcSsQqTtZz]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g);
  if (!tokens) return d;
  let out = "";
  let prevNum = false;
  for (const t of tokens) {
    if (/^[A-Za-z]$/.test(t)) {
      out += t;
      prevNum = false;
      continue;
    }
    const s = String(r1(Number(t)));
    out += prevNum && !s.startsWith("-") ? ` ${s}` : s;
    prevNum = true;
  }
  return out;
}

function clientLevel(l: VenueLevel, connectors: readonly VenueConnector[], viewer: "guest" | "sant" = "guest"): ClientLevel {
  const rooms: ClientRoom[] = [];
  const blocks: number[][] = [];
  for (const r of l.rooms) {
    if (viewer === "sant" && shownToSantos(r)) {
      // The Pujya Santo view: the name the user gave it (SANT_ROOM_NAMES) only, never the stored
      // one; no number.
      rooms.push({
        id: r.id,
        level: l.id,
        kind: r.kind,
        name: SANT_ROOM_NAME_BY_ID.get(r.id)!,
        named: true,
        number: null,
        pts: flat(r.polygon),
        label: point(r.label),
        entry: r.santEntry ? point(r.santEntry) : null,
        sant: "own",
      });
      continue;
    }
    if (!r.public) {
      // The Pujya Santo view: the residence floor santos walk ("way" / "shared") is floor to them,
      // so it goes out as nothing (a grey block under their route would read as "no way through").
      if (viewer === "sant" && isSantRoom(r) && r.sant !== "own") continue;
      // Back-of-house: the outline only. No id (it carries the number or a name slug), no name,
      // number, label or entry.
      blocks.push(flat(r.polygon));
      continue;
    }
    const closed = r.closed === true;
    const label = point(r.label);
    // A stair / elevator room is named by its place, never by the blueprint's number; any other
    // room by the organisers' team name when they gave it one (public rooms only get here).
    const shaft = r.kind === "stair" || r.kind === "elevator";
    const teamName = shaft ? undefined : VENUE_ROOM_NAME_BY_ID.get(r.id);
    const name = shaft
      ? shaftRoomName(r.kind as "stair" | "elevator", connectorOfRoom({ id: r.id, level: l.id, kind: r.kind, label }, connectors)?.place)
      : (teamName ?? r.name);
    rooms.push({
      id: r.id,
      level: l.id,
      kind: r.kind,
      name,
      ...(teamName ? { named: true } : {}),
      number: r.number,
      pts: flat(r.polygon),
      label,
      // Staff only: shown and named, never a way in.
      entry: r.entry && !closed ? point(r.entry) : null,
      ...(closed ? { closed: true } : {}),
    });
  }
  const { x, y, width, height } = l.bounds;
  if (viewer === "sant" && l.santGrid) {
    return {
      id: l.id,
      name: l.name,
      order: l.order,
      bounds: { x, y, width, height },
      walls: roundPath(l.walls),
      grid: gridOf(l.santGrid),
      guestGrid: gridOf(l.grid),
      rooms,
      blocks,
    };
  }
  const { cell, cols, rows, origin, walkable } = l.grid;
  return {
    id: l.id,
    name: l.name,
    order: l.order,
    bounds: { x, y, width, height },
    walls: roundPath(l.walls),
    grid: { cell, cols, rows, origin: [origin[0], origin[1]], walkable },
    rooms,
    blocks,
  };
}

function gridOf(g: VenueLevel["grid"]): VenueLevel["grid"] {
  const { cell, cols, rows, origin, walkable } = g;
  return { cell, cols, rows, origin: [origin[0], origin[1]], walkable };
}

/** The map as the browser gets it (see the file comment). Memoised per parsed map. */
export function toClientVenue(data: VenueMapData): ClientVenue {
  const hit = clientCache.get(data);
  if (hit) return hit;
  const out: ClientVenue = {
    generatedAt: data.generatedAt,
    levels: data.levels
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((l) => clientLevel(l, data.connectors)),
    connectors: data.connectors.map((c) => ({
      id: c.id,
      kind: c.kind,
      // "Stairs" / "Elevator": never the stored name (an older map's carries the blueprint's number).
      name: connectorLabel(c),
      points: Object.fromEntries(
        data.levels.flatMap((l) => (c.points[l.id] ? [[l.id, point(c.points[l.id] as VenuePoint)]] : [])),
      ),
      // Which half of the map it's in (Bhaio right, Behno left): the router needs it. Not sensitive.
      ...(c.side === "left" || c.side === "right" ? { side: c.side } : {}),
      // Where it is in the building: how the steps name it ("the foyer stairs"). Not sensitive.
      ...(c.place === "foyer" || c.place === "side" || c.place === "back" ? { place: c.place } : {}),
    })),
  };
  clientCache.set(data, out);
  return out;
}

/** The map carries the Pujya Santo view's extras: a residence room with a valid class. */
export function hasSantExtras(data: VenueMapData): boolean {
  return data.levels.some((l) => l.rooms.some(isSantRoom));
}

/**
 * What doesn't fit between SANT_ROOM_NAMES / the alias tables and this map's residence rooms (ids
 * only, for the import's terminal; the hub logs a count): an "own" room without a name (it would
 * be a room santos can't read), a name for anything else, an id named in both SANT_ROOM_NAMES and
 * VENUE_ROOM_NAMES, an event name (VENUE_ALIASES) mapped to a residence room. Only meaningful for
 * a map with santo extras (hasSantExtras()): for one, the import stops on any and at run time any
 * gives santos the delegates' map (data.ts); a map without them leaves the names unused.
 */
export function santNameProblems(data: VenueMapData): string[] {
  const out: string[] = [];
  const byId = new Map(data.levels.flatMap((l) => l.rooms.map((r) => [r.id, r] as const)));
  for (const r of byId.values()) {
    if (isSantRoom(r) && r.sant === "own" && !isShaft(r.kind) && !SANT_ROOM_NAME_BY_ID.has(r.id)) {
      out.push(`${r.id}: a residence room santos are shown has no name in SANT_ROOM_NAMES`);
    }
  }
  for (const id of SANT_ROOM_NAME_BY_ID.keys()) {
    const r = byId.get(id);
    if (!r) out.push(`${id}: SANT_ROOM_NAMES names a room that isn't on this map`);
    else if (!(isSantRoom(r) && r.sant === "own" && !isShaft(r.kind))) {
      out.push(`${id}: SANT_ROOM_NAMES names a room that isn't one santos are shown (${r.public ? "public" : r.sant ? `a "${r.sant}" residence room` : "private"})`);
    }
    if (VENUE_ROOM_NAME_BY_ID.has(id)) out.push(`${id}: named in both SANT_ROOM_NAMES and VENUE_ROOM_NAMES`);
  }
  for (const a of VENUE_ALIAS_ENTRIES) {
    for (const id of new Set([...(a.roomIds ?? []), ...(a.byTrack?.BEHNO ?? []), ...(a.byTrack?.BHAIO ?? [])])) {
      const r = byId.get(id);
      if (r && isSantRoom(r)) out.push(`${id}: the event name "${a.name}" (VENUE_ALIASES) is mapped to a residence room`);
    }
  }
  return out;
}

/**
 * The Pujya Santo view's payload (see the file comment); toClientVenue(data) itself, the same
 * object, when the map has no santo extras. Memoised per parsed map. Callers check that the map's
 * santo extras are valid first (validate.ts santErrors, santNameProblems()): data.ts does.
 */
export function toSantClientVenue(data: VenueMapData): ClientVenue {
  if (!hasSantExtras(data)) return toClientVenue(data);
  const hit = santCache.get(data);
  if (hit) return hit;
  const ids = data.levels.map((l) => l.id);
  const out: ClientVenue = {
    generatedAt: data.generatedAt,
    levels: data.levels
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((l) => clientLevel(l, data.connectors, "sant")),
    connectors: data.connectors.map((c) => {
      // The santos' own landings: on levels everyone's (`points`) lack.
      const extra: [VenueLevelId, VenuePoint][] = ids.flatMap((id) => {
        const p = c.santPoints?.[id];
        return !c.points[id] && p ? [[id, point(p)] as [VenueLevelId, VenuePoint]] : [];
      });
      return {
        id: c.id,
        kind: c.kind,
        name: connectorLabel(c),
        // Everyone's landings and the santos' own, per level in the map's order.
        points: Object.fromEntries(
          ids.flatMap((id) => {
            const p = c.points[id] ?? c.santPoints?.[id];
            return p ? [[id, point(p)]] : [];
          }),
        ),
        ...(c.side === "left" || c.side === "right" ? { side: c.side } : {}),
        ...(c.place === "foyer" || c.place === "side" || c.place === "back" ? { place: c.place } : {}),
        // Which of them only santos use: route.ts leaves them out of trips outside the residence.
        ...(extra.length > 0 ? { santPoints: Object.fromEntries(extra) } : {}),
      };
    }),
  };
  santCache.set(data, out);
  return out;
}
