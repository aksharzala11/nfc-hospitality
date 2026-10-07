/**
 * Walking directions over the venue map's walkable grids. Pure (no DOM, no server): runs in the
 * browser on the grids toClientVenue() sends.
 *
 * One A* search over every level at once: a node is (level, cell); within a level it moves to the
 * 8 neighbours (a diagonal only when both cells beside it are open, so it never cuts a wall's
 * corner), and a stair / elevator joins its landing cells on the levels it serves. Costs are map
 * units walked, a little more beside walls (so routes keep to the middle of corridors), plus a
 * fixed cost per storey climbed (see LEVEL_COST; storeys are the levels' `order`: B 0, 1 1, 2 2,
 * and the mezzanine 3, the top floor), plus:
 *  - through rooms: walking inside a room, hall or shop that is neither the start nor the
 *    destination costs THROUGH_ROOM times more, so routes keep to corridors, lobbies and open
 *    floor instead of cutting across the mandir or a gym (only when the levels carry `rooms`);
 *  - restrooms: never a way through. A restroom with two doors (the blueprint draws some) is not
 *    a short cut between two corridors: its cells cost THROUGH_RESTROOM times more, more than any
 *    way round, so a route crosses one only when nothing else gets there at all (and never
 *    becomes "no way" because of it). A route that starts or ends in the restroom walks in it as
 *    in any room;
 *  - overshoot: a stair / elevator to a level outside the start's and destination's storeys costs
 *    LEVEL_COST.overshoot more, so the first floor -> mezzanine goes up by way of the second floor
 *    (inside the span), not down to the basement for a shaft that runs from there.
 * Sides: a guest routes only over the stairs (and, while ELEVATORS_FOLLOW_SIDE, elevators) on
 * their track's side of the building, TRACK_SIDE (Bhaio right, Behno left; organisers,
 * 2026-09-30); a connector without a `side`, or a guest without a track, is unrestricted. When
 * only the other side's connectors would get there, route() says so ("side") and never routes
 * through them.
 * Staff-only rooms (`closed`, organisers 2026-10-01) are never walked through, started from or
 * ended in: the extraction leaves them no walkable cells, and should a stored grid have some, the
 * router blocks every cell inside a closed room's outline itself (blockClosed()).
 * The destination may be a room's outline (`area`): the route then ends at the first walkable cell
 * inside it, through whichever door is nearest, not at one fixed entry point.
 * The heuristic is the octile distance (to the destination's box) in the shared map frame, which
 * stays admissible across levels because a connector never costs less than the distance between
 * its own landings and every penalty only adds cost. The cell path is then smoothed (line of
 * sight, keeping off the walls except where the path itself has to squeeze through, e.g. a door).
 *
 * `stepFree` uses elevators only (of the guest's side). Without it the route takes stairs only
 * whenever the guest's side's stairs get there (never a flight of stairs and then an elevator for
 * the next floor), and stairs and elevators together only when they don't (see ClimbMode).
 * Decoded grids are memoised per level grid.
 *
 * The Pujya Santo payload (toSantClientVenue(): a level's `guestGrid`, connectors' `santPoints`)
 * gets two searches: one over exactly what every other viewer gets (the guest grids, the public
 * rooms, the connectors' shared landings), used for every trip that neither starts nor ends in the
 * sadhus' residence, so such a trip is the delegates' route exactly; and one over the santos' floor
 * for trips that do, on which a sadhu's own room (ClientRoom.sant "own") that is neither end costs
 * THROUGH_QUARTERS more, so it is never a way through unless nothing else gets there. Santos'
 * browsers build both (about twice the memory and time of one).
 *
 * Flow rules (RouteOptions.rules: flowRules.ts routeRulesFor(), the organisers' flow maps, already
 * narrowed to the viewer's track and the time) are costs, never walls, so a route that can't do
 * otherwise still goes another way and the failure reasons above stay true:
 *  - doors: leaving a room by a door its rule doesn't allow, or entering it by one, costs
 *    RULE_PENALTY (a move from a cell inside the room to one of that door's cells, or back), except
 *    a door that opens straight into the trip's other end (RouteRules.doors `beyond`: the Main Hall
 *    to its cry room); a trip started at a room's door (RouteEnd.fromDoors, not a hall's middle)
 *    starts at its allowed exits;
 *  - stairs: a climb arriving on the destination's floor (or leaving the start's) by another
 *    stair / elevator than the rule's costs RULE_PENALTY;
 *  - avoid: stepping into such a room from outside it (or arriving in it by a stair / elevator)
 *    costs RULE_PENALTY, once per entry, unless the trip starts or ends in it or in a room that
 *    opens onto it (it is avoided on the way elsewhere); its cells cost what they always do, so a
 *    route that has to cross it takes the short way across, and no other room (the mandir hall, a
 *    shop) becomes a way round it that costs less per step;
 *  - passage: walking in such a room costs nothing extra (and the walk lists it: RouteWalk.through);
 *  - side: those stairs / elevators are usable whatever their side (a climb on one says which side:
 *    RouteClimb.exception; on such a route every climb with a twin of its kind and place on the
 *    other side says its side too, so "the side stairs" is never ambiguous);
 *  - route: a trip between the two rooms (RouteEnd.room) goes by the waypoints, Step-free off.
 * Each set of rules is compiled once per router (by RouteRules.key); the santo router's two searches
 * get the same rules, so a trip outside the residence is still the delegates' (Bhaio) route.
 */
import type {
  VenueConnector,
  VenueGrid,
  VenueLevelId,
  VenuePlace,
  VenuePoint,
  VenueRoomKind,
  VenueSantClass,
  VenueSide,
  VenueTrack,
} from "./types";
import { cellAt, decodeWalkable } from "./validate";
import { connectorLabel, pointInPolygon } from "./view";
import { doorOpenings, openingAt, type RouteRules, type RouteWaypoint } from "./flowRules";

export type RouteLevel = {
  id: VenueLevelId;
  order: number;
  bounds: { x: number; y: number; width: number; height: number };
  grid: VenueGrid;
  /**
   * The Pujya Santo payload only (ClientLevel.guestGrid): the grid everyone else gets; `grid` is
   * then the santos' floor. See the file comment.
   */
  guestGrid?: VenueGrid;
  /**
   * The level's public rooms (a ClientLevel's `rooms` fit), for the through-room cost and to keep
   * out of staff-only (`closed`) ones. Optional: without them every open cell costs the same.
   * `sant`: a room of the sadhus' residence (the Pujya Santo payload only).
   */
  rooms?: ReadonlyArray<{ id?: string; kind: VenueRoomKind; pts: number[]; closed?: boolean; sant?: VenueSantClass }>;
};

export type RouteVenue = { levels: RouteLevel[]; connectors: VenueConnector[] };

/**
 * A place on the map: a room's entry, a connector landing, any walkable point. `area` (a
 * destination room's outline, flat [x0, y0, ...]) lets the route end at the nearest walkable cell
 * inside it instead of at `point`; it is ignored for the start, which is always `point`.
 */
export type RouteEnd = {
  level: VenueLevelId;
  point: VenuePoint;
  area?: number[];
  /** The room this end is in (its map id), for flow rules: a door rule's room, a route rule's ends. */
  room?: string;
  /**
   * The start only: the trip leaves `room` by its door (not from a hall's middle), so with a door
   * rule on its exits it starts at those doors rather than at `point`.
   */
  fromDoors?: boolean;
};

export type RouteWalk = {
  type: "walk";
  level: VenueLevelId;
  points: VenuePoint[];
  distance: number;
  /** Rooms walked through freely on the way (a flow rule's passage, neither end), in order: the steps say "Walk through the X". */
  through?: string[];
};
export type RouteClimb = {
  type: "connector";
  connectorId: string;
  kind: "stair" | "elevator";
  /** "Stairs" / "Elevator" (connectorLabel()): never the blueprint's number. In text use connectorPhrase(). */
  name: string;
  /** Where it is in the building, when the map says: "the foyer stairs" (VenueConnector.place). */
  place?: VenuePlace;
  /**
   * Its side, set only when the guest could take its twin on the other side for it (another
   * connector of the same kind and place that they may use too: a guest with no gender on file,
   * or shared elevators): the steps then say "on the left" / "on the right".
   */
  sideHint?: VenueSide;
  /**
   * Taken although it is on the other side of the guest's track: a flow rule allows it at this time
   * (RouteRules.side, or a route rule's waypoint). `sideHint` then says which side.
   */
  exception?: boolean;
  from: VenueLevelId;
  to: VenueLevelId;
  direction: "up" | "down";
  /** Where it leaves `from` and arrives on `to` (the connector's landings). */
  fromPoint: VenuePoint;
  toPoint: VenuePoint;
};
export type RouteSegment = RouteWalk | RouteClimb;

export type VenueRoute = {
  /** Walks and climbs in order; a walk may be a single point (arriving right at a stair). */
  segments: RouteSegment[];
  /** Levels the route is on, in the order it visits them (no repeats). */
  levels: VenueLevelId[];
  /** Map units walked (smoothed lines; stairs and elevators not counted). */
  distance: number;
  stepFree: boolean;
};

export type RouteOptions = {
  stepFree?: boolean;
  /** The guest's track: only their side's stairs / elevators (connectorUsable()). Null / absent = any. */
  track?: VenueTrack | null;
  /** The flow rules in force for this guest now (flowRules.ts routeRulesFor()); null / absent = none. */
  rules?: RouteRules | null;
};

/** Why there is no route (route() never falls back to the other side's stairs). */
export type RouteFailureReason =
  /** An end isn't on the map: an unknown level, no walkable cell near its point, or a point inside a staff-only room. */
  | "off-map"
  /** No way there with these options for anyone (e.g. step-free and no elevator reaches it). */
  | "no-path"
  /** There is a way, but only over stairs / elevators on the other side: the guest's own don't reach it. */
  | "side";

export type RouteResult =
  | { ok: true; route: VenueRoute }
  | {
      ok: false;
      reason: RouteFailureReason;
      /** Step-free failed, but the stairs on the guest's side do reach it. */
      withStairs: boolean;
    };

/**
 * Which side of the building each track's stairs are on (organisers, 2026-09-30): Bhaio (gents)
 * use only the right-hand stairs of the map, Behno (ladies) only the left-hand ones. A connector's
 * `side` comes from the extraction (scripts/venue/extract.py, overridable there with --side).
 */
export const TRACK_SIDE: Readonly<Record<VenueTrack, VenueSide>> = { BHAIO: "right", BEHNO: "left" };

/**
 * Elevators follow the same split as the stairs. Set false if the organisers say the elevators
 * are shared: every guest may then use every elevator (the stairs stay split).
 */
export const ELEVATORS_FOLLOW_SIDE: boolean = true;

/** Whether a guest of `track` may use this stair / elevator (no track or no side: yes). */
export function connectorUsable(c: Pick<VenueConnector, "kind" | "side">, track: VenueTrack | null | undefined): boolean {
  if (!track || !c.side) return true;
  if (c.kind === "elevator" && !ELEVATORS_FOLLOW_SIDE) return true;
  return c.side === TRACK_SIDE[track];
}

/**
 * The venue track from someone's notification tracks (tracksFor(trackGender(user)) in
 * src/lib/admin/announcements.ts): exactly one of BHAIO / BEHNO, else null (both, i.e. no gender
 * on file: every connector). By gender only, never by role: admins follow their gender too.
 */
export function venueTrackOf(audiences: readonly string[]): VenueTrack | null {
  const bhaio = audiences.includes("BHAIO");
  const behno = audiences.includes("BEHNO");
  return bhaio === behno ? null : bhaio ? "BHAIO" : "BEHNO";
}

/**
 * Cost of changing floors, as a fraction of the building's long side: a flight of stairs costs
 * about a floor's worth of walking (12% of the long side, ~35 ft in a 300 ft building); an
 * elevator costs a wait plus a little per floor. Constant per storey, so which stair a route takes
 * is decided by walking alone.
 * `overshoot`: arriving on a level beyond the storeys the route has to span (see the file comment).
 */
export const LEVEL_COST = { stairPerFloor: 0.12, elevatorWait: 0.25, elevatorPerFloor: 0.03, overshoot: 0.6 } as const;

/**
 * Which stairs / elevators one search may use (always only those connectorUsable() allows):
 * "elevators" = Step-free; "stairs" = the first try without Step-free; "any" = both, the second
 * try without Step-free, only when no route over stairs alone exists (e.g. a side whose stairs
 * don't reach a floor its elevators do).
 */
type ClimbMode = "elevators" | "stairs" | "any";

/** Room kinds that aren't walked through on the way elsewhere (see the file comment). */
const THROUGH_KINDS: ReadonlySet<VenueRoomKind> = new Set(["room", "hall", "dining", "restroom"]);
/** Cost multiplier for a cell inside such a room when it is neither the start nor the destination. */
export const THROUGH_ROOM = 3;
/**
 * The same for a restroom: so much that any other way, however long, is cheaper (a restroom is
 * never a short cut; organisers' plans, 2026-10-01), yet finite, so a room reached only through
 * one still gets a route.
 */
export const THROUGH_RESTROOM = 1000;
/**
 * The same for a sadhu's own room (the Pujya Santo payload): never a way through on someone else's
 * trip unless nothing else gets there (finite, so a room reached only through another still gets a
 * route).
 */
export const THROUGH_QUARTERS = THROUGH_RESTROOM;
/**
 * What a door or stair a flow rule rules out costs, as a share of the building's long side: more
 * than any way round inside the building, yet finite (a cost, not a wall).
 */
export const RULE_PENALTY = 10;

/** Extra cost of walking in a cell beside a wall (clearance 1) or one cell off it (clearance 2). */
const WALL_PENALTY = [0, 0.35, 0.1] as const;
/** How far (in cells) a point may be from an open cell and still snap to it. */
const SNAP_CELLS = 8;
const SQRT2 = Math.SQRT2;
const OCT = SQRT2 - 1;

type Decoded = { walk: Uint8Array; clear: Uint8Array };
const decodedCache = new Map<string, Decoded>();
const MAX_DECODED = 12;

/** Open cells, and each one's clearance: 1 = touches a wall, 2 = one cell off, 3 = further. */
function decode(grid: VenueGrid): Decoded {
  const key = `${grid.cols}x${grid.rows}:${grid.walkable}`;
  const hit = decodedCache.get(key);
  if (hit) return hit;
  const walk = decodeWalkable(grid) ?? new Uint8Array(grid.cols * grid.rows);
  const out = { walk, clear: clearanceOf(walk, grid.cols, grid.rows) };
  decodedCache.set(key, out);
  if (decodedCache.size > MAX_DECODED) decodedCache.delete(decodedCache.keys().next().value!);
  return out;
}

/**
 * A level's open cells without those inside a staff-only (`closed`) room's outline. The extraction
 * leaves such rooms no walkable cells, so this normally returns `d` as it is; a stored grid that
 * has some gets a copy with them blocked (the cached decode is shared, never changed).
 */
function blockClosed(level: RouteLevel, d: Decoded): Decoded {
  const closed = (level.rooms ?? []).filter((r) => r.closed && r.pts.length >= 6);
  if (closed.length === 0) return d;
  const { cols, rows, cell, origin } = level.grid;
  let walk: Uint8Array | null = null;
  for (const room of closed) {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (let i = 0; i < room.pts.length; i += 2) {
      x0 = Math.min(x0, room.pts[i]);
      x1 = Math.max(x1, room.pts[i]);
      y0 = Math.min(y0, room.pts[i + 1]);
      y1 = Math.max(y1, room.pts[i + 1]);
    }
    const c0 = Math.max(0, Math.floor((x0 - origin[0]) / cell));
    const c1 = Math.min(cols - 1, Math.floor((x1 - origin[0]) / cell));
    const r0 = Math.max(0, Math.floor((y0 - origin[1]) / cell));
    const r1 = Math.min(rows - 1, Math.floor((y1 - origin[1]) / cell));
    for (let r = r0; r <= r1; r++) {
      const y = origin[1] + (r + 0.5) * cell;
      for (let c = c0; c <= c1; c++) {
        const i = r * cols + c;
        if (!(walk ?? d.walk)[i] || !pointInPolygon(room.pts, origin[0] + (c + 0.5) * cell, y)) continue;
        walk ??= d.walk.slice();
        walk[i] = 0;
      }
    }
  }
  return walk ? { walk, clear: clearanceOf(walk, cols, rows) } : d;
}

/** Each open cell's clearance: 1 = touches a wall, 2 = one cell off, 3 = further (0 = not open). */
function clearanceOf(walk: Uint8Array, cols: number, rows: number): Uint8Array {
  const clear = new Uint8Array(cols * rows);
  const queue = new Int32Array(cols * rows);
  let head = 0;
  let tail = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (!walk[i]) continue;
      let edge = r === 0 || c === 0 || r === rows - 1 || c === cols - 1;
      for (let dr = -1; dr <= 1 && !edge; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if ((dr || dc) && !walk[(r + dr) * cols + (c + dc)]) {
            edge = true;
            break;
          }
        }
      }
      if (edge) {
        clear[i] = 1;
        queue[tail++] = i;
      }
    }
  }
  while (head < tail) {
    const i = queue[head++];
    const d = clear[i];
    if (d >= 3) continue;
    const r = (i / cols) | 0;
    const c = i - r * cols;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const rr = r + dr;
        const cc = c + dc;
        if ((!dr && !dc) || rr < 0 || cc < 0 || rr >= rows || cc >= cols) continue;
        const j = rr * cols + cc;
        if (walk[j] && clear[j] === 0) {
          clear[j] = d + 1;
          queue[tail++] = j;
        }
      }
    }
  }
  for (let i = 0; i < clear.length; i++) if (walk[i] && clear[i] === 0) clear[i] = 3;
  return clear;
}

type Lvl = RouteLevel & Decoded & { offset: number; n: number; storey: number };
type Edge = { to: number; cost: number; connector: number };

/** A binary min-heap of node ids by priority. */
class Heap {
  private ids = new Int32Array(1024);
  private pri = new Float64Array(1024);
  size = 0;
  clear() {
    this.size = 0;
  }
  push(id: number, p: number) {
    if (this.size === this.ids.length) {
      const ids = new Int32Array(this.size * 2);
      ids.set(this.ids);
      this.ids = ids;
      const pri = new Float64Array(this.size * 2);
      pri.set(this.pri);
      this.pri = pri;
    }
    let i = this.size++;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.pri[parent] <= p) break;
      this.ids[i] = this.ids[parent];
      this.pri[i] = this.pri[parent];
      i = parent;
    }
    this.ids[i] = id;
    this.pri[i] = p;
  }
  pop(): number {
    const top = this.ids[0];
    const lastId = this.ids[--this.size];
    const lastP = this.pri[this.size];
    let i = 0;
    for (;;) {
      let child = 2 * i + 1;
      if (child >= this.size) break;
      if (child + 1 < this.size && this.pri[child + 1] < this.pri[child]) child++;
      if (this.pri[child] >= lastP) break;
      this.ids[i] = this.ids[child];
      this.pri[i] = this.pri[child];
      i = child;
    }
    this.ids[i] = lastId;
    this.pri[i] = lastP;
    return top;
  }
}

const octile = (dx: number, dy: number) => {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  return ax > ay ? ax + OCT * ay : ay + OCT * ax;
};
const dist = (a: VenuePoint, b: VenuePoint) => Math.hypot(a[0] - b[0], a[1] - b[1]);

export type VenueRouter = {
  /** A route, or why there is none (see RouteResult). */
  route(from: RouteEnd, to: RouteEnd, options?: RouteOptions): RouteResult;
  /** The nearest open point to `p` on `level` (null when there's none within reach). */
  snap(end: RouteEnd): VenuePoint | null;
};

/**
 * A router for one venue; keep it (useMemo) while the venue is the same. With the Pujya Santo
 * payload's extras (a level's `guestGrid`, a connector's `santPoints`) it is two searches (see the
 * file comment); otherwise one, as for everyone else.
 */
export function createVenueRouter(venue: RouteVenue): VenueRouter {
  const santo =
    venue.levels.some((l) => l.guestGrid) || venue.connectors.some((c) => c.santPoints && Object.keys(c.santPoints).length > 0);
  if (!santo) return createGridRouter(venue);
  const full = createGridRouter(venue);
  // Exactly what every other viewer's router gets (toClientVenue()): their grids, the public rooms
  // in the same order, the connectors' shared landings in the same order.
  const base = createGridRouter({
    levels: venue.levels.map((l) => ({
      id: l.id,
      order: l.order,
      bounds: l.bounds,
      grid: l.guestGrid ?? l.grid,
      ...(l.rooms ? { rooms: l.rooms.filter((r) => !r.sant) } : {}),
    })),
    connectors: venue.connectors.map(({ santPoints, ...c }) => ({
      ...c,
      points: Object.fromEntries(Object.entries(c.points).filter(([lvl]) => !santPoints?.[lvl as VenueLevelId])),
    })),
  });
  // A trip's end is in the residence when it lies in one of its rooms santos are shown, or (in no
  // public room) on floor only santos walk.
  const ends = venue.levels.map((l) => {
    const guest = l.guestGrid;
    const sameFrame =
      guest &&
      guest.cell === l.grid.cell &&
      guest.cols === l.grid.cols &&
      guest.rows === l.grid.rows &&
      guest.origin[0] === l.grid.origin[0] &&
      guest.origin[1] === l.grid.origin[1];
    return {
      id: l.id,
      grid: l.grid,
      santo: sameFrame ? decodeWalkable(l.grid) : null,
      guest: sameFrame ? decodeWalkable(guest) : null,
      santRooms: (l.rooms ?? []).filter((r) => r.sant && r.pts.length >= 6),
      otherRooms: (l.rooms ?? []).filter((r) => !r.sant && r.pts.length >= 6),
    };
  });
  const inResidence = (end: RouteEnd): boolean => {
    const e = ends.find((x) => x.id === end.level);
    if (!e) return false;
    const [x, y] = end.point;
    if (e.santRooms.some((r) => pointInPolygon(r.pts, x, y))) return true;
    if (!e.santo || !e.guest || e.otherRooms.some((r) => pointInPolygon(r.pts, x, y))) return false;
    const cell = cellAt(e.grid, end.point);
    if (!cell) return false;
    const i = cell.r * e.grid.cols + cell.c;
    return e.santo[i] === 1 && e.guest[i] !== 1;
  };
  return {
    route: (from, to, options) => (inResidence(from) || inResidence(to) ? full : base).route(from, to, options),
    snap: (end) => (inResidence(end) ? full : base).snap(end),
  };
}

/** One search over a venue's grids (createVenueRouter()). */
function createGridRouter(venue: RouteVenue): VenueRouter {
  let offset = 0;
  const levels: Lvl[] = venue.levels.map((l) => {
    const d = blockClosed(l, decode(l.grid));
    const n = l.grid.cols * l.grid.rows;
    // Storeys climbed = difference in `order` (B 0, 1 1, 2 2, M 3: the mezzanine is on top).
    const lvl = { ...l, ...d, offset, n, storey: l.order };
    offset += n;
    return lvl;
  });
  const total = offset;
  const byId = new Map(levels.map((l, i) => [l.id, i]));
  const longSide = Math.max(1, ...levels.map((l) => Math.max(l.bounds.width, l.bounds.height)));
  const connectorIndex = new Map(venue.connectors.map((c, i) => [c.id, i]));

  // Scratch buffers, reused by every search (a stamp marks which entries belong to this search).
  const g = new Float64Array(total);
  const parent = new Int32Array(total);
  const via = new Int16Array(total);
  const stamp = new Uint32Array(total);
  const closed = new Uint32Array(total);
  const goalStamp = new Uint32Array(total);
  let gen = 0;
  const heap = new Heap();

  const levelOfNode = (node: number) => {
    for (let i = levels.length - 1; i >= 0; i--) if (node >= levels[i].offset) return i;
    return 0;
  };
  const center = (li: number, cell: number): VenuePoint => {
    const l = levels[li];
    const r = (cell / l.grid.cols) | 0;
    const c = cell - r * l.grid.cols;
    return [l.grid.origin[0] + (c + 0.5) * l.grid.cell, l.grid.origin[1] + (r + 0.5) * l.grid.cell];
  };

  /** The open cells of level `li` whose centres lie inside an outline (flat points). */
  function cellsIn(li: number, pts: number[]): number[] {
    const l = levels[li];
    const { cols, rows, cell, origin } = l.grid;
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
    const out: number[] = [];
    for (let r = r0; r <= r1; r++) {
      const y = origin[1] + (r + 0.5) * cell;
      for (let c = c0; c <= c1; c++) {
        const i = r * cols + c;
        if (l.walk[i] && pointInPolygon(pts, origin[0] + (c + 0.5) * cell, y)) out.push(i);
      }
    }
    return out;
  }

  // Through-room cells: node -> 1 + the index of the room (THROUGH_KINDS) it lies in, 0 = none;
  // and what crossing that room costs (index 0 = no room). A sadhu's own room (the Pujya Santo
  // payload) costs THROUGH_QUARTERS, the residence's ways nothing extra.
  const roomAt = new Int32Array(total);
  const crossCost: number[] = [1];
  let roomCount = 0;
  levels.forEach((l, li) => {
    for (const r of l.rooms ?? []) {
      if (r.closed || r.pts.length < 6) continue;
      const cost =
        r.sant === "own"
          ? THROUGH_QUARTERS
          : r.sant === "way"
            ? 0
            : !THROUGH_KINDS.has(r.kind)
              ? 0
              : r.kind === "restroom"
                ? THROUGH_RESTROOM
                : THROUGH_ROOM;
      if (!cost) continue;
      const id = ++roomCount;
      crossCost[id] = cost;
      for (const cell of cellsIn(li, r.pts)) if (!roomAt[l.offset + cell]) roomAt[l.offset + cell] = id;
    }
  });
  // Staff-only rooms: a route never starts or ends at a point inside one (their cells are blocked
  // too, so none crosses one either).
  const closedRooms = levels.map((l) => (l.rooms ?? []).filter((r) => r.closed && r.pts.length >= 6));
  const inClosed = (li: number, p: VenuePoint) => closedRooms[li].some((r) => pointInPolygon(r.pts, p[0], p[1]));
  // Rooms by map id (flow rules name them).
  const roomById = new Map<string, { li: number; pts: number[] }>();
  levels.forEach((l, li) => {
    for (const r of l.rooms ?? []) if (r.id && !r.closed && r.pts.length >= 6 && !roomById.has(r.id)) roomById.set(r.id, { li, pts: r.pts });
  });

  // ---- Flow rules, compiled once per set (RouteRules.key) -----------------------------------
  type RuleRoom = { id: string; li: number; avoid: boolean; passage: boolean; inside: number[] };
  type RingCell = { room: number; exitBad: boolean; entryBad: boolean; beyond: string | null };
  type Compiled = {
    rooms: RuleRoom[];
    index: Map<string, number>;
    /** node -> 1 + index into `rooms` (the first rule room holding the cell), 0 = none. */
    ruleRoom: Int32Array;
    /** node -> 1 + index into `rooms` of a room with a door rule holding the cell, 0 = none. */
    doorRoom: Int32Array;
    /**
     * node -> the door-rule rooms whose openings it is in, whether leaving / entering by it is ruled
     * out, and the room (map id) that opening leads straight into when a rule names one (`beyond`).
     */
    ring: Map<number, RingCell[]>;
    /** Cells of ruled-out openings (smoothing keeps off them unless the path uses them). */
    badRing: Set<number>;
    /** room index -> its cells beside its allowed exits (where a trip from its door starts). */
    exitStarts: Map<number, number[]>;
    stairs: { rooms: Set<number>; allowed: Set<number> }[];
    side: Set<string>;
    sideKey: string;
    hasPassage: boolean;
    /** avoid room index -> its openings' cells and the cells beside them (what a room opening onto it touches). */
    avoidNear: Map<number, Set<number>>;
    /** Some rule room is avoided (RouteRules.avoid). */
    hasAvoid: boolean;
    /** `${avoid room index}|${room id}` -> that room opens onto the avoided room. */
    opensOnto: Map<string, boolean>;
    routes: Map<string, RouteWaypoint[]>;
  };
  const compiledCache = new Map<string, Compiled>();
  const MAX_COMPILED = 16;

  function compile(rules: RouteRules): Compiled {
    const hit = compiledCache.get(rules.key);
    if (hit) return hit;
    const rooms: RuleRoom[] = [];
    const index = new Map<string, number>();
    const ruleRoom = new Int32Array(total);
    const doorRoom = new Int32Array(total);
    const add = (id: string): number => {
      const known = index.get(id);
      if (known !== undefined) return known;
      const r = roomById.get(id);
      if (!r) return -1;
      const k = rooms.length;
      const l = levels[r.li];
      const inside = cellsIn(r.li, r.pts).map((c) => l.offset + c);
      rooms.push({ id, li: r.li, avoid: false, passage: false, inside });
      index.set(id, k);
      for (const node of inside) if (!ruleRoom[node]) ruleRoom[node] = k + 1;
      return k;
    };
    for (const id of rules.avoid) {
      const k = add(id);
      if (k >= 0) rooms[k].avoid = true;
    }
    for (const id of rules.passage) {
      const k = add(id);
      if (k >= 0) rooms[k].passage = true;
    }
    const stairs = rules.stairs.map((s) => ({
      rooms: new Set(s.rooms.map(add).filter((k) => k >= 0)),
      allowed: new Set(s.connectors.flatMap((c) => (connectorIndex.has(c) ? [connectorIndex.get(c)!] : []))),
    }));
    for (const rt of rules.routes) {
      add(rt.from);
      add(rt.to);
    }
    const ring = new Map<number, RingCell[]>();
    const badRing = new Set<number>();
    const exitStarts = new Map<number, number[]>();
    for (const d of rules.doors) {
      const k = add(d.room);
      if (k < 0) continue;
      const room = rooms[k];
      const l = levels[room.li];
      const { openings } = doorOpenings(l.walk, l.grid, roomById.get(d.room)!.pts);
      const allowedOf = (pts: VenuePoint[] | undefined) =>
        pts ? new Set(pts.map((p) => openingAt(openings, l.grid, p)).filter((o) => o >= 0)) : null;
      const exits = allowedOf(d.exits);
      const entries = allowedOf(d.entries);
      // The room a ruled-out opening leads straight into (the trip between the two uses it).
      const beyondOf = new Map<number, string>();
      for (const b of d.beyond ?? []) {
        const oi = openingAt(openings, l.grid, b.at);
        if (oi >= 0 && !beyondOf.has(oi)) beyondOf.set(oi, b.room);
      }
      for (const node of room.inside) if (!doorRoom[node]) doorRoom[node] = k + 1;
      openings.forEach((o, oi) => {
        const exitBad = exits !== null && !exits.has(oi);
        const entryBad = entries !== null && !entries.has(oi);
        const beyond = beyondOf.get(oi) ?? null;
        for (const cell of o.cells) {
          const node = l.offset + cell;
          const list = ring.get(node) ?? [];
          list.push({ room: k, exitBad, entryBad, beyond });
          ring.set(node, list);
          if (exitBad || entryBad) badRing.add(node);
        }
      });
      if (exits && exits.size > 0) {
        // Its cells beside the allowed exits: where a trip that leaves by a door starts.
        const near = new Set<number>();
        for (const oi of exits) for (const cell of openings[oi].cells) near.add(cell);
        const { cols, rows } = l.grid;
        const starts = room.inside.filter((node) => {
          const cell = node - l.offset;
          const r = (cell / cols) | 0;
          const c = cell - r * cols;
          for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
              const rr = r + dr;
              const cc = c + dc;
              if ((dr || dc) && rr >= 0 && cc >= 0 && rr < rows && cc < cols && near.has(rr * cols + cc)) return true;
            }
          }
          return false;
        });
        if (starts.length > 0) exitStarts.set(k, starts);
      }
    }
    // Each avoided room's openings and the cells beside them: a trip from or to a room that opens onto
    // it goes through it (it is avoided only on the way elsewhere).
    const avoidNear = new Map<number, Set<number>>();
    rooms.forEach((room, k) => {
      if (!room.avoid) return;
      const l = levels[room.li];
      const { cols, rows } = l.grid;
      const near = new Set<number>();
      for (const o of doorOpenings(l.walk, l.grid, roomById.get(room.id)!.pts).openings) {
        for (const cell of o.cells) {
          const r = (cell / cols) | 0;
          const c = cell - r * cols;
          for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
              const rr = r + dr;
              const cc = c + dc;
              if (rr >= 0 && cc >= 0 && rr < rows && cc < cols) near.add(l.offset + rr * cols + cc);
            }
          }
        }
      }
      avoidNear.set(k, near);
    });
    const side = new Set(rules.side.filter((c) => connectorIndex.has(c)));
    const out: Compiled = {
      rooms,
      index,
      ruleRoom,
      doorRoom,
      ring,
      badRing,
      exitStarts,
      stairs,
      side,
      sideKey: [...side].sort().join(","),
      hasPassage: rooms.some((r) => r.passage),
      avoidNear,
      hasAvoid: rooms.some((r) => r.avoid),
      opensOnto: new Map(),
      routes: new Map(rules.routes.map((r) => [`${r.from}>${r.to}`, r.via])),
    };
    compiledCache.set(rules.key, out);
    if (compiledCache.size > MAX_COMPILED) compiledCache.delete(compiledCache.keys().next().value!);
    return out;
  }

  // ---- Per search: the rules in force and what this trip is exempt from ----------------------
  /** Rooms this route may cross at the normal cost (its start and destination), by room id. */
  const exempt = new Uint8Array(roomCount + 1);
  let active: Compiled | null = null;
  /** Rule rooms this route starts or ends in (index + 1): exempt from `avoid`, not "walked through". */
  let ruleEnds = new Set<number>();
  /** The rooms (map ids) this trip starts and ends in (RouteEnd.room): a ruled-out door straight into the other is used freely. */
  let tripFrom: string | null = null;
  let tripTo: string | null = null;
  const throughCost = (node: number) => {
    if (active) {
      const rr = active.ruleRoom[node];
      if (rr && active.rooms[rr - 1].passage) return 1;
    }
    const ri = roomAt[node];
    return ri !== 0 && exempt[ri] === 0 ? crossCost[ri] : 1;
  };
  /** A cell of a room this trip avoids (RouteRules.avoid, not one of its ends). */
  const avoidedAt = (node: number): boolean => {
    const c = active;
    if (!c || !c.hasAvoid) return false;
    const rr = c.ruleRoom[node];
    return rr !== 0 && c.rooms[rr - 1].avoid && !ruleEnds.has(rr);
  };
  /** A move from u into an avoided room from outside it: the penalty (once per entry), else 0. */
  const avoidCost = (u: number, v: number): number =>
    avoidedAt(v) && active!.ruleRoom[u] !== active!.ruleRoom[v] ? RULE_PENALTY * longSide : 0;
  /**
   * A move from u to v that leaves or enters a door-rule room by a door it rules out: the penalty,
   * else 0. Not for a door that leads straight into the trip's other end (its `beyond`).
   */
  const doorCost = (u: number, v: number): number => {
    const c = active!;
    const a = c.doorRoom[u];
    const b = c.doorRoom[v];
    if (a === b) return 0;
    let cost = 0;
    if (a) {
      const k = a - 1;
      const at = c.ring.get(v)?.find((x) => x.room === k);
      if (at?.exitBad && !(at.beyond !== null && at.beyond === tripTo)) cost += RULE_PENALTY * longSide;
    }
    if (b) {
      const k = b - 1;
      const at = c.ring.get(u)?.find((x) => x.room === k);
      if (at?.entryBad && !(at.beyond !== null && at.beyond === tripFrom)) cost += RULE_PENALTY * longSide;
    }
    return cost;
  };

  /** The open cell nearest to `p` within SNAP_CELLS, or -1. */
  function snapCell(li: number, p: VenuePoint): number {
    const l = levels[li];
    const { cols, rows, cell, origin } = l.grid;
    const c0 = Math.floor((p[0] - origin[0]) / cell);
    const r0 = Math.floor((p[1] - origin[1]) / cell);
    let best = -1;
    let bestD = Infinity;
    for (let rad = 0; rad <= SNAP_CELLS; rad++) {
      for (let r = r0 - rad; r <= r0 + rad; r++) {
        for (let c = c0 - rad; c <= c0 + rad; c++) {
          if (Math.max(Math.abs(r - r0), Math.abs(c - c0)) !== rad) continue;
          if (r < 0 || c < 0 || r >= rows || c >= cols || !l.walk[r * cols + c]) continue;
          const q = center(li, r * cols + c);
          const d = dist(q, p);
          if (d < bestD) {
            bestD = d;
            best = r * cols + c;
          }
        }
      }
      // A ring further out can't hold anything nearer than (rad) cells.
      if (best >= 0 && bestD <= rad * cell) break;
    }
    return best;
  }

  // Connector landings (global node ids), per connector per level.
  const landings = venue.connectors.map((c) => {
    const out: { li: number; node: number; point: VenuePoint }[] = [];
    for (const [lid, p] of Object.entries(c.points) as [VenueLevelId, VenuePoint][]) {
      const li = byId.get(lid);
      if (li === undefined || !p) continue;
      const cell = snapCell(li, p);
      if (cell >= 0) out.push({ li, node: levels[li].offset + cell, point: p });
    }
    return out;
  });

  /** Whether a guest of `track` may take connector `c` here: their side's, or one a flow rule allows (`side`). */
  const usableHere = (c: VenueConnector, track: VenueTrack | null, side: ReadonlySet<string> | null) =>
    connectorUsable(c, track) || Boolean(side?.has(c.id));

  function edgesFor(mode: ClimbMode, track: VenueTrack | null, side: ReadonlySet<string> | null): Map<number, Edge[]> {
    const edges = new Map<number, Edge[]>();
    venue.connectors.forEach((c, ci) => {
      if (mode === "elevators" && c.kind !== "elevator") return;
      if (mode === "stairs" && c.kind !== "stair") return;
      if (!usableHere(c, track, side)) return;
      const ls = landings[ci];
      for (const a of ls) {
        for (const b of ls) {
          if (a === b) continue;
          const floors = Math.abs(levels[a.li].storey - levels[b.li].storey);
          const base =
            c.kind === "elevator"
              ? (LEVEL_COST.elevatorWait + LEVEL_COST.elevatorPerFloor * floors) * longSide
              : LEVEL_COST.stairPerFloor * floors * longSide;
          const pa = center(a.li, a.node - levels[a.li].offset);
          const pb = center(b.li, b.node - levels[b.li].offset);
          // Never less than the planar hop, so the octile heuristic stays admissible.
          const cost = Math.max(base, octile(pa[0] - pb[0], pa[1] - pb[1]));
          const list = edges.get(a.node) ?? [];
          list.push({ to: b.node, cost, connector: ci });
          edges.set(a.node, list);
        }
      }
    });
    return edges;
  }
  const edgeCache = new Map<string, Map<number, Edge[]>>();

  /**
   * A stairs rule for one trip: climbs that arrive on the destination's floor (`toLevel`) / leave the
   * start's (`fromLevel`) by any connector but `toAllowed` / `fromAllowed` (null = any) cost the penalty.
   */
  type StairsLimit = { fromLevel: number; fromAllowed: Set<number> | null; toLevel: number; toAllowed: Set<number> | null };

  /**
   * A* from `starts` (one or more cells, all at cost 0) to the nearest of `goals` (all on one level).
   * `span` = the storeys the route has to cover; a connector to a level outside it costs
   * LEVEL_COST.overshoot more.
   */
  function search(
    starts: number[],
    goals: number[],
    mode: ClimbMode,
    track: VenueTrack | null,
    span: [number, number],
    limit: StairsLimit | null,
  ): number[] | null {
    gen = (gen + 1) >>> 0 || 1;
    heap.clear();
    const side = active && active.side.size > 0 ? active.side : null;
    const key = `${mode}:${track ?? "all"}:${side ? active!.sideKey : ""}`;
    const edges = edgeCache.get(key) ?? edgesFor(mode, track, side);
    edgeCache.set(key, edges);
    const gli = levelOfNode(goals[0]);
    let bx0 = Infinity;
    let by0 = Infinity;
    let bx1 = -Infinity;
    let by1 = -Infinity;
    for (const node of goals) {
      goalStamp[node] = gen;
      const p = center(gli, node - levels[gli].offset);
      bx0 = Math.min(bx0, p[0]);
      bx1 = Math.max(bx1, p[0]);
      by0 = Math.min(by0, p[1]);
      by1 = Math.max(by1, p[1]);
    }
    // Octile distance to the goals' box: never more than to the nearest goal.
    const h = (node: number, li: number) => {
      const p = center(li, node - levels[li].offset);
      return octile(Math.max(bx0 - p[0], 0, p[0] - bx1), Math.max(by0 - p[1], 0, p[1] - by1));
    };
    const overshoot = LEVEL_COST.overshoot * longSide;
    const penalty = RULE_PENALTY * longSide;
    const doors = active !== null && active.ring.size > 0;
    const avoids = active !== null && active.hasAvoid;
    for (const s of starts) {
      stamp[s] = gen;
      g[s] = 0;
      parent[s] = -1;
      via[s] = -1;
      heap.push(s, h(s, levelOfNode(s)));
    }

    while (heap.size > 0) {
      const u = heap.pop();
      if (closed[u] === gen) continue;
      closed[u] = gen;
      if (goalStamp[u] === gen) {
        const path: number[] = [];
        for (let v = u; v >= 0; v = parent[v]) path.push(v);
        return path.reverse();
      }
      const li = levelOfNode(u);
      const l = levels[li];
      const { cols, rows, cell: size } = l.grid;
      const cell = u - l.offset;
      const r = (cell / cols) | 0;
      const c = cell - r * cols;
      const gu = g[u];
      for (let dr = -1; dr <= 1; dr++) {
        const rr = r + dr;
        if (rr < 0 || rr >= rows) continue;
        for (let dc = -1; dc <= 1; dc++) {
          if (!dr && !dc) continue;
          const cc = c + dc;
          if (cc < 0 || cc >= cols) continue;
          const j = rr * cols + cc;
          if (!l.walk[j]) continue;
          // No corner cutting: a diagonal needs both cells beside it open.
          if (dr && dc && (!l.walk[r * cols + cc] || !l.walk[rr * cols + c])) continue;
          const v = l.offset + j;
          if (closed[v] === gen) continue;
          let step = (dr && dc ? SQRT2 : 1) * size * (1 + (WALL_PENALTY[l.clear[j]] ?? 0)) * throughCost(v);
          if (doors) step += doorCost(u, v);
          if (avoids) step += avoidCost(u, v);
          const gv = gu + step;
          if (stamp[v] !== gen || gv < g[v]) {
            stamp[v] = gen;
            g[v] = gv;
            parent[v] = u;
            via[v] = -1;
            heap.push(v, gv + h(v, li));
          }
        }
      }
      const out = edges.get(u);
      if (out) {
        for (const e of out) {
          if (closed[e.to] === gen) continue;
          const tli = levelOfNode(e.to);
          const s = levels[tli].storey;
          let gv = gu + e.cost + (s < span[0] - 1e-9 || s > span[1] + 1e-9 ? overshoot : 0);
          // Arriving by a stair / elevator inside an avoided room is entering it.
          if (avoids && avoidedAt(e.to)) gv += penalty;
          if (limit) {
            if (limit.toAllowed && tli === limit.toLevel && !limit.toAllowed.has(e.connector)) gv += penalty;
            if (limit.fromAllowed && li === limit.fromLevel && !limit.fromAllowed.has(e.connector)) gv += penalty;
          }
          if (stamp[e.to] !== gen || gv < g[e.to]) {
            stamp[e.to] = gen;
            g[e.to] = gv;
            parent[e.to] = u;
            via[e.to] = e.connector;
            heap.push(e.to, gv + h(e.to, tli));
          }
        }
      }
    }
    return null;
  }

  /** Line of sight between two cells over cells `ok` allows, never through a wall's corner. */
  function sight(l: Lvl, a: number, b: number, ok: (i: number) => boolean): boolean {
    const cols = l.grid.cols;
    let r = (a / cols) | 0;
    let c = a - r * cols;
    const r1 = (b / cols) | 0;
    const c1 = b - r1 * cols;
    const nx = Math.abs(c1 - c);
    const ny = Math.abs(r1 - r);
    const sx = Math.sign(c1 - c);
    const sy = Math.sign(r1 - r);
    for (let ix = 0, iy = 0; ix < nx || iy < ny; ) {
      const t = (0.5 + ix) * ny - (0.5 + iy) * nx;
      if (t === 0) {
        if (!ok(r * cols + c + sx) || !ok((r + sy) * cols + c)) return false;
        c += sx;
        r += sy;
        ix++;
        iy++;
      } else if (t < 0) {
        c += sx;
        ix++;
      } else {
        r += sy;
        iy++;
      }
      if (!ok(r * cols + c)) return false;
    }
    return true;
  }

  /** Smooths one level's run of cells into a polyline of cell centres. */
  function smooth(li: number, cells: number[]): VenuePoint[] {
    const l = levels[li];
    if (cells.length <= 2) return cells.map((cell) => center(li, cell));
    const onPath = new Set(cells);
    // Keep off the walls, out of rooms the route doesn't cross, out of rooms a flow rule avoids and
    // off doors one rules out, except in cells the path itself had to use (doors, narrow spots).
    const bad = active && active.badRing.size > 0 ? active.badRing : null;
    // An avoided room this run crosses anyway is smoothed like any floor; others are kept out of.
    const crossed = new Set(cells.filter((cell) => avoidedAt(l.offset + cell)).map((cell) => active!.ruleRoom[l.offset + cell]));
    const offLimits = (node: number) => avoidedAt(node) && !crossed.has(active!.ruleRoom[node]);
    const ok = (i: number) =>
      l.walk[i] === 1 &&
      (onPath.has(i) || (l.clear[i] >= 2 && throughCost(l.offset + i) === 1 && !(bad && bad.has(l.offset + i)) && !offLimits(l.offset + i)));
    const kept = [cells[0]];
    let i = 0;
    while (i < cells.length - 1) {
      let j = i + 1;
      while (j + 1 < cells.length && sight(l, cells[i], cells[j + 1], ok)) j++;
      kept.push(cells[j]);
      i = j;
    }
    return kept.map((cell) => center(li, cell));
  }

  /** The passage rooms a run of cells walks through (3 cells or more in one, not its ends' rooms), in order. */
  function passagesOf(run: number[]): string[] | undefined {
    const c = active;
    if (!c || !c.hasPassage) return undefined;
    const out: string[] = [];
    let cur = 0;
    let n = 0;
    const done = () => {
      if (cur && n >= 3 && !ruleEnds.has(cur)) {
        const id = c.rooms[cur - 1].id;
        if (out[out.length - 1] !== id) out.push(id);
      }
    };
    for (const node of run) {
      const rr = c.ruleRoom[node];
      const k = rr && c.rooms[rr - 1].passage ? rr : 0;
      if (k === cur) {
        n++;
        continue;
      }
      done();
      cur = k;
      n = 1;
    }
    done();
    return out.length > 0 ? out : undefined;
  }

  /** One route by the search (no route rule). */
  function routeOne(from: RouteEnd, to: RouteEnd, options: RouteOptions): RouteResult {
    const stepFree = options.stepFree === true;
    const track = options.track ?? null;
    const offMap: RouteResult = { ok: false, reason: "off-map", withStairs: false };
    const fli = byId.get(from.level);
    const tli = byId.get(to.level);
    if (fli === undefined || tli === undefined) return offMap;
    if (inClosed(fli, from.point) || inClosed(tli, to.point)) return offMap;
    const fCell = snapCell(fli, from.point);
    const tCell = snapCell(tli, to.point);
    if (fCell < 0 || tCell < 0) return offMap;
    // A guest who may use both of a pair (the same kind and place on either side) is told which; so
    // is one taking the other side's because a flow rule allows it now.
    const side = active && active.side.size > 0 ? active.side : null;
    const exceptionOf = (c: VenueConnector) => !connectorUsable(c, track);
    const sideHintOf = (c: VenueConnector): VenueSide | undefined =>
      c.side &&
      (exceptionOf(c) ||
        venue.connectors.some(
          (d) => d !== c && d.kind === c.kind && (d.place ?? null) === (c.place ?? null) && d.side && d.side !== c.side && usableHere(d, track, side),
        ))
        ? c.side
        : undefined;
    const startNode = levels[fli].offset + fCell;
    const tOff = levels[tli].offset;
    // The destination: every open cell inside its outline (so the nearest door wins), and the
    // cell at its point in any case.
    const goalCells = to.area && to.area.length >= 6 ? cellsIn(tli, to.area) : [];
    if (!goalCells.includes(tCell)) goalCells.push(tCell);
    const goals = goalCells.map((cell) => tOff + cell);
    exempt.fill(0);
    exempt[roomAt[startNode]] = 1;
    exempt[roomAt[tOff + tCell]] = 1;
    for (const node of goals) exempt[roomAt[node]] = 1;
    exempt[0] = 0;
    // Flow rules: the rule rooms this trip starts / ends in, where it starts, the stairs it climbs by.
    let starts = [startNode];
    let limit: StairsLimit | null = null;
    ruleEnds = new Set<number>();
    tripFrom = from.room ?? null;
    tripTo = to.room ?? null;
    if (active) {
      const c = active;
      const fromK = from.room !== undefined ? c.index.get(from.room) : undefined;
      const toK = to.room !== undefined ? c.index.get(to.room) : undefined;
      const fromR = fromK !== undefined ? fromK + 1 : c.ruleRoom[startNode];
      const toR = toK !== undefined ? toK + 1 : c.ruleRoom[tOff + tCell];
      if (fromR) ruleEnds.add(fromR);
      if (toR) ruleEnds.add(toR);
      if (toK === undefined) for (const node of goals) if (c.ruleRoom[node]) ruleEnds.add(c.ruleRoom[node]);
      // An avoided room the start or destination opens onto is walked through (avoided only on the way elsewhere).
      const opensOnto = (k: number, roomId: string | undefined) => {
        if (!roomId) return false;
        const key = `${k}|${roomId}`;
        const hit = c.opensOnto.get(key);
        if (hit !== undefined) return hit;
        const r = roomById.get(roomId);
        const near = c.avoidNear.get(k)!;
        const yes = Boolean(r && r.li === c.rooms[k].li && cellsIn(r.li, r.pts).some((cell) => near.has(levels[r.li].offset + cell)));
        c.opensOnto.set(key, yes);
        return yes;
      };
      for (const k of c.avoidNear.keys()) {
        if (!ruleEnds.has(k + 1) && (opensOnto(k, from.room) || opensOnto(k, to.room))) ruleEnds.add(k + 1);
      }
      if (from.fromDoors && fromK !== undefined && c.rooms[fromK].li === fli) {
        const s = c.exitStarts.get(fromK);
        if (s && s.length > 0) starts = s;
      }
      const allowedOf = (r: number): Set<number> | null => {
        let out = null as Set<number> | null;
        for (const s of c.stairs) {
          if (!r || !s.rooms.has(r - 1)) continue;
          const prev: Set<number> | null = out;
          out = prev === null ? new Set(s.allowed) : new Set([...prev].filter((x: number) => s.allowed.has(x)));
        }
        return out;
      };
      const fromAllowed = allowedOf(fromR);
      const toAllowed = allowedOf(toR);
      if (fromAllowed || toAllowed) limit = { fromLevel: fli, fromAllowed, toLevel: tli, toAllowed };
    }
    const s0 = levels[fli].storey;
    const s1 = levels[tli].storey;
    const span: [number, number] = [Math.min(s0, s1), Math.max(s0, s1)];
    // Step-free: elevators only. Otherwise stairs only, and elevators as well only when the
    // stairs (of the guest's side) don't get there.
    const path = stepFree
      ? search(starts, goals, "elevators", track, span, limit)
      : search(starts, goals, "stairs", track, span, limit) ?? search(starts, goals, "any", track, span, limit);
    if (!path) {
      // Why: only the other side's stairs / elevators get there, or nothing does. Never routed
      // through the other side; `withStairs` tells a step-free guest their side's stairs would.
      const anySide = track !== null && search(starts, goals, stepFree ? "elevators" : "any", null, span, limit) !== null;
      const withStairs = stepFree && search(starts, goals, "any", track, span, limit) !== null;
      return { ok: false, reason: anySide ? "side" : "no-path", withStairs };
    }
    const goalCell = path[path.length - 1] - tOff;
    const firstCell = path[0] - levels[fli].offset;

    // Split into runs per level, with the connector hops between them.
    const segments: RouteSegment[] = [];
    let run: number[] = [];
    let runLevel = fli;
    const flush = () => {
      const cells = run.map((node) => node - levels[runLevel].offset);
      const pts = smooth(runLevel, cells);
      const through = passagesOf(run);
      segments.push({ type: "walk", level: levels[runLevel].id, points: pts, distance: 0, ...(through ? { through } : {}) });
      run = [];
    };
    for (let k = 0; k < path.length; k++) {
      const node = path[k];
      if (k > 0 && via[node] >= 0) {
        flush();
        const ci = via[node];
        const c = venue.connectors[ci];
        const nli = levelOfNode(node);
        const fromLevel = levels[runLevel];
        const toLevel = levels[nli];
        const sideHint = sideHintOf(c);
        segments.push({
          type: "connector",
          connectorId: c.id,
          kind: c.kind,
          name: connectorLabel(c),
          ...(c.place ? { place: c.place } : {}),
          ...(sideHint ? { sideHint } : {}),
          ...(exceptionOf(c) ? { exception: true } : {}),
          from: fromLevel.id,
          to: toLevel.id,
          direction: toLevel.storey > fromLevel.storey ? "up" : "down",
          fromPoint: c.points[fromLevel.id] ?? center(runLevel, path[k - 1] - fromLevel.offset),
          toPoint: c.points[toLevel.id] ?? center(nli, node - toLevel.offset),
        });
        runLevel = nli;
      }
      run.push(node);
    }
    flush();

    // Exact end points: the given point when it was on an open cell (and, at the end, when the
    // route arrives at that cell), else the cell's centre.
    const first = segments[0] as RouteWalk;
    const last = segments[segments.length - 1] as RouteWalk;
    const exact = (li: number, p: VenuePoint, cell: number) => {
      const l = levels[li];
      const c = Math.floor((p[0] - l.grid.origin[0]) / l.grid.cell);
      const r = Math.floor((p[1] - l.grid.origin[1]) / l.grid.cell);
      return r * l.grid.cols + c === cell ? p : center(li, cell);
    };
    first.points[0] = exact(fli, from.point, firstCell);
    last.points[last.points.length - 1] = goalCell === tCell ? exact(tli, to.point, tCell) : center(tli, goalCell);
    // Connector landings drawn at the connector's own points.
    for (let k = 0; k < segments.length; k++) {
      const s = segments[k];
      if (s.type !== "connector") continue;
      const before = segments[k - 1] as RouteWalk | undefined;
      const after = segments[k + 1] as RouteWalk | undefined;
      if (before && before.points.length > 1) before.points[before.points.length - 1] = s.fromPoint;
      if (after && after.points.length > 1) after.points[0] = s.toPoint;
    }
    return { ok: true, route: finish(segments, stepFree) };
  }

  /** Climbs merged, distances and the levels visited worked out. */
  function finish(segments: RouteSegment[], stepFree: boolean): VenueRoute {
    const storeyOf = (id: VenueLevelId) => levels[byId.get(id)!].storey;
    const merged = mergeClimbs(segments, storeyOf).map((s) => ({ ...s }) as RouteSegment);
    // A route that takes the other side's stairs (a flow rule) names the side of every climb that
    // has a twin of its kind and place on the other side: "the side stairs on the right", never a
    // bare "the side stairs" beside "the back stairs on the left".
    if (merged.some((s) => s.type === "connector" && s.exception)) {
      for (const s of merged) {
        if (s.type !== "connector" || s.sideHint) continue;
        const c = venue.connectors[connectorIndex.get(s.connectorId) ?? -1];
        const twin =
          c?.side &&
          venue.connectors.some((d) => d !== c && d.kind === c.kind && (d.place ?? null) === (c.place ?? null) && d.side && d.side !== c.side);
        if (c?.side && twin) s.sideHint = c.side;
      }
    }
    let distance = 0;
    for (const s of merged) {
      if (s.type !== "walk") continue;
      s.distance = polylineLength(s.points);
      distance += s.distance;
    }
    const seen: VenueLevelId[] = [];
    for (const s of merged) if (s.type === "walk" && !seen.includes(s.level)) seen.push(s.level);
    return { segments: merged, levels: seen, distance, stepFree };
  }

  /**
   * A route rule's trip: from `from` by each waypoint to `to` (each leg by the search, with the
   * rules), the legs joined. Null when a leg finds no way (the trip then goes the usual way).
   */
  function routeVia(from: RouteEnd, to: RouteEnd, waypoints: RouteWaypoint[], options: RouteOptions): RouteResult | null {
    const track = options.track ?? null;
    const segments: RouteSegment[] = [];
    const append = (segs: RouteSegment[]) => {
      for (const s of segs) {
        const prev = segments[segments.length - 1];
        if (s.type === "walk" && prev?.type === "walk" && prev.level === s.level) {
          const pts = s.points.slice(dist(prev.points[prev.points.length - 1], s.points[0]) < 1e-6 ? 1 : 0);
          prev.points.push(...pts);
          const through = [...(prev.through ?? []), ...(s.through ?? [])].filter((id, i, a) => i === 0 || a[i - 1] !== id);
          if (through.length > 0) prev.through = through;
          continue;
        }
        segments.push(s.type === "walk" ? { ...s, points: s.points.slice() } : s);
      }
    };
    let cur: RouteEnd = from;
    for (const w of waypoints) {
      if ("connector" in w) {
        const ci = connectorIndex.get(w.connector);
        const c = ci === undefined ? undefined : venue.connectors[ci];
        const pFrom = c?.points[w.from];
        const pTo = c?.points[w.to];
        if (!c || !pFrom || !pTo || byId.get(w.from) === undefined || byId.get(w.to) === undefined) return null;
        const leg = routeOne(cur, { level: w.from, point: pFrom }, options);
        if (!leg.ok) return null;
        append(leg.route.segments);
        const up = levels[byId.get(w.to)!].storey > levels[byId.get(w.from)!].storey;
        const exception = !connectorUsable(c, track);
        segments.push({
          type: "connector",
          connectorId: c.id,
          kind: c.kind,
          name: connectorLabel(c),
          ...(c.place ? { place: c.place } : {}),
          ...(exception && c.side ? { sideHint: c.side } : {}),
          ...(exception ? { exception: true } : {}),
          from: w.from,
          to: w.to,
          direction: up ? "up" : "down",
          fromPoint: pFrom,
          toPoint: pTo,
        });
        segments.push({ type: "walk", level: w.to, points: [pTo], distance: 0 });
        cur = { level: w.to, point: pTo };
      } else {
        const leg = routeOne(cur, { level: w.level, point: w.point }, options);
        if (!leg.ok) return null;
        append(leg.route.segments);
        cur = { level: w.level, point: w.point };
      }
    }
    const leg = routeOne(cur, to, options);
    if (!leg.ok) return null;
    append(leg.route.segments);
    return { ok: true, route: finish(segments, false) };
  }

  function route(from: RouteEnd, to: RouteEnd, options: RouteOptions = {}): RouteResult {
    active = options.rules ? compile(options.rules) : null;
    try {
      if (active && options.stepFree !== true && from.room && to.room) {
        const waypoints = active.routes.get(`${from.room}>${to.room}`);
        if (waypoints) {
          const r = routeVia(from, to, waypoints, options);
          if (r) return r;
        }
      }
      return routeOne(from, to, options);
    } finally {
      active = null;
      ruleEnds = new Set<number>();
      tripFrom = null;
      tripTo = null;
    }
  }

  function snap(end: RouteEnd): VenuePoint | null {
    const li = byId.get(end.level);
    if (li === undefined) return null;
    const cell = snapCell(li, end.point);
    return cell < 0 ? null : center(li, cell);
  }

  return { route, snap };
}

export function polylineLength(points: VenuePoint[]): number {
  let d = 0;
  for (let i = 1; i < points.length; i++) d += dist(points[i - 1], points[i]);
  return d;
}

/**
 * One climb for one stair or elevator: "B -> 1, (no walking), 1 -> 2" on the same connector
 * becomes "B -> 2".
 */
function mergeClimbs(segments: RouteSegment[], storeyOf: (id: VenueLevelId) => number): RouteSegment[] {
  const out: RouteSegment[] = [];
  for (const s of segments) {
    const prev = out[out.length - 1];
    const prevClimb = out[out.length - 2];
    if (
      s.type === "connector" &&
      prev?.type === "walk" &&
      polylineLength(prev.points) < 1e-6 &&
      prevClimb?.type === "connector" &&
      prevClimb.connectorId === s.connectorId
    ) {
      out.pop();
      if (s.to === prevClimb.from) {
        // Up and straight back down the same shaft: no climb at all.
        out.pop();
        continue;
      }
      const direction = storeyOf(s.to) > storeyOf(prevClimb.from) ? "up" : "down";
      out[out.length - 1] = { ...prevClimb, to: s.to, toPoint: s.toPoint, direction };
      continue;
    }
    out.push(s);
  }
  return out;
}
