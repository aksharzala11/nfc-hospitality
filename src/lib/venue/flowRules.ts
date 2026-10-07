/**
 * Flow rules: how the organisers want guests to walk (their flow maps, 2026-10-04), beyond what the
 * building itself allows. Stored with the venue map (VenueMapData.flowRules, types.ts), merged in by
 * `npm run venue:import` from a rules file kept outside the repo (like the map, they are derived
 * from the organisers' blueprint-based drawings: room, door and stair ids). Six kinds:
 *  - doors: a room is left / entered only by some of its doors (VenueRoom.doors ids);
 *  - stairs: trips to or from some rooms arrive on / leave their floor only by some stairs;
 *  - avoid: rooms never walked through on the way elsewhere (a trip to or from a room that opens
 *    onto one goes through it);
 *  - passage: rooms walked through freely (no through-room cost; the steps name them);
 *  - side: stairs on the other side a track may also use (at a time);
 *  - route: a whole route by waypoints for one trip (a last resort).
 * Each rule is for BHAIO, BEHNO or ALL, optionally only within a window (one event day, from / to
 * Eastern wall clock).
 *
 * What a page sends the browser is never the stored rules: routeRulesFor() narrows them to the
 * rules in force at one time for one viewer's track, resolved to what the router needs (door
 * positions, room and connector ids, waypoint points), with a `key` that names that set for caches.
 * A viewer with no gender on file gets the rules for everyone, and for a room both tracks' door
 * rules restrict, either track's doors. Pure and client-safe (no database, no alias table).
 *
 * The router (route.ts) applies them as costs, never as walls: a door, stair or room a rule rules
 * out still carries a route when nothing else gets there, so "no way there" messages stay true.
 */
import type {
  VenueDoor,
  VenueFlowRule,
  VenueFlowRuleKind,
  VenueFlowTrack,
  VenueFlowWindow,
  VenueGrid,
  VenueLevelId,
  VenueMapData,
  VenuePoint,
  VenueRoomKind,
  VenueTrack,
  VenueWaypoint,
} from "./types";
import { pointInPolygon } from "./view";
import { toEventLocalInput } from "../time";

export const FLOW_RULE_KINDS: readonly VenueFlowRuleKind[] = ["doors", "stairs", "avoid", "passage", "side", "route"];
export const FLOW_TRACKS: readonly VenueFlowTrack[] = ["BHAIO", "BEHNO", "ALL"];
/** Enclosed rooms (not a corridor, lobby, exit or open floor): what a door rule's `beyond` may lead into. */
const INNER_KINDS: ReadonlySet<VenueRoomKind> = new Set(["room", "hall", "dining", "restroom"]);

/** A waypoint as the router takes it: a point (a door's middle, or a point) or a stair / elevator between two floors. */
export type RouteWaypoint = { level: VenueLevelId; point: VenuePoint } | { connector: string; from: VenueLevelId; to: VenueLevelId };

/**
 * The flow rules in force for one viewer at one time, as the router applies them (and as the
 * browser gets them): every rule here applies, whatever the track. Room / connector ids are map
 * ids of public rooms and connectors (already in the payload); doors are their middles.
 */
export type RouteRules = {
  /** Names this set of rules (a hash of the rest): routers and route texts are cached by it. */
  key: string;
  /**
   * Per room: the doors it may be left / entered by (their middles); absent = any. `beyond`: for a
   * door it rules out that opens straight into another enclosed room guests can go to (VenueDoor.to:
   * a room, hall or restroom, not a corridor or foyer) that none of its allowed doors leads into,
   * that room: a trip between the two uses it freely (the Main Hall to its cry room).
   */
  doors: { room: string; exits?: VenuePoint[]; entries?: VenuePoint[]; beyond?: { at: VenuePoint; room: string }[] }[];
  /** Trips to or from these rooms arrive on / leave their floor only by these connectors. */
  stairs: { rooms: string[]; connectors: string[] }[];
  /**
   * Rooms never walked through on the way elsewhere: stepping into one costs a very high, finite
   * penalty once (not per step, so a route that has to cross one still takes the short way across
   * it, and no other room becomes a way round); not for a trip to or from a room opening onto one.
   */
  avoid: string[];
  /** Rooms walked through freely. */
  passage: string[];
  /** Connectors usable whatever their side. */
  side: string[];
  /** Trips from `from` to `to` (room ids) go by these waypoints (Step-free off). */
  routes: { from: string; to: string; via: RouteWaypoint[] }[];
};

// ---------------------------------------------------------------------------
// Door openings (the same cells scripts/venue/extract.py room_doors() groups)
// ---------------------------------------------------------------------------

export type DoorOpening = { cells: number[]; at: VenuePoint; width: number };

const N8 = [
  [-1, -1],
  [-1, 0],
  [-1, 1],
  [0, -1],
  [0, 1],
  [1, -1],
  [1, 0],
  [1, 1],
] as const;

/**
 * A room's inside cells and door openings on a walkable grid (`walk`: 1 = walkable, row-major):
 * inside = walkable cells whose centre is inside the outline (`pts`, flat [x0, y0, ...]); its
 * openings = the walkable cells outside it that touch an inside cell (8 neighbours), in 8-connected
 * groups, each with its middle and width. scripts/venue/extract.py room_doors() finds exactly these
 * on the grid it writes (same cell centres, same even-odd test), so a stored door's `at` is one of
 * these middles.
 */
export function doorOpenings(
  walk: Uint8Array,
  grid: Pick<VenueGrid, "cols" | "rows" | "cell" | "origin">,
  pts: readonly number[],
): { inside: number[]; openings: DoorOpening[] } {
  const { cols, rows, cell, origin } = grid;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    x0 = Math.min(x0, pts[i]);
    x1 = Math.max(x1, pts[i]);
    y0 = Math.min(y0, pts[i + 1]);
    y1 = Math.max(y1, pts[i + 1]);
  }
  const c0 = Math.max(0, Math.floor((x0 - origin[0]) / cell));
  const c1 = Math.min(cols - 1, Math.floor((x1 - origin[0]) / cell));
  const r0 = Math.max(0, Math.floor((y0 - origin[1]) / cell));
  const r1 = Math.min(rows - 1, Math.floor((y1 - origin[1]) / cell));
  const flat = pts as number[];
  const inside: number[] = [];
  const isInside = new Set<number>();
  for (let r = r0; r <= r1; r++) {
    const y = origin[1] + (r + 0.5) * cell;
    for (let c = c0; c <= c1; c++) {
      const i = r * cols + c;
      if (walk[i] && pointInPolygon(flat, origin[0] + (c + 0.5) * cell, y)) {
        inside.push(i);
        isInside.add(i);
      }
    }
  }
  const ring = new Set<number>();
  for (const i of inside) {
    const r = (i / cols) | 0;
    const c = i - r * cols;
    for (const [dr, dc] of N8) {
      const rr = r + dr;
      const cc = c + dc;
      if (rr < 0 || cc < 0 || rr >= rows || cc >= cols) continue;
      const j = rr * cols + cc;
      if (walk[j] && !isInside.has(j)) ring.add(j);
    }
  }
  const seen = new Set<number>();
  const openings: DoorOpening[] = [];
  for (const start of [...ring].sort((a, b) => a - b)) {
    if (seen.has(start)) continue;
    const cells: number[] = [];
    const queue = [start];
    seen.add(start);
    while (queue.length > 0) {
      const i = queue.pop()!;
      cells.push(i);
      const r = (i / cols) | 0;
      const c = i - r * cols;
      for (const [dr, dc] of N8) {
        const rr = r + dr;
        const cc = c + dc;
        if (rr < 0 || cc < 0 || rr >= rows || cc >= cols) continue;
        const j = rr * cols + cc;
        if (ring.has(j) && !seen.has(j)) {
          seen.add(j);
          queue.push(j);
        }
      }
    }
    let sx = 0;
    let sy = 0;
    let cmin = Infinity;
    let cmax = -Infinity;
    let rmin = Infinity;
    let rmax = -Infinity;
    for (const i of cells) {
      const r = (i / cols) | 0;
      const c = i - r * cols;
      sx += c;
      sy += r;
      cmin = Math.min(cmin, c);
      cmax = Math.max(cmax, c);
      rmin = Math.min(rmin, r);
      rmax = Math.max(rmax, r);
    }
    openings.push({
      cells,
      at: [origin[0] + (sx / cells.length + 0.5) * cell, origin[1] + (sy / cells.length + 0.5) * cell],
      width: (Math.max(cmax - cmin, rmax - rmin) + 1) * cell,
    });
  }
  return { inside, openings };
}

/**
 * The opening a door's middle names: the one holding the walkable ring cell nearest `at` (within a
 * cell and a half). On the grid the door was found on that is exactly its own group; on another
 * (the santos' floor, where a seam may join two groups) the group around it.
 */
export function openingAt(openings: readonly DoorOpening[], grid: Pick<VenueGrid, "cols" | "cell" | "origin">, at: VenuePoint): number {
  let best = -1;
  let bestD = grid.cell * 1.5;
  openings.forEach((o, k) => {
    for (const i of o.cells) {
      const r = (i / grid.cols) | 0;
      const c = i - r * grid.cols;
      const d = Math.hypot(grid.origin[0] + (c + 0.5) * grid.cell - at[0], grid.origin[1] + (r + 0.5) * grid.cell - at[1]);
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    }
  });
  return best;
}

// ---------------------------------------------------------------------------
// Checking stored rules (validate.ts calls this; problems make the app ignore every rule)
// ---------------------------------------------------------------------------

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isPoint = (v: unknown): v is VenuePoint => Array.isArray(v) && v.length === 2 && isNum(v[0]) && isNum(v[1]);
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const HM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const RULE_FIELDS: Record<VenueFlowRuleKind, readonly string[]> = {
  doors: ["room", "exits", "entries"],
  stairs: ["rooms", "connectors"],
  avoid: ["rooms"],
  passage: ["rooms"],
  side: ["connectors"],
  route: ["from", "to", "via"],
};
const BASE_FIELDS = ["id", "kind", "track", "window", "note"];

/**
 * The stored rules against the map: shape, every id (rooms: public rooms guests can go to; doors:
 * that room's VenueRoom.doors; connectors: on the map, serving the levels a waypoint names), and
 * that every door a rule names is an opening on the room's grid (`walkOf`: the decoded delegates'
 * grid of a level). `rules` is null when there is any error (the app then applies none);
 * `warnings` never block. Messages carry rule and map ids only.
 */
export function checkFlowRules(
  raw: unknown,
  data: Pick<VenueMapData, "levels" | "connectors">,
  walkOf: (level: VenueLevelId) => Uint8Array | null,
): { rules: VenueFlowRule[] | null; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (raw === undefined) return { rules: [], errors, warnings };
  if (!Array.isArray(raw)) return { rules: null, errors: ["flowRules must be an array of rules"], warnings };
  const rooms = new Map(data.levels.flatMap((l) => l.rooms.map((r) => [r.id, { room: r, level: l }] as const)));
  const connectors = new Map(data.connectors.map((c) => [c.id, c]));
  const ids = new Set<string>();
  const openingsCache = new Map<string, ReturnType<typeof doorOpenings> | null>();
  const openingsOf = (roomId: string) => {
    if (openingsCache.has(roomId)) return openingsCache.get(roomId)!;
    const hit = rooms.get(roomId);
    const walk = hit ? walkOf(hit.level.id) : null;
    const out = hit && walk ? doorOpenings(walk, hit.level.grid, hit.room.polygon.flat()) : null;
    openingsCache.set(roomId, out);
    return out;
  };
  /** A room a rule may name: on the map, public, not staff only, with directions to it. */
  const roomOk = (id: unknown, where: string): id is string => {
    if (!isStr(id)) {
      errors.push(`${where}: a room id is missing`);
      return false;
    }
    const hit = rooms.get(id);
    if (!hit) errors.push(`${where}: no room ${id} on the map`);
    else if (!hit.room.public || hit.room.closed || !hit.room.entry) {
      errors.push(`${where}: ${id} isn't a room guests can go to (${!hit.room.public ? "private" : hit.room.closed ? "staff only" : "no entry"})`);
    } else return true;
    return false;
  };
  const roomsOk = (v: unknown, where: string): v is string[] => {
    if (!Array.isArray(v) || v.length === 0) {
      errors.push(`${where}: needs a non-empty list of room ids`);
      return false;
    }
    return v.map((id, i) => roomOk(id, `${where}[${i}]`)).every(Boolean);
  };
  const connectorsOk = (v: unknown, where: string): v is string[] => {
    if (!Array.isArray(v) || v.length === 0) {
      errors.push(`${where}: needs a non-empty list of stair / elevator ids`);
      return false;
    }
    let ok = true;
    v.forEach((id, i) => {
      if (!isStr(id) || !connectors.has(id)) {
        errors.push(`${where}[${i}]: no stair / elevator ${String(id)} on the map`);
        ok = false;
      }
    });
    return ok;
  };
  const doorOk = (roomId: string, door: unknown, where: string): boolean => {
    const room = rooms.get(roomId)?.room;
    const d = isStr(door) ? room?.doors?.find((x) => x.id === door) : undefined;
    if (!d) {
      errors.push(`${where}: ${isStr(door) ? `${door} isn't a door of ${roomId}` : "a door id is missing"}`);
      return false;
    }
    const o = openingsOf(roomId);
    const level = rooms.get(roomId)!.level;
    if (!o || openingAt(o.openings, level.grid, d.at) < 0) {
      errors.push(`${where}: ${d.id} isn't an opening of ${roomId} on this map's grid (re-run scripts/venue/extract.py)`);
      return false;
    }
    return true;
  };

  raw.forEach((rule: unknown, k: number) => {
    const where = `flowRules[${k}]${isObj(rule) && isStr(rule.id) ? ` (${rule.id})` : ""}`;
    if (!isObj(rule)) {
      errors.push(`${where}: not an object`);
      return;
    }
    if (!isStr(rule.id)) errors.push(`${where}: id is missing`);
    else if (ids.has(rule.id)) errors.push(`${where}: id ${rule.id} is used twice`);
    else ids.add(rule.id);
    const kind = rule.kind as VenueFlowRuleKind;
    if (!FLOW_RULE_KINDS.includes(kind)) {
      errors.push(`${where}: unknown kind ${JSON.stringify(rule.kind)} (one of ${FLOW_RULE_KINDS.join(", ")})`);
      return;
    }
    if (!FLOW_TRACKS.includes(rule.track as VenueFlowTrack)) errors.push(`${where}: track must be one of ${FLOW_TRACKS.join(", ")}`);
    if (rule.window !== undefined) {
      const w = rule.window;
      if (!isObj(w) || !isStr(w.day) || !DAY_RE.test(w.day) || !isStr(w.from) || !HM_RE.test(w.from) || !isStr(w.to) || !HM_RE.test(w.to)) {
        errors.push(`${where}: window must be { day: "YYYY-MM-DD", from: "HH:MM", to: "HH:MM" }`);
      } else if (w.from >= w.to) errors.push(`${where}: window ends (${w.to}) before it starts (${w.from})`);
    }
    if (rule.note !== undefined && typeof rule.note !== "string") errors.push(`${where}: note must be text`);
    const extra = Object.keys(rule).filter((f) => !BASE_FIELDS.includes(f) && !RULE_FIELDS[kind].includes(f));
    if (extra.length > 0) warnings.push(`${where}: fields a ${kind} rule doesn't have (ignored): ${extra.join(", ")}`);

    switch (kind) {
      case "doors": {
        if (!roomOk(rule.room, `${where}.room`)) break;
        const room = rule.room as string;
        if (rule.exits === undefined && rule.entries === undefined) errors.push(`${where}: needs exits, entries or both`);
        for (const key of ["exits", "entries"] as const) {
          const v = rule[key];
          if (v === undefined) continue;
          if (!Array.isArray(v) || v.length === 0) {
            errors.push(`${where}.${key}: needs a non-empty list of door ids of ${room}`);
            continue;
          }
          v.forEach((d, i) => doorOk(room, d, `${where}.${key}[${i}]`));
        }
        break;
      }
      case "stairs":
        roomsOk(rule.rooms, `${where}.rooms`);
        connectorsOk(rule.connectors, `${where}.connectors`);
        break;
      case "avoid":
      case "passage":
        roomsOk(rule.rooms, `${where}.rooms`);
        break;
      case "side":
        connectorsOk(rule.connectors, `${where}.connectors`);
        break;
      case "route": {
        roomOk(rule.from, `${where}.from`);
        roomOk(rule.to, `${where}.to`);
        if (!Array.isArray(rule.via) || rule.via.length === 0) {
          errors.push(`${where}.via: needs a non-empty list of waypoints`);
          break;
        }
        rule.via.forEach((w: unknown, i: number) => {
          const at = `${where}.via[${i}]`;
          if (!isObj(w)) {
            errors.push(`${at}: not a waypoint`);
          } else if ("door" in w) {
            const door = w.door;
            const roomId = isStr(door) ? door.split(":")[0] : "";
            if (!rooms.has(roomId)) errors.push(`${at}: ${String(door)} isn't a door of a room on the map`);
            else doorOk(roomId, door, at);
          } else if ("connector" in w) {
            const c = isStr(w.connector) ? connectors.get(w.connector) : undefined;
            if (!c) errors.push(`${at}: no stair / elevator ${String(w.connector)} on the map`);
            else if (!c.points[w.from as VenueLevelId] || !c.points[w.to as VenueLevelId] || w.from === w.to) {
              errors.push(`${at}: ${c.id} doesn't join levels ${String(w.from)} and ${String(w.to)}`);
            }
          } else if ("point" in w) {
            const lvl = data.levels.find((l) => l.id === w.level);
            if (!lvl || !isPoint(w.point)) errors.push(`${at}: a point waypoint needs a level of the map and a point`);
          } else {
            errors.push(`${at}: a waypoint is { door }, { connector, from, to } or { level, point }`);
          }
        });
        break;
      }
    }
  });
  return { rules: errors.length > 0 ? null : (raw as VenueFlowRule[]), errors, warnings };
}

// ---------------------------------------------------------------------------
// The rules in force for a viewer at a time
// ---------------------------------------------------------------------------

/** Whether a window holds an instant (Eastern wall clock; the end excluded). No window = always. */
export function windowHolds(window: VenueFlowWindow | undefined, at: Date | null): boolean {
  if (!window) return true;
  if (!at) return false;
  const local = toEventLocalInput(at);
  const hm = local.slice(11, 16);
  return local.slice(0, 10) === window.day && hm >= window.from && hm < window.to;
}

/** A short, stable name for a value (FNV-1a over its JSON). */
function hashOf(value: unknown): string {
  const s = JSON.stringify(value);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/**
 * The rules in force at `at` (null = no time: only rules without a window) for a viewer of `track`
 * (null = no gender on file: everyone's rules, and for a room both tracks' door rules restrict, the
 * doors of either), resolved for the router. Null when none apply. `data` = the map the rules were
 * checked against (checkFlowRules()).
 */
export function routeRulesFor(
  data: Pick<VenueMapData, "levels">,
  rules: readonly VenueFlowRule[] | null | undefined,
  at: Date | null,
  track: VenueTrack | null,
): RouteRules | null {
  if (!rules || rules.length === 0) return null;
  const live = rules.filter((r) => windowHolds(r.window, at));
  const mine = live.filter((r) => r.track === "ALL" || r.track === track);
  if (live.length === 0) return null;
  const doorById = new Map<string, VenueDoor>();
  const levelOfRoom = new Map<string, VenueLevelId>();
  /**
   * Enclosed rooms guests can go to (a room, a hall, a restroom; not a corridor, lobby or open
   * floor): a door's `beyond` names only these (the browser has their ids already).
   */
  const innerRooms = new Set<string>();
  for (const l of data.levels) {
    for (const r of l.rooms) {
      levelOfRoom.set(r.id, l.id);
      if (r.public && !r.closed && r.entry && INNER_KINDS.has(r.kind)) innerRooms.add(r.id);
      for (const d of r.doors ?? []) doorById.set(d.id, d);
    }
  }
  const at_ = (id: string) => doorById.get(id)?.at;
  const points = (ids: readonly string[]) => [...new Set(ids)].sort().flatMap((id) => (at_(id) ? [at_(id)!] : []));

  // Door rules per room and direction: the doors every applicable rule allows (null = any).
  type Allowed = Set<string> | null;
  const narrow = (a: Allowed, list: readonly string[] | undefined): Allowed =>
    list === undefined ? a : a === null ? new Set(list) : new Set([...a].filter((d) => list.includes(d)));
  const allowedFor = (room: string, dir: "exits" | "entries", t: VenueFlowTrack[]): Allowed => {
    let a: Allowed = null;
    for (const r of live) if (r.kind === "doors" && r.room === room && t.includes(r.track)) a = narrow(a, r[dir]);
    return a;
  };
  const doorRooms = [...new Set(live.flatMap((r) => (r.kind === "doors" ? [r.room] : [])))].sort();
  const doors: RouteRules["doors"] = [];
  for (const room of doorRooms) {
    const entry: RouteRules["doors"][number] = { room };
    const allowedBy: Partial<Record<"exits" | "entries", Set<string>>> = {};
    for (const dir of ["exits", "entries"] as const) {
      let allowed: Allowed;
      if (track) allowed = allowedFor(room, dir, ["ALL", track]);
      else {
        // No gender on file: everyone's rule, and of the tracks' rules either track's doors.
        const shared = allowedFor(room, dir, ["ALL"]);
        const bhaio = allowedFor(room, dir, ["BHAIO"]);
        const behno = allowedFor(room, dir, ["BEHNO"]);
        const either: Allowed = bhaio === null || behno === null ? null : new Set([...bhaio, ...behno]);
        allowed = either === null ? shared : narrow(shared, [...either]);
      }
      if (allowed !== null) {
        entry[dir] = points([...allowed]);
        allowedBy[dir] = allowed;
      }
    }
    if (!entry.exits && !entry.entries) continue;
    // The doors it rules out that open straight into another enclosed room guests can go to, which
    // no door it allows leads into (the Main Hall's cry room): a trip between the two rooms uses
    // them freely. A door into a corridor, a foyer or open floor stays ruled out for every trip.
    const own = [...doorById.values()].filter((d) => d.id.startsWith(`${room}:`));
    const ruledOut = (id: string) =>
      (allowedBy.exits !== undefined && !allowedBy.exits.has(id)) || (allowedBy.entries !== undefined && !allowedBy.entries.has(id));
    const reachedAllowed = new Set(own.filter((d) => !ruledOut(d.id) && d.to).map((d) => d.to!));
    const beyond = own
      .filter((d) => d.to !== null && d.to !== room && innerRooms.has(d.to) && !reachedAllowed.has(d.to) && ruledOut(d.id))
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((d) => ({ at: d.at, room: d.to! }));
    doors.push(beyond.length > 0 ? { ...entry, beyond } : entry);
  }

  const sorted = (xs: Iterable<string>) => [...new Set(xs)].sort();
  const stairs = mine
    .flatMap((r) => (r.kind === "stairs" ? [{ rooms: sorted(r.rooms), connectors: sorted(r.connectors) }] : []))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const avoid = sorted(mine.flatMap((r) => (r.kind === "avoid" ? r.rooms : [])));
  const passage = sorted(mine.flatMap((r) => (r.kind === "passage" ? r.rooms : [])));
  const side = sorted(mine.flatMap((r) => (r.kind === "side" ? r.connectors : [])));
  const waypoint = (w: VenueWaypoint): RouteWaypoint | null => {
    if ("door" in w) {
      const d = doorById.get(w.door);
      const level = levelOfRoom.get(w.door.split(":")[0]);
      return d && level ? { level, point: d.at } : null;
    }
    if ("connector" in w) return { connector: w.connector, from: w.from, to: w.to };
    return { level: w.level, point: w.point };
  };
  const routes = mine
    .flatMap((r) => {
      if (r.kind !== "route") return [];
      const via = r.via.map(waypoint);
      return via.every(Boolean) ? [{ from: r.from, to: r.to, via: via as RouteWaypoint[] }] : [];
    })
    .sort((a, b) => `${a.from}>${a.to}`.localeCompare(`${b.from}>${b.to}`));
  if (doors.length + stairs.length + avoid.length + passage.length + side.length + routes.length === 0) return null;
  const body = { doors, stairs, avoid, passage, side, routes };
  return { key: hashOf(body), ...body };
}

/** The distinct windows of the rules, for checks that try every time the rules can differ at. */
export function flowWindows(rules: readonly VenueFlowRule[] | null | undefined): VenueFlowWindow[] {
  const out = new Map<string, VenueFlowWindow>();
  for (const r of rules ?? []) if (r.window) out.set(`${r.window.day} ${r.window.from}-${r.window.to}`, r.window);
  return [...out.values()].sort((a, b) => `${a.day}${a.from}`.localeCompare(`${b.day}${b.from}`));
}

/**
 * The next instant after `after` at which the rules in force for a viewer of `track` change (a
 * window of one of their rules opens or closes; null track = any rule's), or null when none does.
 * /map and /sant/map refresh then, so an open map never keeps rules that have stopped applying.
 * `parse` turns "YYYY-MM-DDTHH:MM" Eastern wall clock into an instant (time.ts parseInEventTz()).
 */
export function nextRuleChange(
  rules: readonly VenueFlowRule[] | null | undefined,
  after: Date,
  track: VenueTrack | null,
  parse: (local: string) => Date | null,
): Date | null {
  let best: Date | null = null;
  for (const r of rules ?? []) {
    if (!r.window || (track && r.track !== "ALL" && r.track !== track)) continue;
    for (const hm of [r.window.from, r.window.to]) {
      const t = parse(`${r.window.day}T${hm}`);
      if (t && t.getTime() > after.getTime() && (!best || t.getTime() < best.getTime())) best = t;
    }
  }
  return best;
}

/** Every door id the rules name (a doors rule's exits / entries, a route rule's door waypoints), with the rule ids naming it. */
export function doorsNamed(rules: readonly VenueFlowRule[] | null | undefined): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const add = (door: string, rule: string) => out.set(door, [...new Set([...(out.get(door) ?? []), rule])]);
  for (const r of rules ?? []) {
    if (r.kind === "doors") for (const d of [...(r.exits ?? []), ...(r.entries ?? [])]) add(d, r.id);
    if (r.kind === "route") for (const w of r.via) if ("door" in w) add(w.door, r.id);
  }
  return out;
}
