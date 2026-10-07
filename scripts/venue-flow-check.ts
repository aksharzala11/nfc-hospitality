/**
 * The flow check: the app's routes against the organisers' flow maps (2026-10-04), flow by flow.
 * Run by `npm run venue:import -- ... --plan --flows <file>` and on its own:
 *
 *   npx tsx --tsconfig scripts/tsconfig.server-only.json scripts/venue-flow-check.ts \
 *     --map "<venue-map.json>" --flows "<flows.json>" [--rules "<flow-rules.json>"] \
 *     [--baseline "<an earlier venue-map.json>"] [--details] [--out "<results.json>"]
 *
 * Both files stay outside the repo (they are derived from the organisers' blueprint and drawings).
 * The flows file holds the organisers' drawn trips, each already matched onto a venue map's
 * walkable grid: per trip its track, day and time, the room it starts in (or, for one drawn start
 * standing for several rooms, the drawn point), the room it ends in, the stairs it takes, and per
 * level the drawn line on the grid. For each trip the app routes as guests get it (src/lib/venue:
 * toClientVenue(), createVenueRouter(), routeStartPoint() + routeBetween(), the trip's track, Step-
 * free off, the flow rules in force at the trip's time: a breakout's start, or the start of what a
 * trip leads to) and the two are compared:
 *  - CONNECTOR: other stairs / elevators (by id and floors, in order);
 *  - DOOR: the same stairs, but it leaves the start room or enters the destination by another door
 *    opening (or one more than 2 m away);
 *  - PATH: the same stairs and doors, but another sequence of rooms / corridors, a door between them
 *    more than 2 m apart, or a stretch of 4 m+ more than 2 m away from the drawing outside open floor
 *    (a lobby, an open area, a room a flow rule makes a passage), the end rooms and the last ~5 m to
 *    a stair the trip takes (LANDING_NEAR: the drawings end their arrows at its wall) not counted;
 *  - MATCH; NO_WALK: the drawing has the group already in the room;
 *  - UNRESOLVED: no app route, or another destination.
 * The printout is counts per class and per group, and the ids of the trips that don't match (with
 * --details: why, by room / door / stair ids and metres; never coordinates). Each trip is routed a
 * second time with the rules in force WALK_LEAD_MIN minutes before its time (what /map shows while
 * guests are on the way), and any trip whose class differs then is listed: a rule's window has to
 * cover the walk, not only the session. --baseline names an
 * earlier map to check without rules: a trip that matched there and doesn't now is a regression.
 * --out writes every trip's result with both routes' geometry to a JSON file outside the repo (for
 * pictures). Pure: no database.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { VenueFlowRule, VenueLevelId, VenueMapData, VenuePoint, VenueRoom, VenueTrack } from "../src/lib/venue/types";
import { decodeWalkable, validateVenueMap } from "../src/lib/venue/validate";
import { toClientVenue } from "../src/lib/venue/clientVenue";
import { createVenueRouter, type RouteResult, type VenueRoute } from "../src/lib/venue/route";
import { routeBetween, routeStartPoint } from "../src/lib/venue/directions";
import { routeRulesFor } from "../src/lib/venue/flowRules";
import { pointInPolygon, type ClientRoom } from "../src/lib/venue/view";
import { EVENT_DAYS, parseInEventTz } from "../src/lib/time";

/** 9 map units per foot (1/8" = 1'-0"): metres per map unit. */
const M_PER_UNIT = 0.3048 / 9;
/** Two door crossings further apart than this (units, ~2 m) are different doors. */
const DOOR_APART = 60;
/** A point this far from the other route is off it (units, ~2 m). */
const OFF = 60;
/** An off stretch at least this long (units, ~4 m) outside the end rooms is another way. */
const SUSTAINED = 120;
/**
 * Within this of a landing of a stair / elevator the trip takes (units, ~5 m) the lines aren't
 * compared: the drawings end their arrows at the stair's wall, the app at its landing inside the
 * stair room, by its door (which stair it is, and how the trip comes to it, are still compared).
 */
const LANDING_NEAR = 150;
/** The walk-time pass: the rules taken this many minutes before each flow's time (as /map shows them on the way). */
export const WALK_LEAD_MIN = 10;
const STEP = 4;
const OPEN_KINDS = new Set(["lobby", "other", "exit"]);
export const FLOW_CLASSES = ["MATCH", "DOOR", "PATH", "CONNECTOR", "UNRESOLVED", "NO_WALK"] as const;
export type FlowClass = (typeof FLOW_CLASSES)[number];

/** One drawn trip as the flows file has it (the fields this check reads). */
type Flow = {
  id: string;
  group: string;
  track: VenueTrack;
  day: string;
  time: { start: string; end: string | null } | string;
  noMove?: boolean;
  fromRoomId?: string;
  fromRoomIds?: string[];
  toRoomId?: string;
  startPoint?: { level: VenueLevelId; xy: VenuePoint };
  connectors: { id: string; fromLevel: VenueLevelId; toLevel: VenueLevelId }[];
  legs: { level: VenueLevelId; walkable?: { polyline?: VenuePoint[] } }[];
};

export type FlowResult = {
  id: string;
  group: string;
  track: VenueTrack;
  cls: FlowClass;
  /** Why it isn't a MATCH: ids and metres only. */
  reasons: string[];
  /** The time the rules were taken at (Eastern wall clock). */
  at: string | null;
  /** The app's route (geometry, for --out only). */
  app?: { connectors: string[]; walks: { level: VenueLevelId; points: VenuePoint[] }[]; distance: number };
};

const r1 = (n: number) => Math.round(n * 10) / 10;
const m = (u: number) => Math.round(u * M_PER_UNIT * 10) / 10;
const hypot = (a: VenuePoint, b: VenuePoint) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function densify(poly: VenuePoint[], step = STEP): VenuePoint[] {
  if (poly.length < 2) return poly.slice();
  const out: VenuePoint[] = [poly[0]];
  for (let i = 1; i < poly.length; i++) {
    const a = poly[i - 1];
    const b = poly[i];
    const n = Math.max(1, Math.ceil(hypot(a, b) / step));
    for (let k = 1; k <= n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  return out;
}

/** Distance of each point of `a` from the polyline `b`. */
function dists(a: VenuePoint[], b: VenuePoint[]): number[] {
  if (b.length === 1) return a.map((p) => hypot(p, b[0]));
  return a.map((p) => {
    let best = Infinity;
    for (let i = 1; i < b.length; i++) {
      const ax = b[i - 1][0];
      const ay = b[i - 1][1];
      const abx = b[i][0] - ax;
      const aby = b[i][1] - ay;
      const l2 = abx * abx + aby * aby + 1e-12;
      const t = Math.max(0, Math.min(1, ((p[0] - ax) * abx + (p[1] - ay) * aby) / l2));
      best = Math.min(best, Math.hypot(ax + abx * t - p[0], ay + aby * t - p[1]));
    }
    return best;
  });
}

/** A level's cells: the smallest room holding each cell centre (any room, public or not), and the walkable grid. */
type LevelIndex = { level: VenueMapData["levels"][number]; walk: Uint8Array; room: Int32Array };

function levelIndex(level: VenueMapData["levels"][number]): LevelIndex {
  const g = level.grid;
  const walk = decodeWalkable(g) ?? new Uint8Array(g.cols * g.rows);
  const room = new Int32Array(g.cols * g.rows).fill(-1);
  const best = new Float64Array(g.cols * g.rows).fill(Infinity);
  level.rooms.forEach((r, i) => {
    const pts = r.polygon.flat();
    let area = 0;
    for (let a = 0, n = r.polygon.length, b = n - 1; a < n; b = a++) area += r.polygon[b][0] * r.polygon[a][1] - r.polygon[a][0] * r.polygon[b][1];
    area = Math.abs(area) / 2;
    const xs = r.polygon.map((p) => p[0]);
    const ys = r.polygon.map((p) => p[1]);
    const x0 = Math.min(...xs);
    const x1 = Math.max(...xs);
    const y0 = Math.min(...ys);
    const y1 = Math.max(...ys);
    const c0 = Math.max(0, Math.floor((x0 - g.origin[0]) / g.cell) - 1);
    const c1 = Math.min(g.cols - 1, Math.ceil((x1 - g.origin[0]) / g.cell) + 1);
    const rr0 = Math.max(0, Math.floor((y0 - g.origin[1]) / g.cell) - 1);
    const rr1 = Math.min(g.rows - 1, Math.ceil((y1 - g.origin[1]) / g.cell) + 1);
    for (let rr = rr0; rr <= rr1; rr++) {
      const y = g.origin[1] + (rr + 0.5) * g.cell;
      if (y < y0 || y > y1) continue;
      for (let cc = c0; cc <= c1; cc++) {
        const x = g.origin[0] + (cc + 0.5) * g.cell;
        if (x < x0 || x > x1) continue;
        const k = rr * g.cols + cc;
        if (area < best[k] && pointInPolygon(pts, x, y)) {
          best[k] = area;
          room[k] = i;
        }
      }
    }
  });
  return { level, walk, room };
}

function roomIndexAt(L: LevelIndex, p: VenuePoint): number {
  const g = L.level.grid;
  const r = Math.floor((p[1] - g.origin[1]) / g.cell);
  const c = Math.floor((p[0] - g.origin[0]) / g.cell);
  return r >= 0 && c >= 0 && r < g.rows && c < g.cols ? L.room[r * g.cols + c] : -1;
}

/** The room (not a stair / elevator) at each sample of a polyline, every STEP units (null = a door gap, a shaft, outside). */
function rawRooms(L: LevelIndex, poly: VenuePoint[]): { room: string | null; p: VenuePoint }[] {
  return densify(poly).map((p) => {
    const i = roomIndexAt(L, p);
    const r = i >= 0 ? L.level.rooms[i] : null;
    return { room: r && r.kind !== "stair" && r.kind !== "elevator" ? r.id : null, p };
  });
}

/** The rooms along a polyline, short runs (under 3 samples, not at the ends) and gaps folded; each with where it is entered. */
function roomsAlong(L: LevelIndex, poly: VenuePoint[], minRun = 3): { room: string; at: VenuePoint }[] {
  const runs: { room: string | null; pts: VenuePoint[] }[] = [];
  for (const { room, p } of rawRooms(L, poly)) {
    const last = runs[runs.length - 1];
    if (last && last.room === room) last.pts.push(p);
    else runs.push({ room, pts: [p] });
  }
  const seq: { room: string; at: VenuePoint }[] = [];
  let pending: VenuePoint[] = [];
  runs.forEach((run, k) => {
    const firstOrLast = k === 0 || k === runs.length - 1;
    if (run.room === null || (run.pts.length < minRun && !firstOrLast)) {
      pending.push(...run.pts);
      return;
    }
    if (seq.length > 0 && seq[seq.length - 1].room === run.room) {
      pending = [];
      return;
    }
    const at = pending.length > 0 ? pending[Math.floor(pending.length / 2)] : run.pts[0];
    seq.push({ room: run.room, at: [r1(at[0]), r1(at[1])] });
    pending = [];
  });
  return seq;
}

/** A room's door openings for this check: walkable cells whose smallest room is another, beside its own (8-connected groups). */
function openingsOf(L: LevelIndex, roomId: string, cache: Map<string, { x: number; y: number; w: number }[]>) {
  const hit = cache.get(roomId);
  if (hit) return hit;
  const g = L.level.grid;
  const i = L.level.rooms.findIndex((r) => r.id === roomId);
  const inside = new Uint8Array(g.cols * g.rows);
  for (let k = 0; k < inside.length; k++) if (L.room[k] === i && L.walk[k]) inside[k] = 1;
  const ring = new Uint8Array(g.cols * g.rows);
  for (let k = 0; k < inside.length; k++) {
    if (!inside[k]) continue;
    const r = (k / g.cols) | 0;
    const c = k - r * g.cols;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const rr = r + dr;
        const cc = c + dc;
        if (rr < 0 || cc < 0 || rr >= g.rows || cc >= g.cols) continue;
        const j = rr * g.cols + cc;
        if (!inside[j] && L.walk[j]) ring[j] = 1;
      }
    }
  }
  const out: { x: number; y: number; w: number }[] = [];
  const seen = new Uint8Array(ring.length);
  for (let k = 0; k < ring.length; k++) {
    if (!ring[k] || seen[k]) continue;
    const cells: number[] = [];
    const stack = [k];
    seen[k] = 1;
    while (stack.length) {
      const q = stack.pop()!;
      cells.push(q);
      const r = (q / g.cols) | 0;
      const c = q - r * g.cols;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const rr = r + dr;
          const cc = c + dc;
          if (rr < 0 || cc < 0 || rr >= g.rows || cc >= g.cols) continue;
          const j = rr * g.cols + cc;
          if (ring[j] && !seen[j]) {
            seen[j] = 1;
            stack.push(j);
          }
        }
      }
    }
    const xs = cells.map((q) => q % g.cols);
    const ys = cells.map((q) => (q / g.cols) | 0);
    const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
    const my = ys.reduce((a, b) => a + b, 0) / ys.length;
    out.push({
      x: g.origin[0] + (mx + 0.5) * g.cell,
      y: g.origin[1] + (my + 0.5) * g.cell,
      w: Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) * g.cell + g.cell,
    });
  }
  cache.set(roomId, out);
  return out;
}

function openingNear(L: LevelIndex, roomId: string, p: VenuePoint, cache: Map<string, { x: number; y: number; w: number }[]>): number | null {
  let best: [number, number] | null = null;
  openingsOf(L, roomId, cache).forEach((o, k) => {
    const d = Math.hypot(o.x - p[0], o.y - p[1]) - o.w / 2;
    if (!best || d < best[0]) best = [d, k];
  });
  return best && (best as [number, number])[0] <= 45 ? (best as [number, number])[1] : null;
}

/** The first sample after the route's first stay in `room` (where it leaves). */
function rawExit(raw: { room: string | null; p: VenuePoint }[], room: string): VenuePoint | null {
  let seen = false;
  for (const x of raw) {
    if (x.room === room) seen = true;
    else if (seen) return [r1(x.p[0]), r1(x.p[1])];
  }
  return null;
}
/** The last sample before the route's last stay in `room` (where it comes in). */
function rawEntry(raw: { room: string | null; p: VenuePoint }[], room: string): VenuePoint | null {
  let seen = false;
  for (let i = raw.length - 1; i >= 0; i--) {
    if (raw[i].room === room) seen = true;
    else if (seen) return [r1(raw[i].p[0]), r1(raw[i].p[1])];
  }
  return null;
}

/** The trip's time: a breakout's start, or the start of what the trip leads to ("... -> 14:00 Goshthi 1"). */
export function flowTime(f: Pick<Flow, "day" | "time">): Date | null {
  const weekday = f.day.slice(0, 3).toUpperCase();
  const names = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
  const day = EVENT_DAYS.find((d) => names[new Date(`${d}T12:00:00Z`).getUTCDay()] === weekday);
  if (!day) return null;
  let hm: string | undefined;
  if (typeof f.time === "string") {
    const after = f.time.includes("->") ? f.time.split("->").pop()! : f.time;
    hm = /(\d{1,2}):(\d{2})/.exec(after)?.[0];
  } else hm = f.time.start;
  if (!hm) return null;
  return parseInEventTz(`${day}T${hm.padStart(5, "0")}`);
}

/**
 * Every flow against the app's routes on `data` (with `rules`, the stored rules or a rules file's;
 * null = none). `passages` = the rooms walked through as open floor (a passage rule's rooms).
 */
export function checkFlows(
  data: VenueMapData,
  flows: Flow[],
  rules: readonly VenueFlowRule[] | null,
  opts: { geometry?: boolean; leadMinutes?: number } = {},
): FlowResult[] {
  const venue = toClientVenue(data);
  const router = createVenueRouter(venue);
  const rooms = new Map(venue.levels.flatMap((l) => l.rooms.map((r) => [r.id, r] as const)));
  const raw = new Map(data.levels.flatMap((l) => l.rooms.map((r) => [r.id, r] as const)));
  const L = new Map(data.levels.map((l) => [l.id, levelIndex(l)] as const));
  const openCache = new Map<string, Map<string, { x: number; y: number; w: number }[]>>();
  const passages = new Set((rules ?? []).flatMap((r) => (r.kind === "passage" ? r.rooms : [])));
  const kindAt = (lv: VenueLevelId, p: VenuePoint): string | null => {
    const X = L.get(lv)!;
    const i = roomIndexAt(X, p);
    if (i < 0) return null;
    const r = X.level.rooms[i];
    return passages.has(r.id) ? "other" : r.kind;
  };
  const inRooms = (lv: VenueLevelId, pts: VenuePoint[], ids: string[]) => {
    const polys = ids.map((id) => raw.get(id)).filter((r): r is VenueRoom => Boolean(r) && r!.level === lv).map((r) => r.polygon.flat());
    return pts.map((p) => polys.some((pg) => pointInPolygon(pg, p[0], p[1])));
  };
  const offRuns = (d: number[], keep: boolean[], kinds: (string | null)[]) => {
    const runs: (string | null)[][] = [];
    let cur: (string | null)[] = [];
    d.forEach((x, i) => {
      if (!keep[i]) return;
      if (x > OFF) cur.push(kinds[i]);
      else if (cur.length) {
        runs.push(cur);
        cur = [];
      }
    });
    if (cur.length) runs.push(cur);
    return runs.map((r) => {
      const known = r.filter((k): k is string => k !== null);
      return { len: r.length * STEP, open: known.length ? known.filter((k) => OPEN_KINDS.has(k)).length / known.length : 1 };
    });
  };

  const out: FlowResult[] = [];
  for (const f of flows) {
    const t = flowTime(f);
    const at = t && opts.leadMinutes ? new Date(t.getTime() - opts.leadMinutes * 60_000) : t;
    const base = { id: f.id, group: f.group, track: f.track, at: at ? at.toISOString() : null };
    if (f.noMove) {
      out.push({ ...base, cls: "NO_WALK", reasons: ["the group is already in the room"] });
      continue;
    }
    const S = f.fromRoomId ?? null;
    const T = f.toRoomId ?? null;
    const dest = T ? rooms.get(T) : undefined;
    const active = routeRulesFor(data, rules, at, f.track);
    const opt = { stepFree: false, track: f.track, rules: active };
    let res: RouteResult | null = null;
    let startRoom: string | null = S;
    if (dest && f.fromRoomIds && f.startPoint) {
      // One drawn start for several rooms: the router from the drawn point.
      res = dest.entry
        ? router.route({ level: f.startPoint.level, point: f.startPoint.xy }, { level: dest.level, point: dest.entry, area: dest.pts, room: dest.id }, opt)
        : null;
    } else if (dest && S) {
      const start = rooms.get(S) as ClientRoom | undefined;
      const from = start ? routeStartPoint(start, router) : null;
      res = start && from ? routeBetween(router, start, from, dest, opt) : null;
      startRoom = start?.id ?? null;
    }
    if (!res || !res.ok) {
      out.push({ ...base, cls: "UNRESOLVED", reasons: [`no app route${res && !res.ok ? ` (${res.reason})` : ""}`] });
      continue;
    }
    const route: VenueRoute = res.route;
    const reasons: string[] = [];
    const fc = f.connectors.map((c) => `${c.id}(${c.fromLevel}>${c.toLevel})`);
    const ac = route.segments.flatMap((s) => (s.type === "connector" ? [`${s.connectorId}(${s.from}>${s.to})`] : []));
    const walks = new Map<VenueLevelId, VenuePoint[]>();
    for (const s of route.segments) {
      if (s.type !== "walk" || s.points.length < 1) continue;
      walks.set(s.level, [...(walks.get(s.level) ?? []), ...s.points.map((p): VenuePoint => [r1(p[0]), r1(p[1])])]);
    }
    let exit: { same: boolean | null; apart: number } | null = null;
    let entry: { same: boolean | null; apart: number } | null = null;
    const seqDiff: string[] = [];
    const midDoor: string[] = [];
    const sustained: string[] = [];
    const doorCmp = (lv: VenueLevelId, room: string, fp: VenuePoint | null, ap: VenuePoint | null) => {
      if (!fp || !ap) return { same: null, apart: 0 };
      const X = L.get(lv)!;
      const cache = openCache.get(lv) ?? new Map();
      openCache.set(lv, cache);
      const fo = openingNear(X, room, fp, cache);
      const ao = openingNear(X, room, ap, cache);
      const d = hypot(fp, ap);
      return { same: fo !== null && ao !== null ? fo === ao : d <= DOOR_APART, apart: d };
    };
    f.legs.forEach((leg, li) => {
      const lv = leg.level;
      const fw = leg.walkable?.polyline;
      const aw = walks.get(lv);
      if (!fw || !aw || !L.has(lv)) return;
      const X = L.get(lv)!;
      const F = densify(fw);
      const Ap = aw.length > 1 ? densify(aw) : aw.slice();
      const dF = dists(F, aw);
      const dA = dists(Ap, fw);
      const ends = [S, T, startRoom].filter((x): x is string => Boolean(x));
      // The landings on this level of the stairs / elevators either takes (LANDING_NEAR).
      const landings = [...new Set([...f.connectors.map((c) => c.id), ...route.segments.flatMap((s) => (s.type === "connector" ? [s.connectorId] : []))])]
        .flatMap((id) => {
          const p = data.connectors.find((c) => c.id === id)?.points[lv];
          return p ? [p] : [];
        });
      const nearLanding = (p: VenuePoint) => landings.some((q) => hypot(p, q) <= LANDING_NEAR);
      const kF = inRooms(lv, F, ends).map((x, i) => !x && !nearLanding(F[i]));
      const kA = inRooms(lv, Ap, ends).map((x, i) => !x && !nearLanding(Ap[i]));
      const runs = [
        ...offRuns(dF, kF, F.map((p) => kindAt(lv, p))),
        ...offRuns(dA, kA, Ap.map((p) => kindAt(lv, p))),
      ];
      const offCorridor = Math.max(0, ...runs.filter((r) => r.open < 0.8).map((r) => r.len));
      if (offCorridor >= SUSTAINED) sustained.push(`level ${lv}: ${m(offCorridor)} m away from the drawing outside open floor`);
      const fseq = roomsAlong(X, fw);
      const aseq = roomsAlong(X, aw);
      if (li === 0 && S) {
        const fr = rawRooms(X, fw);
        const ar = rawRooms(X, aw);
        if (fr.some((x) => x.room === S) || ar.some((x) => x.room === S)) exit = doorCmp(lv, S, rawExit(fr, S), rawExit(ar, S));
      }
      if (li === f.legs.length - 1 && T) entry = doorCmp(lv, T, rawEntry(rawRooms(X, fw), T), rawEntry(rawRooms(X, aw), T));
      const core = (seq: { room: string; at: VenuePoint }[]) => seq.filter((x) => x.room !== S && x.room !== T && x.room !== startRoom);
      const fc_ = core(fseq);
      const ac_ = core(aseq);
      if (fc_.map((x) => x.room).join() !== ac_.map((x) => x.room).join()) {
        seqDiff.push(`level ${lv}: drawn ${fc_.map((x) => x.room).join(" > ") || "-"} / app ${ac_.map((x) => x.room).join(" > ") || "-"}`);
      } else {
        for (let k = 1; k < fc_.length; k++) {
          const d = hypot(fc_[k].at, ac_[k].at);
          if (d > DOOR_APART) midDoor.push(`level ${lv}: into ${fc_[k].room} by doors ${m(d)} m apart`);
        }
      }
    });
    let cls: FlowClass;
    if (fc.join() !== ac.join()) {
      cls = "CONNECTOR";
      reasons.push(`stairs: drawn ${fc.join(", ") || "none"} / app ${ac.join(", ") || "none"}`);
    }
    const door: string[] = [];
    const ex = exit as { same: boolean | null; apart: number } | null;
    const en = entry as { same: boolean | null; apart: number } | null;
    if (ex && ex.same === false) door.push(`leaves ${S} by another door (${m(ex.apart)} m apart)`);
    if (en && en.same === false) door.push(`enters ${T} by another door (${m(en.apart)} m apart)`);
    if (fc.join() === ac.join()) cls = door.length ? "DOOR" : seqDiff.length || midDoor.length || sustained.length ? "PATH" : "MATCH";
    reasons.push(...door, ...seqDiff, ...midDoor, ...sustained);
    out.push({
      ...base,
      cls: cls!,
      reasons: cls! === "MATCH" ? [] : reasons,
      ...(opts.geometry
        ? {
            app: {
              connectors: ac,
              walks: route.segments.flatMap((s) => (s.type === "walk" ? [{ level: s.level, points: s.points }] : [])),
              distance: r1(route.distance),
            },
          }
        : {}),
    });
  }
  return out;
}

/**
 * Counts per class, overall and per group, as lines of text (ids and counts only). `walk` = the
 * same flows with the rules taken WALK_LEAD_MIN minutes earlier (checkFlows()'s leadMinutes): a
 * flow whose class differs there gets other directions on /map while guests are on the way (a
 * window that starts with the session instead of before the walk).
 */
export function flowSummary(results: FlowResult[], baseline?: FlowResult[] | null, walk?: FlowResult[] | null): string[] {
  const lines: string[] = [];
  const count = (rs: FlowResult[]) =>
    FLOW_CLASSES.map((c) => [c, rs.filter((r) => r.cls === c).length] as const)
      .filter(([, n]) => n > 0)
      .map(([c, n]) => `${c} ${n}`)
      .join(", ");
  const walked = results.filter((r) => r.cls !== "NO_WALK");
  lines.push(`${results.length} flows (${walked.length} walked): ${count(results)}`);
  const groups = [...new Set(results.map((r) => r.group))];
  for (const g of groups) lines.push(`  ${g}: ${count(results.filter((r) => r.group === g))}`);
  const off = walked.filter((r) => r.cls !== "MATCH");
  lines.push(off.length ? `  not matching: ${off.map((r) => `${r.id} (${r.cls})`).join(", ")}` : "  every walked flow matches");
  if (baseline) {
    const before = new Map(baseline.map((r) => [r.id, r.cls]));
    const fixed = results.filter((r) => r.cls === "MATCH" && before.get(r.id) !== "MATCH" && before.has(r.id)).map((r) => r.id);
    const broke = results.filter((r) => r.cls !== "MATCH" && r.cls !== "NO_WALK" && before.get(r.id) === "MATCH").map((r) => r.id);
    lines.push(`  against the baseline (${count(baseline)}): ${fixed.length} now match, ${broke.length} regressions${broke.length ? `: ${broke.join(", ")}` : ""}`);
  }
  if (walk) {
    const then = new Map(walk.map((r) => [r.id, r.cls]));
    const moved = results.filter((r) => then.has(r.id) && then.get(r.id) !== r.cls);
    lines.push(
      `  at walk time (the rules ${WALK_LEAD_MIN} min before each flow's time, as /map shows them on the way): ${count(walk)}; ` +
        (moved.length ? `${moved.length} differ: ${moved.map((r) => `${r.id} (${r.cls} -> ${then.get(r.id)})`).join(", ")}` : "every flow the same"),
    );
  }
  return lines;
}

/** Reads a flows file (outside the repo). */
export function readFlows(file: string): Flow[] {
  assertOutsideRepo(file, "--flows");
  const json = JSON.parse(readFileSync(file, "utf8")) as { flows?: Flow[] };
  if (!Array.isArray(json.flows)) throw new Error(`${file}: no "flows" list`);
  return json.flows;
}

/** Derived from the organisers' drawings: never read from (or written to) inside the repo. */
export function assertOutsideRepo(file: string, flag: string) {
  const repo = resolve(__dirname, "..");
  const rel = relative(repo, resolve(file));
  if (!(rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel))) {
    throw new Error(`${flag} ${file} is inside the repo; keep files derived from the organisers' drawings outside it`);
  }
}

// On its own.
if (/venue-flow-check\.ts$/.test(process.argv[1] ?? "")) {
  const arg = (name: string) => {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 ? process.argv[i + 1] : undefined;
  };
  const mapFile = arg("map");
  const flowsFile = arg("flows");
  if (!mapFile || !flowsFile) {
    console.error(
      'Usage: npx tsx --tsconfig scripts/tsconfig.server-only.json scripts/venue-flow-check.ts --map "<venue-map.json>" --flows "<flows.json>" [--rules "<flow-rules.json>"] [--baseline "<venue-map.json>"] [--details] [--out "<results.json>"]',
    );
    process.exit(1);
  }
  const load = (file: string, flag: string, rulesFile?: string): { data: VenueMapData; rules: VenueFlowRule[] | null } => {
    assertOutsideRepo(file, flag);
    const json = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    if (rulesFile) {
      assertOutsideRepo(rulesFile, "--rules");
      const r = JSON.parse(readFileSync(rulesFile, "utf8")) as unknown;
      json.flowRules = Array.isArray(r) ? r : (r as { rules?: unknown }).rules;
    }
    const v = validateVenueMap(json);
    if (!v.data) throw new Error(`${flag} ${file} is not a venue map: ${v.errors[0]}`);
    if (v.ruleErrors.length > 0) {
      for (const e of v.ruleErrors.slice(0, 40)) console.log(`  ! ${e}`);
      throw new Error(`The flow rules have ${v.ruleErrors.length} problem(s) (above)`);
    }
    return { data: v.data, rules: v.rules };
  };
  const { data, rules } = load(mapFile, "--map", arg("rules"));
  const flows = readFlows(flowsFile);
  const t0 = Date.now();
  const results = checkFlows(data, flows, rules, { geometry: Boolean(arg("out")) });
  const walk = checkFlows(data, flows, rules, { leadMinutes: WALK_LEAD_MIN });
  let baseline: FlowResult[] | null = null;
  const baselineFile = arg("baseline");
  if (baselineFile) {
    const b = load(baselineFile, "--baseline");
    baseline = checkFlows({ ...b.data, flowRules: undefined }, flows, null);
  }
  console.log(`Flow check: ${rules?.length ?? 0} flow rules, in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  for (const l of flowSummary(results, baseline, walk)) console.log(l);
  if (process.argv.includes("--details")) {
    for (const r of results) if (r.cls !== "MATCH" && r.cls !== "NO_WALK") console.log(`  ${r.id} ${r.cls}: ${r.reasons.join("; ")}`);
    const now = new Map(results.map((r) => [r.id, r.cls]));
    for (const r of walk) if (r.cls !== now.get(r.id)) console.log(`  ${r.id} at walk time ${r.cls}: ${r.reasons.join("; ")}`);
  }
  const outFile = arg("out");
  if (outFile) {
    assertOutsideRepo(outFile, "--out");
    writeFileSync(outFile, JSON.stringify({ results, baseline }));
    console.log(`  wrote ${outFile}`);
  }
}

