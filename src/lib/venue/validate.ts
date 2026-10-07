/**
 * Defensive shape checks for VenueMapData (src/lib/venue/types.ts), shared by the import
 * (scripts/import-venue.ts, which refuses any error) and the hub's reader
 * (src/lib/venue/data.ts, which treats a structural error as "no map"). Pure: no database, no
 * file system, safe anywhere.
 *
 * Two classes of problem:
 *  - `errors`: the shape is wrong (a missing field, a non-finite point, a duplicate id, a grid
 *    whose bitset has the wrong length, ...). The map can't be drawn safely.
 *  - `routingErrors`: the shape is fine but a stair / elevator landing is not on a walkable cell
 *    (or is off its level's grid), so routes through it would start in a wall, or the levels'
 *    `order` doesn't put them B < 1 < 2 < M (the mezzanine on top; a map extracted before
 *    2026-09-30 has it between the first and second floors), or a staff-only (`closed`) room has
 *    an entry or walkable cells (directions could end in it or cross it). The import refuses
 *    these too; the hub still shows the map (the router snaps to the nearest walkable cell, and
 *    never enters a closed room whatever the grid says).
 * `warnings` are listed but never block: a public room with no entry (unreachable), an entry
 * off the walkable grid, no stair or elevator with a `side` (every guest may use every one) or
 * with a `place` (directions say "the stairs" without saying which), a `closed` room that isn't
 * public, or fields VenueMapData doesn't have (toClientVenue() drops them, so they never reach
 * the browser, but --plan names them so a change to the extractor is noticed).
 *
 * A third class, `santErrors` (with `santWarnings`), is about the Pujya Santo view's extras only
 * (the sadhus' residence: `sant`, `santEntry`, `santGrid`, `santPoints`; types.ts). Nothing about
 * them ever goes in `errors` (so they can never take the map away from anyone), and only one thing
 * in `routingErrors`, which is about the delegates' own grid: walkable delegate floor inside a room
 * only santos are shown (id-free). The import refuses any santError; at run time one only makes
 * the santos' pages fall back to the delegates' map (src/lib/venue/data.ts).
 *
 * A fourth, `ruleErrors` (with `ruleWarnings`), is about the flow rules (`flowRules`) and the door
 * openings they name (rooms' `doors`; flowRules.ts checkFlowRules()): an unknown kind, a room,
 * door or stair the map doesn't have, a door that isn't an opening on the grid. Like the santo
 * extras they never take the map away: `rules` is then null and the app applies none (data.ts);
 * the import refuses any.
 */
import type {
  VenueConnector,
  VenueFlowRule,
  VenueGrid,
  VenueLevel,
  VenueLevelId,
  VenueMapData,
  VenuePlace,
  VenuePoint,
  VenueRoom,
  VenueRoomKind,
  VenueSantClass,
  VenueSide,
} from "./types";
import { pointInPolygon } from "./view";
import { checkFlowRules } from "./flowRules";

/** Every level id, bottom to top: the mezzanine is the top floor (see VenueLevelId). */
export const VENUE_LEVEL_IDS: readonly VenueLevelId[] = ["B", "1", "2", "M"];
export const VENUE_SIDES: readonly VenueSide[] = ["left", "right"];
export const VENUE_PLACES: readonly VenuePlace[] = ["foyer", "side", "back"];
export const VENUE_SANT_CLASSES: readonly VenueSantClass[] = ["own", "shared", "way"];
export const VENUE_ROOM_KINDS: readonly VenueRoomKind[] = [
  "room",
  "hall",
  "corridor",
  "lobby",
  "restroom",
  "stair",
  "elevator",
  "exit",
  "dining",
  "other",
];

/** Sanity caps: far above the mandir's real size, low enough to stop a runaway extraction. */
const MAX_ROOMS_PER_LEVEL = 3000;
const MAX_POLYGON_POINTS = 4000;
const MAX_GRID_CELLS = 4_000_000;
const MAX_WALLS_CHARS = 4_000_000;

export type VenueValidation = {
  /** The data, typed, when there are no `errors` (routing errors and warnings allowed). */
  data: VenueMapData | null;
  errors: string[];
  routingErrors: string[];
  warnings: string[];
  /** The Pujya Santo view's extras are wrong (see the file comment): santos get the delegates' map. */
  santErrors: string[];
  santWarnings: string[];
  /** The flow rules or the doors they name are wrong (see the file comment): no rule applies. */
  ruleErrors: string[];
  ruleWarnings: string[];
  /** The flow rules, checked against the map ([] = none); null when there is any ruleError. */
  rules: VenueFlowRule[] | null;
};

type Obj = Record<string, unknown>;

/** VenueMapData's fields per object (types.ts); anything else is reported as a warning. */
const KNOWN_FIELDS = {
  "": ["version", "generatedAt", "source", "levels", "connectors", "flowRules"],
  "levels[]": ["id", "name", "order", "bounds", "walls", "rooms", "grid", "santGrid"],
  "levels[].bounds": ["x", "y", "width", "height"],
  "levels[].grid": ["cell", "cols", "rows", "origin", "walkable"],
  "levels[].santGrid": ["cell", "cols", "rows", "origin", "walkable"],
  "levels[].rooms[]": ["id", "level", "number", "name", "kind", "public", "polygon", "label", "entry", "closed", "sant", "santEntry", "doors"],
  "levels[].rooms[].doors[]": ["id", "at", "width", "to"],
  "connectors[]": ["id", "kind", "name", "points", "side", "place", "santPoints"],
} as const;

function noteUnknown(o: unknown, at: keyof typeof KNOWN_FIELDS, unknown: Set<string>) {
  if (!isObj(o)) return;
  const known: readonly string[] = KNOWN_FIELDS[at];
  for (const k of Object.keys(o)) if (!known.includes(k)) unknown.add(at ? `${at}.${k}` : k);
}
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const isPoint = (v: unknown): v is VenuePoint => Array.isArray(v) && v.length === 2 && isNum(v[0]) && isNum(v[1]);

/** Decodes a grid's bitset (1 = walkable) into one byte per cell; null when the length is wrong. */
export function decodeWalkable(grid: Pick<VenueGrid, "cols" | "rows" | "walkable">): Uint8Array | null {
  const n = grid.cols * grid.rows;
  let bytes: Uint8Array;
  try {
    bytes = base64ToBytes(grid.walkable);
  } catch {
    return null;
  }
  if (bytes.length !== Math.ceil(n / 8)) return null;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = (bytes[i >> 3] >> (7 - (i & 7))) & 1;
  return out;
}

/** Base64 to bytes in both Node and the browser (no Buffer in the client bundle). */
export function base64ToBytes(b64: string): Uint8Array {
  if (typeof atob === "function") {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  // Node without a global atob (old runtimes): Buffer is there.
  const B = (globalThis as unknown as { Buffer?: { from(s: string, enc: string): Uint8Array } }).Buffer;
  if (!B) throw new Error("No base64 decoder available");
  return new Uint8Array(B.from(b64, "base64"));
}

/** The cell a map point falls in, or null when it is off the grid. */
export function cellAt(grid: VenueGrid, p: VenuePoint): { c: number; r: number } | null {
  const c = Math.floor((p[0] - grid.origin[0]) / grid.cell);
  const r = Math.floor((p[1] - grid.origin[1]) / grid.cell);
  if (c < 0 || r < 0 || c >= grid.cols || r >= grid.rows) return null;
  return { c, r };
}

function checkGrid(g: unknown, where: string, errors: string[]): g is VenueGrid {
  if (!isObj(g)) {
    errors.push(`${where}: grid is missing`);
    return false;
  }
  const ok =
    isNum(g.cell) &&
    g.cell > 0 &&
    Number.isInteger(g.cols) &&
    Number.isInteger(g.rows) &&
    (g.cols as number) > 0 &&
    (g.rows as number) > 0 &&
    isPoint(g.origin) &&
    isStr(g.walkable);
  if (!ok) {
    errors.push(`${where}: grid needs cell > 0, whole cols/rows > 0, an origin point and a walkable bitset`);
    return false;
  }
  if ((g.cols as number) * (g.rows as number) > MAX_GRID_CELLS) {
    errors.push(`${where}: grid of ${g.cols} x ${g.rows} cells is too large (max ${MAX_GRID_CELLS})`);
    return false;
  }
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(g.walkable as string) || !decodeWalkable(g as unknown as VenueGrid)) {
    errors.push(`${where}: walkable is not base64 of ceil(cols x rows / 8) bytes`);
    return false;
  }
  return true;
}

function checkRoom(r: unknown, level: VenueLevelId, where: string, errors: string[]): r is VenueRoom {
  if (!isObj(r)) {
    errors.push(`${where}: not an object`);
    return false;
  }
  const bad: string[] = [];
  if (!isStr(r.id) || !r.id.trim()) bad.push("id");
  if (r.level !== level) bad.push(`level (must be "${level}", its level)`);
  if (!(r.number === null || (isStr(r.number) && r.number.trim()))) bad.push("number (string or null)");
  if (!isStr(r.name)) bad.push("name");
  if (!VENUE_ROOM_KINDS.includes(r.kind as VenueRoomKind)) bad.push("kind");
  if (typeof r.public !== "boolean") bad.push("public");
  if (
    !Array.isArray(r.polygon) ||
    r.polygon.length < 3 ||
    r.polygon.length > MAX_POLYGON_POINTS ||
    !r.polygon.every(isPoint)
  ) {
    bad.push(`polygon (3 to ${MAX_POLYGON_POINTS} finite points)`);
  }
  if (!isPoint(r.label)) bad.push("label");
  if (!(r.entry === null || isPoint(r.entry))) bad.push("entry (point or null)");
  if (!(r.closed === undefined || typeof r.closed === "boolean")) bad.push("closed (true, false or absent)");
  if (bad.length > 0) {
    errors.push(`${where}${isStr(r.id) ? ` (${r.id})` : ""}: bad ${bad.join(", ")}`);
    return false;
  }
  return true;
}

function checkConnector(c: unknown, levelIds: Set<string>, where: string, errors: string[]): c is VenueConnector {
  if (!isObj(c)) {
    errors.push(`${where}: not an object`);
    return false;
  }
  const bad: string[] = [];
  if (!isStr(c.id) || !c.id.trim()) bad.push("id");
  if (c.kind !== "stair" && c.kind !== "elevator") bad.push("kind (stair or elevator)");
  if (!isStr(c.name) || !c.name.trim()) bad.push("name");
  if (!isObj(c.points)) bad.push("points");
  else {
    const keys = Object.keys(c.points);
    if (keys.length < 2) bad.push("points (at least two levels)");
    for (const k of keys) {
      if (!levelIds.has(k)) bad.push(`points.${k} (no such level)`);
      else if (!isPoint(c.points[k])) bad.push(`points.${k} (not a finite point)`);
    }
  }
  if (c.side !== undefined && !VENUE_SIDES.includes(c.side as VenueSide)) bad.push(`side (${VENUE_SIDES.join(" or ")}, or absent)`);
  if (c.place !== undefined && !VENUE_PLACES.includes(c.place as VenuePlace)) bad.push(`place (${VENUE_PLACES.join(", ")}, or absent)`);
  if (bad.length > 0) {
    errors.push(`${where}${isStr(c.id) ? ` (${c.id})` : ""}: bad ${bad.join(", ")}`);
    return false;
  }
  return true;
}

/**
 * Checks a parsed JSON value against VenueMapData. Messages name ids, counts and field names
 * only (a back-of-house room's id carries its number or name slug, which is fine in the
 * organisers' terminal but never reaches the browser).
 */
export function validateVenueMap(json: unknown): VenueValidation {
  const errors: string[] = [];
  const routingErrors: string[] = [];
  const warnings: string[] = [];
  const santErrors: string[] = [];
  const santWarnings: string[] = [];
  const ruleErrors: string[] = [];
  const ruleWarnings: string[] = [];
  const fail = (): VenueValidation => ({ data: null, errors, routingErrors, warnings, santErrors, santWarnings, ruleErrors, ruleWarnings, rules: null });
  const unknown = new Set<string>();

  if (!isObj(json)) {
    errors.push("The file is not a JSON object");
    return fail();
  }
  if (json.version !== 1) errors.push(`version must be 1 (got ${JSON.stringify(json.version)})`);
  if (!isStr(json.generatedAt) || Number.isNaN(Date.parse(json.generatedAt))) errors.push("generatedAt must be an ISO time");
  if (!isStr(json.source) || !json.source.trim()) errors.push("source must be the blueprint's file name");
  else if (/[\\/]/.test(json.source)) errors.push("source must be a file name, not a path");
  if (!Array.isArray(json.levels) || json.levels.length === 0) {
    errors.push("levels must be a non-empty array");
    return fail();
  }
  if (!Array.isArray(json.connectors)) errors.push("connectors must be an array");
  noteUnknown(json, "", unknown);

  const levelIds = new Set<string>();
  const orders = new Set<number>();
  const roomIds = new Set<string>();
  const grids = new Map<string, VenueGrid>();

  json.levels.forEach((l: unknown, li: number) => {
    const where = `levels[${li}]`;
    if (!isObj(l)) {
      errors.push(`${where}: not an object`);
      return;
    }
    noteUnknown(l, "levels[]", unknown);
    noteUnknown(l.bounds, "levels[].bounds", unknown);
    noteUnknown(l.grid, "levels[].grid", unknown);
    noteUnknown(l.santGrid, "levels[].santGrid", unknown);
    const id = l.id as VenueLevelId;
    if (!VENUE_LEVEL_IDS.includes(id)) {
      errors.push(`${where}: id must be one of ${VENUE_LEVEL_IDS.join(", ")}`);
      return;
    }
    if (levelIds.has(id)) errors.push(`${where}: level "${id}" is listed twice`);
    levelIds.add(id);
    if (!isStr(l.name) || !l.name.trim()) errors.push(`${where} (${id}): name is missing`);
    if (!Number.isInteger(l.order)) errors.push(`${where} (${id}): order must be a whole number`);
    else if (orders.has(l.order as number)) errors.push(`${where} (${id}): order ${l.order} is used twice`);
    else orders.add(l.order as number);
    const b = l.bounds;
    if (!isObj(b) || !isNum(b.x) || !isNum(b.y) || !isNum(b.width) || !isNum(b.height) || b.width <= 0 || b.height <= 0) {
      errors.push(`${where} (${id}): bounds need finite x, y and positive width, height`);
    }
    if (!isStr(l.walls)) errors.push(`${where} (${id}): walls must be SVG path data`);
    else if (l.walls.length > MAX_WALLS_CHARS) errors.push(`${where} (${id}): walls path is too long`);
    else if (/[^MmLlHhVvCcSsQqTtAaZz0-9eE.,+\-\s]/.test(l.walls)) errors.push(`${where} (${id}): walls has characters that aren't path data`);
    if (checkGrid(l.grid, `${where} (${id})`, errors)) grids.set(id, l.grid as VenueGrid);
    if (!Array.isArray(l.rooms)) {
      errors.push(`${where} (${id}): rooms must be an array`);
      return;
    }
    if (l.rooms.length > MAX_ROOMS_PER_LEVEL) errors.push(`${where} (${id}): too many rooms (${l.rooms.length})`);
    l.rooms.forEach((r: unknown, ri: number) => {
      const rw = `${where}.rooms[${ri}]`;
      noteUnknown(r, "levels[].rooms[]", unknown);
      if (isObj(r) && Array.isArray(r.doors)) for (const d of r.doors) noteUnknown(d, "levels[].rooms[].doors[]", unknown);
      if (!checkRoom(r, id, rw, errors)) return;
      if (roomIds.has(r.id)) errors.push(`${rw}: room id "${r.id}" is used twice`);
      roomIds.add(r.id);
    });
  });

  const connectorIds = new Set<string>();
  if (Array.isArray(json.connectors)) {
    json.connectors.forEach((c: unknown, ci: number) => {
      const where = `connectors[${ci}]`;
      noteUnknown(c, "connectors[]", unknown);
      if (!checkConnector(c, levelIds, where, errors)) return;
      if (connectorIds.has(c.id)) errors.push(`${where}: connector id "${c.id}" is used twice`);
      connectorIds.add(c.id);
    });
  }

  if (unknown.size > 0) {
    warnings.push(`Fields VenueMapData doesn't have (never sent to the browser): ${[...unknown].sort().join(", ")}`);
  }
  if (errors.length > 0) return fail();
  const data = json as unknown as VenueMapData;

  // Height order: B < 1 < 2 < M (the mezzanine on top), whichever of them the map has.
  const byOrder = data.levels.slice().sort((a, b) => a.order - b.order).map((l) => l.id);
  const expected = VENUE_LEVEL_IDS.filter((id) => byOrder.includes(id));
  if (byOrder.join() !== expected.join()) {
    routingErrors.push(
      `Levels by order (bottom to top) are ${byOrder.join(" < ")}; they must be ${expected.join(" < ")} (the mezzanine is the top floor): re-run scripts/venue/extract.py`,
    );
  }

  // Walkability: connector landings must be on a walkable cell of their level.
  const walk = new Map<string, Uint8Array>();
  for (const [id, g] of grids) walk.set(id, decodeWalkable(g)!);
  const onWalkable = (level: VenueLevelId, p: VenuePoint) => {
    const g = grids.get(level)!;
    const cell = cellAt(g, p);
    return cell !== null && walk.get(level)![cell.r * g.cols + cell.c] === 1;
  };
  for (const c of data.connectors) {
    for (const [lvl, p] of Object.entries(c.points) as [VenueLevelId, VenuePoint][]) {
      if (!onWalkable(lvl, p)) routingErrors.push(`${c.id}: its landing on level ${lvl} is not on a walkable cell`);
    }
  }
  for (const l of data.levels) {
    let unreachable = 0;
    let offGrid = 0;
    let hidden = 0;
    for (const r of l.rooms) {
      // Staff only: no way in, and no floor (a cell inside it would let a route cross it).
      if (r.closed && r.public) {
        if (r.entry) routingErrors.push(`${r.id}: a staff-only (closed) room has an entry`);
        const cells = walkableCellsIn(grids.get(l.id)!, walk.get(l.id)!, r.polygon);
        if (cells > 0) routingErrors.push(`${r.id}: a staff-only (closed) room has ${cells} walkable cell(s) inside it`);
        continue;
      }
      if (r.closed) hidden++;
      if (!r.public || r.kind === "corridor") continue;
      if (!r.entry) unreachable++;
      else if (!onWalkable(l.id, r.entry)) offGrid++;
    }
    if (unreachable > 0) warnings.push(`Level ${l.id}: ${unreachable} public room(s) have no entry (shown, but no directions)`);
    if (offGrid > 0) warnings.push(`Level ${l.id}: ${offGrid} public room entry point(s) are not on a walkable cell (the router snaps them)`);
    if (hidden > 0) warnings.push(`Level ${l.id}: ${hidden} room(s) are closed but not public (they stay plain blocks: closed means shown, staff only)`);
  }
  if (data.connectors.length === 0 && data.levels.length > 1) warnings.push("No stairs or elevators: no routes between levels");
  else {
    if (!data.connectors.some((c) => c.side)) {
      warnings.push("No stair or elevator has a side: Bhaio and Behno may use every one (re-run scripts/venue/extract.py)");
    }
    const unplaced = data.connectors.filter((c) => !c.place).length;
    if (unplaced > 0) {
      warnings.push(
        `${unplaced} of ${data.connectors.length} stairs / elevators have no place: directions call them "the stairs" / "the elevator" without saying which (re-run scripts/venue/extract.py)`,
      );
    }
  }

  checkSant(data, grids, walk, santErrors, santWarnings, routingErrors);
  checkDoors(data, ruleErrors);
  const checked = checkFlowRules((json as Obj).flowRules, data, (level) => walk.get(level) ?? null);
  ruleErrors.push(...checked.errors);
  ruleWarnings.push(...checked.warnings);
  const rules = ruleErrors.length > 0 ? null : checked.rules;
  return { data, errors, routingErrors, warnings, santErrors, santWarnings, ruleErrors, ruleWarnings, rules };
}

/**
 * Rooms' door openings (VenueRoom.doors): their shape only (checkFlowRules() checks that the doors a
 * rule names are openings on the grid). Problems go in `ruleErrors`: doors are there for the rules.
 */
function checkDoors(data: VenueMapData, ruleErrors: string[]) {
  for (const l of data.levels) {
    for (const r of l.rooms) {
      const doors = (r as unknown as Obj).doors;
      if (doors === undefined) continue;
      if (!Array.isArray(doors)) {
        ruleErrors.push(`${r.id}: doors must be a list`);
        continue;
      }
      const ids = new Set<string>();
      doors.forEach((d: unknown, i: number) => {
        const ok =
          isObj(d) &&
          isStr(d.id) &&
          d.id.startsWith(`${r.id}:`) &&
          isPoint(d.at) &&
          isNum(d.width) &&
          d.width > 0 &&
          (d.to === null || (isStr(d.to) && d.to.trim().length > 0));
        if (!ok) {
          ruleErrors.push(`${r.id}: doors[${i}] needs an id "${r.id}:<side><n>", a point "at", a width > 0 and "to" (a room id or null)`);
          return;
        }
        const id = (d as Obj).id as string;
        if (ids.has(id)) ruleErrors.push(`${r.id}: door id ${id} is used twice`);
        ids.add(id);
      });
    }
  }
}

const SHAFT_KINDS: ReadonlySet<VenueRoomKind> = new Set(["stair", "elevator"]);
/** The deities' rooms and the altar: never shown to santos (scripts/venue/extract.py DEITY_ROOMS). */
const DEITY_ROOM = /^(?:deit(?:y|ies)|altar)\b/i;

/**
 * The Pujya Santo view's extras (see the file comment). Only here are `sant`, `santEntry`,
 * `santGrid` and `santPoints` read (checkRoom() / checkConnector() never look at them), so their
 * shape and meaning problems all land in `santErrors`; the delegates' grid reaching into a room
 * only santos are shown also adds one id-free routing error.
 */
function checkSant(
  data: VenueMapData,
  grids: Map<string, VenueGrid>,
  walk: Map<string, Uint8Array>,
  santErrors: string[],
  santWarnings: string[],
  routingErrors: string[],
) {
  const santGrids = new Map<string, { grid: VenueGrid; walk: Uint8Array }>();
  let leaking = 0;
  for (const l of data.levels) {
    const raw = l as unknown as Obj;
    const grid = grids.get(l.id)!;
    const delegates = walk.get(l.id)!;
    if (raw.santGrid !== undefined) {
      const shape: string[] = [];
      if (!checkGrid(raw.santGrid, `Level ${l.id} santGrid`, shape)) {
        santErrors.push(...shape);
      } else {
        const sg = raw.santGrid;
        if (
          sg.cell !== grid.cell ||
          sg.cols !== grid.cols ||
          sg.rows !== grid.rows ||
          sg.origin[0] !== grid.origin[0] ||
          sg.origin[1] !== grid.origin[1]
        ) {
          santErrors.push(`Level ${l.id}: santGrid is not in the grid's frame (its cell, cols, rows and origin must be the grid's)`);
        } else {
          santGrids.set(l.id, { grid: sg, walk: decodeWalkable(sg)! });
        }
      }
    }
    const sw = santGrids.get(l.id);
    if (sw) {
      let missing = 0;
      for (let i = 0; i < delegates.length; i++) if (delegates[i] === 1 && sw.walk[i] !== 1) missing++;
      if (missing > 0) santErrors.push(`Level ${l.id}: ${missing} walkable cell(s) of the grid aren't walkable in santGrid`);
    }
    let santRooms = 0;
    let nonShaft = 0;
    for (const r of l.rooms) {
      const rr = r as unknown as Obj;
      if (rr.sant === undefined) {
        if (rr.santEntry !== undefined) santErrors.push(`${r.id}: santEntry without sant`);
        // The santos' floor never reaches into a private room santos aren't shown, or a staff-only one.
        if (sw && (!r.public || r.closed)) {
          const n = walkableCellsIn(sw.grid, sw.walk, r.polygon);
          if (n > 0) santErrors.push(`${r.id}: santGrid has ${n} walkable cell(s) inside this ${r.closed ? "staff-only" : "private"} room`);
        }
        continue;
      }
      santRooms++;
      if (!VENUE_SANT_CLASSES.includes(rr.sant as VenueSantClass)) {
        santErrors.push(`${r.id}: sant must be one of ${VENUE_SANT_CLASSES.join(", ")}`);
        continue;
      }
      if (!SHAFT_KINDS.has(r.kind)) nonShaft++;
      if (r.public || r.closed) santErrors.push(`${r.id}: sant on a ${r.closed ? "staff-only" : "public"} room`);
      if (DEITY_ROOM.test(r.name.trim())) santErrors.push(`${r.id}: a deity room or the altar is never shown to santos`);
      const se = rr.santEntry;
      if (!(se === undefined || se === null || isPoint(se))) {
        santErrors.push(`${r.id}: santEntry must be a finite point, null or absent`);
      } else if (isPoint(se)) {
        const on = sw ?? { grid, walk: delegates };
        const cell = cellAt(on.grid, se);
        if (!cell || on.walk[cell.r * on.grid.cols + cell.c] !== 1) santWarnings.push(`${r.id}: santEntry is not on a walkable cell of santGrid`);
      } else if (r.kind !== "corridor") {
        santWarnings.push(`${r.id}: a santos-only room without a santEntry (no directions to it)`);
      }
      // The delegates' floor never reaches into a room only santos are shown.
      const inside = walkableCellsIn(grid, delegates, r.polygon);
      if (inside > 0) {
        leaking++;
        santErrors.push(`${r.id}: the grid (the delegates' floor) has ${inside} walkable cell(s) inside this santos-only room`);
      }
    }
    if (nonShaft > 0 && !sw) santErrors.push(`Level ${l.id}: santos-only rooms but no (valid) santGrid`);
    if (raw.santGrid !== undefined && santRooms === 0) santWarnings.push(`Level ${l.id}: a santGrid but no santos-only rooms`);
  }
  if (leaking > 0) {
    routingErrors.push(
      `The delegates' walkable floor reaches into ${leaking} room(s) only the Pujya Santo view shows: re-run scripts/venue/extract.py`,
    );
  }

  const levelIds = new Set<string>(data.levels.map((l) => l.id));
  for (const c of data.connectors) {
    const sp = (c as unknown as Obj).santPoints;
    if (sp === undefined) continue;
    if (!isObj(sp)) {
      santErrors.push(`${c.id}: santPoints must be an object of level -> point`);
      continue;
    }
    for (const [lvl, p] of Object.entries(sp)) {
      if (!levelIds.has(lvl)) santErrors.push(`${c.id}: santPoints.${lvl} (no such level)`);
      else if (!isPoint(p)) santErrors.push(`${c.id}: santPoints.${lvl} is not a finite point`);
      else if (c.points[lvl as VenueLevelId]) santErrors.push(`${c.id}: santPoints.${lvl} repeats a level of points`);
      else {
        const on = santGrids.get(lvl) ?? { grid: grids.get(lvl)!, walk: walk.get(lvl)! };
        const cell = cellAt(on.grid, p);
        if (!cell || on.walk[cell.r * on.grid.cols + cell.c] !== 1) {
          santErrors.push(`${c.id}: its santo landing on level ${lvl} is not on a walkable cell of santGrid`);
        }
      }
    }
  }
  // A shaft room only santos are shown: its connector lands there for santos.
  for (const l of data.levels) {
    for (const r of l.rooms) {
      if (r.sant === undefined || !SHAFT_KINDS.has(r.kind)) continue;
      const c = data.connectors.find((x) => `${l.id}-${x.id}` === r.id);
      if (!c?.santPoints?.[l.id]) santWarnings.push(`${r.id}: a santos-only stair / elevator room whose connector has no santo landing on level ${l.id}`);
    }
  }
}

/** How many walkable cells have their centre inside an outline. */
function walkableCellsIn(grid: VenueGrid, walk: Uint8Array, polygon: VenuePoint[]): number {
  const pts = polygon.flat();
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of polygon) {
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  }
  const c0 = Math.max(0, Math.floor((x0 - grid.origin[0]) / grid.cell));
  const c1 = Math.min(grid.cols - 1, Math.floor((x1 - grid.origin[0]) / grid.cell));
  const r0 = Math.max(0, Math.floor((y0 - grid.origin[1]) / grid.cell));
  const r1 = Math.min(grid.rows - 1, Math.floor((y1 - grid.origin[1]) / grid.cell));
  let n = 0;
  for (let r = r0; r <= r1; r++) {
    const y = grid.origin[1] + (r + 0.5) * grid.cell;
    for (let c = c0; c <= c1; c++) {
      if (walk[r * grid.cols + c] === 1 && pointInPolygon(pts, grid.origin[0] + (c + 0.5) * grid.cell, y)) n++;
    }
  }
  return n;
}

/** Counts for the import's printout: never names. */
export function venueCounts(data: VenueMapData) {
  return data.levels
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((l: VenueLevel) => {
      const pub = l.rooms.filter((r) => r.public);
      const staffOnly = pub.filter((r) => r.closed).length;
      const walkable = decodeWalkable(l.grid);
      let open = 0;
      if (walkable) for (let i = 0; i < walkable.length; i++) open += walkable[i];
      // The Pujya Santo view's extras (counts only).
      const santRooms: Record<VenueSantClass, number> = { own: 0, shared: 0, way: 0 };
      let santWithEntry = 0;
      for (const r of l.rooms) {
        if (!r.sant || !VENUE_SANT_CLASSES.includes(r.sant)) continue;
        santRooms[r.sant]++;
        if (r.santEntry) santWithEntry++;
      }
      const santWalk = l.santGrid ? decodeWalkable(l.santGrid) : null;
      let santOnlyCells = 0;
      if (santWalk && walkable && santWalk.length === walkable.length) {
        for (let i = 0; i < santWalk.length; i++) if (santWalk[i] && !walkable[i]) santOnlyCells++;
      }
      return {
        level: l.id,
        name: l.name,
        rooms: l.rooms.length,
        publicRooms: pub.length,
        /** Of the public rooms: staff only (closed), shown without directions. */
        staffOnly,
        backOfHouse: l.rooms.length - pub.length,
        withEntry: pub.filter((r) => r.entry).length,
        grid: `${l.grid.cols}x${l.grid.rows} @ ${l.grid.cell}`,
        walkableCells: open,
        wallsChars: l.walls.length,
        santRooms,
        santWithEntry,
        santOnlyCells,
      };
    });
}
