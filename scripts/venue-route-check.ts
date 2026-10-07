/**
 * The Pujya Santo view's route check: run by `npm run venue:import` (every mode) whenever the map
 * carries santo extras (the sadhus' residence, src/lib/venue/types.ts), and on its own:
 *
 *   npx tsx --tsconfig scripts/tsconfig.server-only.json scripts/venue-route-check.ts --file "<venue-map.json>" [--rules "<flow-rules.json>"]
 *
 * Pure: no database. It routes as the browser does (createVenueRouter() over toClientVenue() /
 * toSantClientVenue(), the start points /map uses, Bhaio track, Step-free off and on) and checks:
 *  1. public trips are the delegates': every ordered pair of public rooms with an entry on each
 *     level that has residence rooms, and every public room to and from the default start (the
 *     Main Foyer), route exactly alike for santos and for everyone else;
 *  2. residence trips work: each residence room with an entry (shafts and ways included) to and
 *     from the default start, the 3 public rooms nearest it, the largest public room of every other
 *     level, the organisers' Sahajanand Hall and Sant Offices, and every room santos are shown;
 *  3. those trips never cross a private room santos aren't shown (back-of-house, the deities'
 *     rooms, the rest of the residence), a staff-only room, or a sadhu's own room that is neither
 *     end, except an own room reached only through another (a suite: listed, not an error);
 *  4. (warning) a residence room whose distance from the default start differs by more than 30%
 *     from its distance back to the same point (the middle of the Main Foyer, where /map starts a
 *     trip from it: a trip *to* the foyer ends at its nearest edge instead, which would add the
 *     foyer's own depth to every room's figure).
 * With flow rules (VenueMapData.flowRules) the checks run once per set of Bhaio rules the map can
 * have in force (no time, and a time inside each rule's window: flowRules.ts routeRulesFor()), both
 * routers given the same rules and the rooms' ids, as /sant/map and /map pass them.
 * Rooms are printed by map id only, never by the blueprint's names (the terminal of the organisers'
 * import; nothing here reaches a browser).
 */
import { readFileSync } from "node:fs";
import type { VenueLevelId, VenueMapData, VenuePoint, VenueRoom, VenueTrack } from "../src/lib/venue/types";
import { validateVenueMap } from "../src/lib/venue/validate";
import { isSantRoom, toClientVenue, toSantClientVenue } from "../src/lib/venue/clientVenue";
import { createVenueRouter, type RouteEnd, type RouteResult, type VenueRouter } from "../src/lib/venue/route";
import { flowWindows, routeRulesFor, type RouteRules } from "../src/lib/venue/flowRules";
import { parseInEventTz } from "../src/lib/time";
import { defaultStart, listedRooms, routeStartPoint } from "../src/lib/venue/directions";
import { buildVenueIndex } from "../src/lib/venue/aliases";
import { VENUE_ALIAS_ENTRIES } from "../src/lib/venue/aliasTable";
import { decodeWalkable } from "../src/lib/venue/validate";
import { pointInPolygon, startsAtDoor, type ClientRoom, type ClientVenue } from "../src/lib/venue/view";

const TRACK: VenueTrack = "BHAIO";
/** The organisers' rooms santos go to most (VENUE_ROOM_NAMES), checked to and from every residence room. */
const KEY_ROOMS = ["Sahajanand Hall", "Sant Office 1", "Sant Office 2"];
const NEAREST = 3;
const SYMMETRY = 0.3;

type End = { id: string; level: VenueLevelId; start: RouteEnd; dest: RouteEnd };
type Area = { id: string; pts: number[]; box: [number, number, number, number] };

const boxOf = (pts: number[]): [number, number, number, number] => {
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
  return [x0, y0, x1, y1];
};
const areaOf = (id: string, pts: number[]): Area => ({ id, pts, box: boxOf(pts) });
const inArea = (a: Area, [x, y]: VenuePoint) => x >= a.box[0] && x <= a.box[2] && y >= a.box[1] && y <= a.box[3] && pointInPolygon(a.pts, x, y);
const flat = (r: VenueRoom) => r.polygon.flatMap(([x, y]) => [x, y]);
const polyArea = (pts: number[]) => {
  let s = 0;
  for (let i = 0, n = pts.length / 2, j = n - 1; i < n; j = i++) s += pts[2 * j] * pts[2 * i + 1] - pts[2 * i] * pts[2 * j + 1];
  return Math.abs(s) / 2;
};

export function checkSantoRoutes(data: VenueMapData): { lines: string[]; errors: string[]; warnings: string[] } {
  const t0 = Date.now();
  // Every set of Bhaio flow rules the map can have in force: none in force (no time), then a time in each window.
  const sets = new Map<string, { label: string; rules: RouteRules | null }>();
  sets.set("none", { label: "no flow rules", rules: null });
  const windowless = routeRulesFor(data, data.flowRules, null, TRACK);
  if (windowless) sets.set(windowless.key, { label: "flow rules with no window", rules: windowless });
  for (const w of flowWindows(data.flowRules)) {
    const at = parseInEventTz(`${w.day}T${w.from}`);
    const rules = routeRulesFor(data, data.flowRules, at, TRACK);
    if (rules && !sets.has(rules.key)) sets.set(rules.key, { label: `flow rules in force ${w.day} ${w.from}`, rules });
  }
  const lines: string[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  for (const set of sets.values()) {
    const r = checkWith(data, set.rules);
    lines.push(`With ${set.label}:`, ...r.lines.map((l) => `  ${l}`));
    errors.push(...r.errors.map((e) => `${e} [${set.label}]`));
    for (const w of r.warnings) if (!warnings.includes(w)) warnings.push(w);
  }
  lines.push(`Route check: ${errors.length} error(s), ${warnings.length} warning(s) in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  return { lines, errors, warnings };
}

/** The checks with one set of flow rules in force (null = none). */
function checkWith(data: VenueMapData, rules: RouteRules | null): { lines: string[]; errors: string[]; warnings: string[] } {
  const lines: string[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  const guest = toClientVenue(data);
  const santo = toSantClientVenue(data);
  if (guest === santo) return { lines: ["No santo extras: nothing to check."], errors, warnings };

  const gR = createVenueRouter(guest);
  const sR = createVenueRouter(santo);
  const gRooms = guest.levels.flatMap((l) => l.rooms);
  const sRooms = santo.levels.flatMap((l) => l.rooms);
  const listed = listedRooms(gRooms, buildVenueIndex(gRooms, VENUE_ALIAS_ENTRIES)).filter((r) => r.entry && !r.closed);
  const sListed = listedRooms(sRooms, buildVenueIndex(sRooms, VENUE_ALIAS_ENTRIES));
  const lobby = defaultStart(listed);
  const sLobby = defaultStart(sListed);
  if (!lobby) {
    errors.push("The map has no default start (Main Foyer): nothing to route from");
    return { lines, errors, warnings };
  }
  if (sLobby?.id !== lobby.id) errors.push(`The default start differs for santos: ${sLobby?.id ?? "none"} instead of ${lobby.id}`);
  // As routeBetween() (directions.ts) passes them: the rooms' ids, and a room left by its door starts at its allowed doors.
  const startOf = (r: ClientRoom, router: VenueRouter): RouteEnd => {
    const point = routeStartPoint(r, router) ?? r.entry!;
    return { level: r.level, point, room: r.id, ...(startsAtDoor(r) && point === r.entry ? { fromDoors: true } : {}) };
  };
  const destOf = (r: ClientRoom): RouteEnd => ({ level: r.level, point: r.entry!, area: r.pts, room: r.id });
  const roomEnd = (r: ClientRoom, router: VenueRouter): End => ({ id: r.id, level: r.level, start: startOf(r, router), dest: destOf(r) });
  const opts = (stepFree: boolean) => ({ stepFree, track: TRACK, rules });
  const sf = (stepFree: boolean) => (stepFree ? "step-free on" : "step-free off");

  // ---- 1. Public trips are the delegates'
  const santLevels = new Set(data.levels.filter((l) => l.rooms.some(isSantRoom)).map((l) => l.id));
  const pairs: [ClientRoom, ClientRoom][] = [];
  for (const a of listed) {
    if (santLevels.has(a.level)) for (const b of listed) if (b !== a && b.level === a.level) pairs.push([a, b]);
    if (a.id !== lobby.id) pairs.push([lobby, a], [a, lobby]);
  }
  let same = 0;
  for (const [a, b] of pairs) {
    for (const stepFree of [false, true]) {
      const g = gR.route(startOf(a, gR), destOf(b), opts(stepFree));
      const s = sR.route(startOf(a, sR), destOf(b), opts(stepFree));
      if (JSON.stringify(g) === JSON.stringify(s)) same++;
      else errors.push(`public trip differs for santos: ${a.id} -> ${b.id} (${sf(stepFree)})`);
    }
  }
  lines.push(`Public trips: ${same} of ${pairs.length * 2} identical for santos and delegates (Bhaio, step-free off and on)`);

  // ---- 2. Residence trips work
  const shown = sRooms.filter((r) => r.sant && r.entry);
  const residence: End[] = shown.map((r) => roomEnd(r, sR));
  for (const l of data.levels) {
    for (const r of l.rooms) {
      if (!isSantRoom(r) || !r.santEntry || shown.some((s) => s.id === r.id)) continue;
      const end: RouteEnd = { level: l.id, point: r.santEntry };
      residence.push({ id: r.id, level: l.id, start: end, dest: end });
    }
  }
  const byName = (name: string) => sRooms.find((r) => r.named && r.name === name && r.entry && !r.closed && !r.sant);
  const keyRooms = KEY_ROOMS.map((n) => ({ n, r: byName(n) }));
  for (const k of keyRooms) if (!k.r) warnings.push(`${k.n} isn't a public room with an entry on this map: not checked`);
  const centre = (e: End) => e.dest.point;
  const targetsOf = (x: End): End[] => {
    const out = new Map<string, End>();
    out.set(lobby.id, roomEnd(lobby, sR));
    const near = listed
      .filter((r) => r.level === x.level)
      .sort((a, b) => Math.hypot(a.entry![0] - centre(x)[0], a.entry![1] - centre(x)[1]) - Math.hypot(b.entry![0] - centre(x)[0], b.entry![1] - centre(x)[1]))
      .slice(0, NEAREST);
    for (const r of near) out.set(r.id, roomEnd(r, sR));
    for (const l of santo.levels) {
      if (l.id === x.level) continue;
      const big = listed.filter((r) => r.level === l.id).sort((a, b) => polyArea(b.pts) - polyArea(a.pts))[0];
      if (big) out.set(big.id, roomEnd(big, sR));
    }
    for (const k of keyRooms) if (k.r) out.set(k.r.id, roomEnd(k.r, sR));
    for (const r of shown) if (r.id !== x.id) out.set(r.id, roomEnd(r, sR));
    return [...out.values()];
  };

  // ---- 3. Crossings: per level, the rooms no residence trip may walk through
  const forbidden = new Map<VenueLevelId, Area[]>();
  const ownAreas = new Map<VenueLevelId, Area[]>();
  for (const l of data.levels) {
    forbidden.set(
      l.id,
      l.rooms.filter((r) => (!r.public && !isSantRoom(r)) || (r.public && r.closed)).map((r) => areaOf(r.id, flat(r))),
    );
    ownAreas.set(
      l.id,
      l.rooms.filter((r) => isSantRoom(r) && r.sant === "own").map((r) => areaOf(r.id, flat(r))),
    );
  }
  // An own room reached only across another own room (a suite): from the delegates' floor, with
  // every other own room blocked, its cells can't be reached (4-connected: the router never cuts a
  // corner).
  const onlyThrough = new Map<string, string[]>();
  for (const l of santo.levels) {
    const own = ownAreas.get(l.id) ?? [];
    if (own.length === 0 || !l.guestGrid) continue;
    const { cols, rows, cell, origin } = l.grid;
    const walk = decodeWalkable(l.grid)!;
    const guestWalk = decodeWalkable(l.guestGrid)!;
    const ownOf = new Int32Array(cols * rows).fill(-1);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        if (!walk[i]) continue;
        const p: VenuePoint = [origin[0] + (c + 0.5) * cell, origin[1] + (r + 0.5) * cell];
        const k = own.findIndex((a) => inArea(a, p));
        if (k >= 0) ownOf[i] = k;
      }
    }
    const reachWithout = (blocked: Set<number>) => {
      const seen = new Uint8Array(cols * rows);
      const queue: number[] = [];
      for (let i = 0; i < walk.length; i++) if (guestWalk[i] && walk[i]) (seen[i] = 1), queue.push(i);
      for (let h = 0; h < queue.length; h++) {
        const i = queue[h];
        const r = (i / cols) | 0;
        const c = i - r * cols;
        for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const rr = r + dr;
          const cc = c + dc;
          if (rr < 0 || cc < 0 || rr >= rows || cc >= cols) continue;
          const j = rr * cols + cc;
          if (seen[j] || !walk[j] || (ownOf[j] >= 0 && blocked.has(ownOf[j]))) continue;
          seen[j] = 1;
          queue.push(j);
        }
      }
      return seen;
    };
    own.forEach((a, k) => {
      const others = new Set(own.map((_, j) => j).filter((j) => j !== k));
      const seen = reachWithout(others);
      let reached = false;
      for (let i = 0; i < walk.length && !reached; i++) if (ownOf[i] === k && seen[i]) reached = true;
      if (reached) return;
      const via = [...others].filter((j) => {
        const s2 = reachWithout(new Set([...others].filter((o) => o !== j)));
        for (let i = 0; i < walk.length; i++) if (ownOf[i] === k && s2[i]) return true;
        return false;
      });
      onlyThrough.set(a.id, via.map((j) => own[j].id));
    });
  }
  for (const [id, via] of onlyThrough) lines.push(`  reached only through: ${id} via ${via.join(", ") || "(several)"}`);

  const roomAt = (level: VenueLevelId, p: VenuePoint) =>
    [...(forbidden.get(level) ?? []), ...(ownAreas.get(level) ?? [])].find((a) => inArea(a, p))?.id ??
    data.levels.find((l) => l.id === level)?.rooms.find((r) => isSantRoom(r) && pointInPolygon(flat(r), p[0], p[1]))?.id ??
    null;
  /** Rooms a route crosses that it may not (2+ consecutive samples, half a cell apart, inside one). */
  const crossings = (res: RouteResult, from: End, to: End): string[] => {
    if (!res.ok) return [];
    const ends = new Set([roomAt(from.level, from.start.point), roomAt(to.level, to.dest.point), from.id, to.id].filter(Boolean) as string[]);
    const allowed = new Set<string>(ends);
    for (const e of [from.id, to.id]) for (const v of onlyThrough.get(e) ?? []) allowed.add(v);
    const out = new Set<string>();
    for (const seg of res.route.segments) {
      if (seg.type !== "walk" || seg.points.length < 2) continue;
      const areas = [...(forbidden.get(seg.level) ?? []), ...(ownAreas.get(seg.level) ?? []).filter((a) => !allowed.has(a.id))];
      let prev: string | null = null;
      for (let i = 1; i < seg.points.length; i++) {
        const [a, b] = [seg.points[i - 1], seg.points[i]];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const n = Math.max(1, Math.ceil(len / (data.levels[0].grid.cell / 2)));
        for (let k = 0; k <= n; k++) {
          const p: VenuePoint = [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n];
          const hit = areas.find((x) => inArea(x, p))?.id ?? null;
          if (hit && hit === prev) out.add(hit);
          prev = hit;
        }
      }
    }
    return [...out];
  };

  let trips = 0;
  let ok = 0;
  /** Residence room -> the distance to it from the default start (Step-free off), for check 4. */
  const there = new Map<string, number>();
  for (const x of residence) {
    for (const y of targetsOf(x)) {
      for (const [from, to] of [
        [x, y],
        [y, x],
      ] as const) {
        for (const stepFree of [false, true]) {
          trips++;
          const res = sR.route(from.start, to.dest, opts(stepFree));
          if (!res.ok) {
            errors.push(`${from.id} -> ${to.id} (${sf(stepFree)}): no route (${res.reason})`);
            continue;
          }
          ok++;
          if (!stepFree && from.id === lobby.id) there.set(to.id, res.route.distance);
          const bad = crossings(res, from, to);
          if (bad.length > 0) errors.push(`${from.id} -> ${to.id} (${sf(stepFree)}): crosses ${bad.join(", ")}`);
        }
      }
    }
  }
  lines.push(
    `Residence trips: ${ok} of ${trips} found for ${residence.length} residence rooms (${shown.length} shown to santos: ${shown.map((r) => r.id).join(", ")})`,
  );

  // ---- 4. Symmetry (warning only): back to the very point the trip there started from (not to the
  // foyer's outline, as check 2 routes it), so only a difference at the residence's end counts: in
  // by one door and out by another.
  const lobbyPoint: RouteEnd = { level: lobby.level, point: startOf(lobby, sR).point };
  for (const x of residence) {
    const to = there.get(x.id);
    const back = sR.route(x.start, lobbyPoint, opts(false));
    if (to === undefined || !back.ok) continue;
    const from = back.route.distance;
    if (Math.abs(to - from) > SYMMETRY * Math.max(to, from)) {
      warnings.push(`${x.id}: ${Math.round(to)} units from ${lobby.id}, ${Math.round(from)} back`);
    }
  }
  return { lines, errors, warnings };
}

// On its own: --file <venue-map.json>
if (/venue-route-check\.ts$/.test(process.argv[1] ?? "")) {
  const i = process.argv.indexOf("--file");
  const file = i >= 0 ? process.argv[i + 1] : undefined;
  if (!file) {
    console.error('Usage: npx tsx --tsconfig scripts/tsconfig.server-only.json scripts/venue-route-check.ts --file "<venue-map.json>" [--rules "<flow-rules.json>"]');
    process.exit(1);
  }
  const json = JSON.parse(readFileSync(file, "utf8"));
  // --rules <file>: the flow rules to check with (as venue:import merges them), else the map's own.
  const ri = process.argv.indexOf("--rules");
  if (ri >= 0 && process.argv[ri + 1]) {
    const rules = JSON.parse(readFileSync(process.argv[ri + 1], "utf8"));
    json.flowRules = Array.isArray(rules) ? rules : rules.rules;
  }
  const v = validateVenueMap(json);
  if (!v.data) {
    console.error(`Not a venue map: ${v.errors[0]}`);
    process.exit(1);
  }
  if (v.ruleErrors.length > 0) {
    console.error(`The flow rules have ${v.ruleErrors.length} problem(s), first: ${v.ruleErrors[0]}`);
    process.exit(1);
  }
  const r = checkSantoRoutes(v.data);
  for (const l of r.lines) console.log(l);
  for (const w of r.warnings) console.log(`  ~ ${w}`);
  for (const e of r.errors.slice(0, 60)) console.log(`  ! ${e}`);
  if (r.errors.length > 60) console.log(`  ... and ${r.errors.length - 60} more`);
  process.exit(r.errors.length > 0 ? 1 : 0);
}
