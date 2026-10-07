/**
 * Import the venue map (the JSON scripts/venue/extract.py makes from the organisers' blueprint)
 * into `venue_maps`, row "current". The JSON is read at run time and never copied into the repo:
 * keep it (and the blueprint) outside it.
 *
 *   npm run venue:import -- --file "<venue-map.json>" --plan      # check the file, no database
 *   npm run venue:import -- --file ... --dry-run                   # compare with the database; write nothing
 *   npm run venue:import -- --file ... --apply                     # write, in one transaction
 *   npm run venue:import:lightsail -- --file ... --dry-run|--apply # the shared Lightsail database
 *
 * Exactly one mode is required; any other or misspelt argument stops the script before it reads
 * anything. The file must be outside the repo. Every check is in src/lib/venue/validate.ts: the
 * shape (levels, rooms, connectors, grids), unique ids, finite points, and every stair / elevator
 * landing on a walkable cell, levels ordered B < 1 < 2 < M (the mezzanine on top), no staff-only
 * (closed) room with an entry or walkable floor; any problem stops --dry-run and --apply. The
 * printout is counts, names the Hub already shows and map ids, never the blueprint's room
 * descriptions:
 *  - per level, bottom to top: rooms, public / staff-only / back-of-house, grid;
 *  - every stair / elevator by its id (the blueprint's number: for this terminal only, guests
 *    never see it) with the floors it serves, its place (foyer / side / back: how guests are told
 *    which one, "the foyer stairs") and its side (Bhaio right, Behno left: who may use it,
 *    src/lib/venue/route.ts);
 *  - the organisers' team names (VENUE_ROOM_NAMES in src/lib/venue/aliasTable.ts): how many rooms
 *    carry one and which keep the blueprint's name. A name for an id that isn't a public room on
 *    this map (back-of-house, private quarters, a stair, or not on the map) is an ERROR: it stops
 *    every mode, since the table and the map disagree (such a name is never sent either way);
 *  - the event room names (VENUE_ALIASES): mapped / tentative (VENUE_ALIAS_TENTATIVE, with what
 *    is assumed) / null, and any id that isn't a public room or is staff only (listed, not fatal:
 *    an unmapped name keeps working as "not on the map yet");
 *  - the room names the Hub uses, checked against the table and this map: the team breakouts
 *    (prisma/breakouts-data.ts, each for its track), the schedule's places (prisma/seed.ts, read
 *    as text) and, with a database (--dry-run / --apply; counts only), the goshthi rooms
 *    (users.goshthi_room, read only);
 *  - the Pujya Santo view's extras (the sadhus' residence: `sant`, `santEntry`, `santGrid`,
 *    `santPoints`; src/lib/venue/types.ts), when the map has them: their problems (validate.ts
 *    santErrors, with ids: this terminal only) stop every mode; rooms by class, entries, santo-only
 *    cells and landings; SANT_ROOM_NAMES against them (an own room without a name, a name for
 *    anything else, an id in both name tables, an event name mapped to a residence room: each stops
 *    every mode); and the route check (scripts/venue-route-check.ts: santos' public trips are the
 *    delegates', every residence room routes both ways without crossing a room it may not), whose
 *    errors stop every mode;
 *  - the flow rules (the organisers' flow maps; src/lib/venue/flowRules.ts), merged into the stored
 *    map from a rules file outside the repo: --rules <file>, else flow-rules.json beside the map file
 *    or in its parent folder (--no-rules: none). Printed by kind with counts, each with the rooms,
 *    doors and stairs it names (ids); any problem (an unknown kind, a room / door / stair this map
 *    doesn't have: validate.ts ruleErrors) stops every mode. With --flows <file> (the organisers'
 *    drawn trips, outside the repo) the flow check (scripts/venue-flow-check.ts) runs: counts per
 *    class and group and the ids of trips that don't match the app's routes (and, against --compare,
 *    the regressions), at each trip's time and again with the rules a few minutes earlier (on the
 *    way: a window must cover the walk); without --flows a line says the rules weren't checked.
 *    The doors the rules name are compared with the same door ids in --compare and (--dry-run /
 *    --apply) the stored row: one that moved more than a grid cell or leads into another room (a
 *    re-extraction renumbered a room's doors) stops --dry-run / --apply unless --doors-checked;
 *  - what delegates get, compared (--compare <file>, in any mode; with --dry-run / --apply also the
 *    stored row): the map apart from the santo extras (the flow rules included), and the delegates'
 *    payload (toClientVenue(), what /map and /breakouts send) apart from generatedAt. Any
 *    difference stops --dry-run and --apply (nothing is written) unless --delegates-change says it
 *    is meant.
 *   --env <file>          DATABASE_URL from another dotenv file.
 *   --rules <file>        the flow rules to merge (outside the repo); default: flow-rules.json beside
 *                         the map file, else in its parent folder.
 *   --no-rules            store the map without flow rules.
 *   --flows <file>        the organisers' flows, matched onto the map (outside the repo): run the flow check.
 *   --compare <file>      another venue-map.json (outside the repo) to compare with, e.g. the one
 *                         imported last.
 *   --delegates-change    a difference in what delegates get is meant (a new extraction of the
 *                         organisers' plans, new flow rules): go ahead.
 *   --doors-checked       the doors the rules name that moved or lead elsewhere (above) were checked
 *                         against report.json's door_openings and still mean what the rules meant.
 * Runs with scripts/tsconfig.server-only.json (the npm scripts pass it), which lets tsx load the
 * server-only alias table.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type { Prisma, PrismaClient } from "@prisma/client";
import { BREAKOUT_SESSIONS } from "../prisma/breakouts-data";
import { OFF_SITE_PLACE } from "../src/lib/travel";
import { decodeWalkable, validateVenueMap, venueCounts } from "../src/lib/venue/validate";
import { checkSantoRoutes } from "./venue-route-check";
import { WALK_LEAD_MIN, checkFlows, flowSummary, readFlows, type FlowResult } from "./venue-flow-check";
import { doorsNamed } from "../src/lib/venue/flowRules";
import {
  aliasCoverage,
  buildVenueIndex,
  normalizeVenueName,
  resolveVenueRoom,
  splitVenueNames,
  type VenueIndex,
} from "../src/lib/venue/aliases";
import { hasSantExtras, isSantRoom, santNameProblems, toClientVenue } from "../src/lib/venue/clientVenue";
import { listedRooms } from "../src/lib/venue/directions";
import { ELEVATORS_FOLLOW_SIDE, TRACK_SIDE, connectorUsable } from "../src/lib/venue/route";
import { connectorPhrase } from "../src/lib/venue/view";
import { SANT_ROOM_NAMES, VENUE_ALIASES, VENUE_ALIAS_ENTRIES, VENUE_ALIAS_TENTATIVE, VENUE_ROOM_NAMES } from "../src/lib/venue/aliasTable";
import type { VenueFlowRule, VenueLevelId, VenueMapData, VenueTrack } from "../src/lib/venue/types";

const USAGE =
  "Usage: npm run venue:import -- --file <venue-map.json> [--env <file>] [--rules <flow-rules.json> | --no-rules] [--flows <flows.json>] [--compare <venue-map.json>] [--delegates-change] [--doors-checked] (--plan | --dry-run | --apply)";

class UsageError extends Error {}

type Mode = "plan" | "dry-run" | "apply";
const MODES: readonly string[] = ["plan", "dry-run", "apply"] satisfies Mode[];
const VALUE_OPTIONS: readonly string[] = ["file", "env", "compare", "rules", "flows"];
const FLAGS: readonly string[] = ["delegates-change", "no-rules", "doors-checked"];

function parseArgs(argv: string[]): { mode: Mode; args: Record<string, string>; flags: Set<string> } {
  const args: Record<string, string> = {};
  const flags = new Set<string>();
  const modes: Mode[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) throw new UsageError(`Unexpected argument "${a}"`);
    const key = a.slice(2);
    if (MODES.includes(key)) {
      modes.push(key as Mode);
      continue;
    }
    if (FLAGS.includes(key)) {
      if (flags.has(key)) throw new UsageError(`${a} is given more than once`);
      flags.add(key);
      continue;
    }
    if (!VALUE_OPTIONS.includes(key)) throw new UsageError(`Unknown option "${a}"`);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) throw new UsageError(`${a} needs a value`);
    if (args[key] !== undefined) throw new UsageError(`${a} is given more than once`);
    args[key] = value;
    i++;
  }
  if (modes.length !== 1) {
    throw new UsageError(
      modes.length === 0 ? "Choose a mode: --plan, --dry-run or --apply" : `Choose one mode, not ${modes.map((m) => `--${m}`).join(" and ")}`,
    );
  }
  if (!args.file) throw new UsageError('Missing --file "<path to venue-map.json>"');
  if (args.env && modes[0] === "plan") throw new UsageError("--env does nothing with --plan (no database)");
  if (args.rules && flags.has("no-rules")) throw new UsageError("Choose --rules <file> or --no-rules, not both");
  return { mode: modes[0], args, flags };
}

function loadEnvFile(path: string) {
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let value = m[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[m[1]] = value;
  }
}

/** The blueprint's geometry stays out of the repo: refuse a file inside it. */
function assertOutsideRepo(file: string, flag = "--file") {
  const repo = resolve(__dirname, "..");
  const rel = relative(repo, resolve(file));
  if (!(rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel))) {
    throw new Error(`${flag} ${file} is inside the repo; the venue map is derived from the blueprint, keep it outside (e.g. a temp folder)`);
  }
}

/**
 * The flow rules to merge: --rules <file>, else flow-rules.json beside the map file or in its parent
 * folder; none with --no-rules or when there is no such file. A rules file is a list of rules or
 * { rules: [...] } (anything else in it, e.g. an "about" note, stays in the file).
 */
function readRules(mapFile: string, rulesFile: string | undefined, none: boolean): { rules: unknown[] | null; from: string | null } {
  if (none) return { rules: null, from: null };
  const candidates = rulesFile
    ? [rulesFile]
    : [resolve(dirname(mapFile), "flow-rules.json"), resolve(dirname(mapFile), "..", "flow-rules.json")].filter((f) => existsSync(f));
  const from = candidates[0];
  if (!from) return { rules: null, from: null };
  assertOutsideRepo(from, "--rules");
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(from, "utf8"));
  } catch (e) {
    throw new Error(`${basename(from)} is not valid JSON: ${e instanceof Error ? e.message : e}`);
  }
  const rules = Array.isArray(json) ? json : (json as { rules?: unknown })?.rules;
  if (!Array.isArray(rules)) throw new Error(`${from}: expected a list of rules, or { "rules": [...] }`);
  return { rules, from };
}

function readVenue(
  file: string,
  flag = "--file",
  quiet = false,
  rules: unknown[] | null = null,
): { data: VenueMapData; bytes: number; ruleWarnings: string[] } {
  assertOutsideRepo(file, flag);
  const bytes = statSync(file).size;
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    throw new Error(`${basename(file)} is not valid JSON: ${e instanceof Error ? e.message : e}`);
  }
  // The flow rules are stored with the map (they replace any the file carries).
  if (rules && json && typeof json === "object" && !Array.isArray(json)) json = { ...(json as Record<string, unknown>), flowRules: rules };
  const v = validateVenueMap(json);
  const problems = [...v.errors, ...v.routingErrors];
  if (!quiet) for (const w of v.warnings) console.log(`  ~ ${w}`);
  if (!v.data || problems.length > 0) {
    console.log(`${problems.length} problem(s)${quiet ? ` in ${flag} ${basename(file)}` : ""}:`);
    for (const p of problems.slice(0, 40)) console.log(`  ! ${p}`);
    if (problems.length > 40) console.log(`  ... and ${problems.length - 40} more`);
    throw new Error("The venue map has problems (above): nothing was written.");
  }
  // The Pujya Santo view's extras: their problems stop every mode (ids: this terminal only).
  if (!quiet && (v.santErrors.length > 0 || v.santWarnings.length > 0)) {
    console.log("  Santo extras (the Pujya Santo view's residence):");
    for (const w of v.santWarnings) console.log(`    ~ ${w}`);
    for (const e of v.santErrors.slice(0, 40)) console.log(`    ! ${e}`);
    if (v.santErrors.length > 40) console.log(`    ... and ${v.santErrors.length - 40} more`);
  }
  if (!quiet && v.santErrors.length > 0) {
    throw new Error(`The Pujya Santo view's extras have ${v.santErrors.length} problem(s) (above): nothing was written.`);
  }
  // The flow rules (and the doors they name): any problem stops every mode (ids: this terminal only).
  if (!quiet && v.ruleErrors.length > 0) {
    console.log("  Flow rules:");
    for (const e of v.ruleErrors.slice(0, 40)) console.log(`    ! ${e}`);
    if (v.ruleErrors.length > 40) console.log(`    ... and ${v.ruleErrors.length - 40} more`);
    if (!v.data.levels.some((l) => l.rooms.some((r) => (r.doors ?? []).length > 0))) {
      console.log("    This map has no door ids (extracted before 2026-10-04): to import it without flow rules (a rollback), give --no-rules.");
    }
    throw new Error(`The flow rules have ${v.ruleErrors.length} problem(s) (above): nothing was written.`);
  }
  return { data: v.data, bytes, ruleWarnings: v.ruleWarnings };
}

/** The flow rules by kind, each with what it names (ids only; notes stay in the rules file). */
function printRules(data: VenueMapData, from: string | null, warnings: string[]) {
  const rules: VenueFlowRule[] = data.flowRules ?? [];
  console.log(
    `  Flow rules (the organisers' flow maps): ${from ? `${rules.length} from ${from}` : "none (no flow-rules.json beside the map or in its parent folder; --rules <file> names one)"}`,
  );
  for (const w of warnings) console.log(`    ~ ${w}`);
  if (rules.length === 0) return;
  const doors = new Map(data.levels.flatMap((l) => l.rooms.flatMap((r) => (r.doors ?? []).map((d) => [d.id, d] as const))));
  const door = (id: string) => {
    const d = doors.get(id);
    return d ? `${id} (to ${d.to ?? "-"}, ${Math.round(d.width / 9)} ft)` : id;
  };
  const kinds = ["doors", "stairs", "avoid", "passage", "side", "route"] as const;
  console.log(`    by kind: ${kinds.map((k) => `${k} ${rules.filter((r) => r.kind === k).length}`).join(", ")}`);
  for (const k of kinds) {
    for (const r of rules.filter((x) => x.kind === k)) {
      const when = r.window ? ` ${r.window.day} ${r.window.from}-${r.window.to}` : "";
      const what =
        r.kind === "doors"
          ? `${r.room}${r.exits ? `; leave by ${r.exits.map(door).join(", ")}` : ""}${r.entries ? `; enter by ${r.entries.map(door).join(", ")}` : ""}`
          : r.kind === "stairs"
            ? `trips to / from ${r.rooms.join(", ")} change floor by ${r.connectors.join(", ")}`
            : r.kind === "avoid" || r.kind === "passage"
              ? r.rooms.join(", ")
              : r.kind === "side"
                ? `may use ${r.connectors.join(", ")}`
                : `${r.from} -> ${r.to} via ${r.via.map((w) => ("door" in w ? door(w.door) : "connector" in w ? `${w.connector} ${w.from}>${w.to}` : `a point on ${w.level}`)).join(", ")}`;
      console.log(`    ${k.padEnd(7)} ${r.track.padEnd(5)}${when.padEnd(23)} ${r.id}: ${what}`);
    }
  }
}

/** JSON with every object's keys sorted (jsonb stores them in its own order). */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
}

/** The map without generatedAt and the Pujya Santo view's extras (the flow rules kept): what everything but santos is built from. */
function withoutSantExtras(data: VenueMapData): unknown {
  return {
    ...data,
    generatedAt: undefined,
    levels: data.levels.map(({ santGrid: _g, ...l }) => ({ ...l, rooms: l.rooms.map(({ sant: _s, santEntry: _e, ...r }) => r) })),
    connectors: data.connectors.map(({ santPoints: _p, ...c }) => c),
  };
}

/** Where two parsed JSON values differ: up to `max` paths. */
function diffPaths(a: unknown, b: unknown, path: string, out: string[], max = 8): void {
  if (out.length >= max || canonical(a) === canonical(b)) return;
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) {
    a.forEach((x, i) => diffPaths(x, b[i], `${path}[${i}]`, out, max));
    return;
  }
  if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
    for (const k of keys) diffPaths((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], path ? `${path}.${k}` : k, out, max);
    return;
  }
  out.push(path || "(root)");
}

/**
 * Compares what delegates get from `next` with `prev`: the map apart from the santo extras, and the
 * delegates' payload (toClientVenue()) apart from generatedAt. Prints both; true when they differ.
 */
function compareMaps(next: VenueMapData, prev: VenueMapData, against: string): boolean {
  console.log(`  Against ${against} (generated ${prev.generatedAt}):`);
  const rawA = withoutSantExtras(next);
  const rawB = withoutSantExtras(prev);
  const rawSame = canonical(rawA) === canonical(rawB);
  const paths: string[] = [];
  if (!rawSame) diffPaths(rawA, rawB, "", paths);
  console.log(`    Apart from the Santo extras, the map: ${rawSame ? "identical" : `differs (first: ${paths.join(", ")})`}`);
  // The flow rules: they change delegates' routes, not the payload.
  const ra = new Map((next.flowRules ?? []).map((r) => [r.id, canonical(r)]));
  const rb = new Map((prev.flowRules ?? []).map((r) => [r.id, canonical(r)]));
  const rAdded = [...ra.keys()].filter((id) => !rb.has(id));
  const rRemoved = [...rb.keys()].filter((id) => !ra.has(id));
  const rChanged = [...ra.keys()].filter((id) => rb.has(id) && ra.get(id) !== rb.get(id));
  console.log(
    rAdded.length + rRemoved.length + rChanged.length === 0
      ? `    Flow rules: ${ra.size === 0 ? "none in either" : "the same"}`
      : `    Flow rules (delegates' routes follow them): ${rAdded.length} added${rAdded.length ? ` (${list(rAdded)})` : ""}, ${rRemoved.length} removed${rRemoved.length ? ` (${list(rRemoved)})` : ""}, ${rChanged.length} changed${rChanged.length ? ` (${list(rChanged)})` : ""}`,
  );
  const gA = { ...toClientVenue(next), generatedAt: undefined };
  const gB = { ...toClientVenue(prev), generatedAt: undefined };
  const guestSame = canonical(gA) === canonical(gB);
  if (guestSame) {
    console.log("    What delegates get (/map, /breakouts): identical apart from generatedAt");
    return !rawSame;
  }
  console.log("    What delegates get (/map, /breakouts): differs:");
  for (const la of gA.levels) {
    const lb = gB.levels.find((l) => l.id === la.id);
    if (!lb) {
      console.log(`      level ${la.id}: new`);
      continue;
    }
    const ra = new Map(la.rooms.map((r) => [r.id, r]));
    const rb = new Map(lb.rooms.map((r) => [r.id, r]));
    const added = [...ra.keys()].filter((id) => !rb.has(id));
    const removed = [...rb.keys()].filter((id) => !ra.has(id));
    // Each changed room with the fields that changed (pts = its outline).
    const changed = [...ra.keys()].flatMap((id) => {
      const a = ra.get(id) as unknown as Record<string, unknown>;
      const b = rb.get(id) as unknown as Record<string, unknown> | undefined;
      if (!b || canonical(a) === canonical(b)) return [];
      const fields = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => canonical(a[k]) !== canonical(b[k]));
      return [`${id} (${fields.join(", ")})`];
    });
    const parts = [
      added.length ? `rooms added ${list(added)}` : "",
      removed.length ? `rooms removed ${list(removed)}` : "",
      changed.length ? `rooms changed ${list(changed)}` : "",
      canonical(la.blocks) !== canonical(lb.blocks) ? `blocks ${lb.blocks.length} -> ${la.blocks.length}` : "",
      canonical(la.grid) !== canonical(lb.grid) ? `grid changed (${gridDiff(la.grid, lb.grid)})` : "",
      la.walls !== lb.walls ? "walls changed" : "",
      canonical(la.bounds) !== canonical(lb.bounds) ? "bounds changed" : "",
    ].filter(Boolean);
    if (parts.length) console.log(`      level ${la.id}: ${parts.join("; ")}`);
  }
  const cB = new Map(gB.connectors.map((c) => [c.id, c]));
  const cChanged = gA.connectors.flatMap((c) => {
    const b = cB.get(c.id);
    if (b && canonical(b) === canonical(c)) return [];
    if (!b) return [`${c.id} (new)`];
    const levels = [...new Set([...Object.keys(c.points), ...Object.keys(b.points)])].filter(
      (l) => canonical(c.points[l as VenueLevelId]) !== canonical(b.points[l as VenueLevelId]),
    );
    return [`${c.id} (landing ${levels.map((l) => `${l}: ${b.points[l as VenueLevelId] ? (c.points[l as VenueLevelId] ? "moved" : "removed") : "added"}`).join(", ")})`];
  });
  const cGone = [...cB.keys()].filter((id) => !gA.connectors.some((c) => c.id === id)).map((id) => `${id} (gone)`);
  if (cChanged.length || cGone.length) console.log(`      connectors changed: ${list([...cChanged, ...cGone])}`);
  return true;
}

/**
 * The doors the flow rules name, against another extraction of the building (--compare, or the
 * stored row). A door id is its room's side and its number along it, so a re-extraction that adds,
 * splits or merges an opening on that side renumbers the ones after it, and a rule would quietly
 * name another door. Each named door that moved more than a grid cell or now leads into another room
 * is returned as an error (ids and units only); a map without door ids (extracted before
 * 2026-10-04) is not compared.
 */
function checkRuleDoors(next: VenueMapData, prev: VenueMapData, against: string): string[] {
  const named = doorsNamed(next.flowRules);
  if (named.size === 0) return [];
  const doorsOf = (d: VenueMapData) =>
    new Map(d.levels.flatMap((l) => l.rooms.flatMap((r) => (r.doors ?? []).map((x) => [x.id, { door: x, cell: l.grid.cell }] as const))));
  const a = doorsOf(next);
  const b = doorsOf(prev);
  if (b.size === 0) {
    console.log(`    Doors the flow rules name: ${against} has no door ids (extracted before 2026-10-04), so they aren't compared`);
    return [];
  }
  const errors: string[] = [];
  let same = 0;
  const missing: string[] = [];
  for (const [id, by] of [...named].sort(([x], [y]) => x.localeCompare(y))) {
    const x = a.get(id);
    const y = b.get(id);
    if (!x) continue; // not on this map: the rules' own check (validate.ts) already stops the import
    if (!y) {
      missing.push(id);
      continue;
    }
    const moved = Math.hypot(x.door.at[0] - y.door.at[0], x.door.at[1] - y.door.at[1]);
    const led = x.door.to !== y.door.to;
    if (moved > x.cell || led) {
      const what = [moved > x.cell ? `moved ${Math.round(moved)} units` : "", led ? `now leads to ${x.door.to ?? "no room"} (was ${y.door.to ?? "no room"})` : ""];
      errors.push(`${id} (named by ${by.join(", ")}): ${what.filter(Boolean).join(", ")} against ${against}`);
    } else same++;
  }
  console.log(
    `    Doors the flow rules name, against ${against}: ${same} the same` +
      `${missing.length ? `, ${missing.length} not in it (${list(missing)})` : ""}${errors.length ? `, ${errors.length} moved or leading elsewhere` : ""}`,
  );
  return errors;
}

/** How two grids of a level differ: cells opened / closed (same frame), else the frame. */
function gridDiff(a: VenueMapData["levels"][number]["grid"], b: VenueMapData["levels"][number]["grid"]): string {
  if (a.cols !== b.cols || a.rows !== b.rows || a.cell !== b.cell || a.origin[0] !== b.origin[0] || a.origin[1] !== b.origin[1]) {
    return "another frame";
  }
  const wa = decodeWalkable(a);
  const wb = decodeWalkable(b);
  if (!wa || !wb) return "unreadable";
  let opened = 0;
  let closed = 0;
  for (let i = 0; i < wa.length; i++) {
    if (wa[i] && !wb[i]) opened++;
    else if (!wa[i] && wb[i]) closed++;
  }
  return `${opened} cells now walkable, ${closed} no longer`;
}

/** "a, b, c", or "none". */
const list = (items: readonly string[]) => (items.length > 0 ? items.join(", ") : "none");

/**
 * The schedule's places, read from prisma/seed.ts as text (importing it would run the seed):
 * every `location: "..."` and `location: CONSTANT`, split into rooms ("A / B", "A · B"), without
 * places away from the mandir and the "By team" placeholder of the Team Breakouts slots.
 */
function seedPlaces(): string[] {
  const src = readFileSync(resolve(__dirname, "..", "prisma", "seed.ts"), "utf8");
  const consts = new Map([...src.matchAll(/^const\s+([A-Z][A-Z0-9_]*)\s*=\s*"([^"]*)";/gm)].map((m) => [m[1], m[2]]));
  const out = new Map<string, string>();
  for (const m of src.matchAll(/\blocation:\s*(?:"([^"]*)"|([A-Z][A-Z0-9_]*)\b)/g)) {
    const value = m[1] ?? consts.get(m[2]);
    if (!value || OFF_SITE_PLACE.test(value) || /^by team\b/i.test(value)) continue;
    for (const name of splitVenueNames(value).flatMap((n) => n.split(/\s+\/\s+/))) {
      const key = normalizeVenueName(name);
      if (key && !out.has(key)) out.set(key, name.trim());
    }
  }
  return [...out.values()];
}

/** How a set of room names the Hub uses stands against the alias table and this map. */
function checkNames(uses: { name: string; track: VenueTrack | null }[], index: VenueIndex) {
  const names = new Map<string, string>();
  const notInTable = new Set<string>();
  const notOnMap = new Set<string>();
  const staffOnly = new Set<string>();
  for (const u of uses) {
    const key = normalizeVenueName(u.name);
    if (!key) continue;
    if (!names.has(key)) names.set(key, u.name);
    const ids = resolveVenueRoom(u.name, index, u.track).roomIds;
    const shown = names.get(key)!;
    if (ids.length === 0) (index.aliases.has(key) ? notOnMap : notInTable).add(shown);
    else if (ids.every((id) => index.rooms.get(id)?.closed)) staffOnly.add(shown);
  }
  return { total: names.size, notInTable: [...notInTable], notOnMap: [...notOnMap], staffOnly: [...staffOnly] };
}

/**
 * The names: the organisers' team names and the event room names against this map, then the room
 * names the breakout data and the seed's schedule use. Returns the errors that stop the import (a
 * team name for a room that isn't public on this map); everything else is listed, not fatal.
 */
function printNames(data: VenueMapData): { errors: string[]; index: VenueIndex } {
  const errors: string[] = [];
  // ---- The Pujya Santo view's names (SANT_ROOM_NAMES) against this map's residence rooms
  const santIds = Object.keys(SANT_ROOM_NAMES);
  const ownRooms = data.levels.flatMap((l) => l.rooms.filter((r) => isSantRoom(r) && r.sant === "own" && r.kind !== "stair" && r.kind !== "elevator"));
  if (!hasSantExtras(data)) {
    // A map without the Pujya Santo extras (one extracted before 2026-10-03, a rollback): santos
    // get the delegates' map, and the names have nothing to name.
    if (santIds.length > 0) {
      console.log(`  Santo room names (SANT_ROOM_NAMES): ${santIds.length} names, unused: this map has no Pujya Santo extras (santos get the delegates' map)`);
    }
  } else {
    const santProblems = santNameProblems(data);
    console.log(
      `  Santo room names (SANT_ROOM_NAMES in src/lib/venue/aliasTable.ts): ${santIds.length} names; ` +
        `${ownRooms.filter((r) => santIds.includes(r.id)).length} of ${ownRooms.length} residence rooms santos are shown carry one`,
    );
    for (const p of santProblems) console.log(`    ! ${p}`);
    if (santProblems.length > 0) errors.push(`${santProblems.length} problem(s) between SANT_ROOM_NAMES / the alias tables and this map's residence rooms`);
  }
  const raw = new Map(data.levels.flatMap((l) => l.rooms.map((r) => [r.id, r] as const)));
  // As the pages get it: public rooms only, under their team names.
  const rooms = toClientVenue(data).levels.flatMap((l) => l.rooms);
  const index = buildVenueIndex(rooms, VENUE_ALIAS_ENTRIES);
  const isShaft = (kind: string) => kind === "stair" || kind === "elevator";

  // ---- Team names (map id -> the organisers' name)
  const nameIds = Object.keys(VENUE_ROOM_NAMES);
  const bad = nameIds.filter((id) => {
    const r = raw.get(id);
    return !r || !r.public || isShaft(r.kind);
  });
  const listed = listedRooms(rooms, index).filter((r) => !isShaft(r.kind));
  const open = listed.filter((r) => !r.closed);
  const closed = listed.filter((r) => r.closed);
  const unnamed = open.filter((r) => !r.named).map((r) => r.id);
  const closedNamed = closed.filter((r) => r.named).map((r) => r.id);
  console.log(
    `  Team room names (VENUE_ROOM_NAMES in src/lib/venue/aliasTable.ts): ${nameIds.length} names, ${nameIds.length - bad.length} on public rooms of this map`,
  );
  console.log(
    `    ${open.length - unnamed.length} of ${open.length} rooms guests can go to carry one` +
      (unnamed.length > 0 ? `; ${unnamed.length} keep the blueprint's name: ${list(unnamed)}` : ""),
  );
  console.log(
    `    ${closed.length} staff-only rooms (shown, no directions): ${closed.length - closedNamed.length} keep the blueprint's name` +
      (closedNamed.length > 0 ? `, ${closedNamed.length} carry a team name: ${list(closedNamed)}` : ""),
  );
  if (bad.length > 0) {
    const why = (id: string) => {
      const r = raw.get(id);
      return !r ? "not on this map" : !r.public ? "not a public room" : "a stair / elevator";
    };
    console.log(`    ! Team names for ids that aren't public rooms on this map (never sent): ${bad.map((id) => `${id} (${why(id)})`).join(", ")}`);
    errors.push(`${bad.length} team name(s) in VENUE_ROOM_NAMES are for ids that aren't public rooms on this map: ${list(bad)}`);
  }

  // ---- Event names (name -> map ids)
  const cov = aliasCoverage(index, VENUE_ALIAS_ENTRIES);
  const perTrack = Object.entries(VENUE_ALIASES).filter(([, v]) => v && !Array.isArray(v)).map(([n]) => n);
  const tentative = Object.keys(VENUE_ALIAS_TENTATIVE);
  const mappedTentative = cov.mapped.filter((n) => tentative.includes(n));
  console.log(
    `  Event room names (VENUE_ALIASES): ${cov.total} listed: ${cov.mapped.length} mapped (${mappedTentative.length} of them tentative` +
      (perTrack.length > 0 ? `, ${perTrack.length} with one room per track: ${list(perTrack)}` : "") +
      `), ${cov.unmapped.length} not on the map` +
      (cov.resolvable.length > 0 ? ` (${cov.resolvable.length} of those found by a room's own name: ${list(cov.resolvable)})` : ""),
  );
  if (cov.unmapped.length > 0) console.log(`    not on the map (null, or no public room on this map): ${list(cov.unmapped)}`);
  if (mappedTentative.length > 0) {
    console.log("    tentative, to confirm with the organisers:");
    for (const n of mappedTentative) {
      const ids = index.aliases.get(normalizeVenueName(n))?.roomIds ?? [];
      console.log(`      ${n} -> ${list(ids)}: assumed to be ${VENUE_ALIAS_TENTATIVE[n]}`);
    }
  }
  const strayTentative = tentative.filter((n) => !cov.mapped.includes(n));
  if (strayTentative.length > 0) console.log(`    ~ In VENUE_ALIAS_TENTATIVE but not mapped on this map: ${list(strayTentative)}`);
  if (cov.missingIds.length > 0) console.log(`    ! Alias ids that aren't public rooms on this map: ${list(cov.missingIds)}`);
  const closedAliases = [...index.aliases.values()].filter((a) => a.roomIds.some((id) => index.rooms.get(id)?.closed));
  if (closedAliases.length > 0) {
    console.log(
      `    ~ Event names mapped to staff-only rooms (shown, no directions): ${closedAliases
        .map((a) => `${a.name} -> ${list(a.roomIds.filter((id) => index.rooms.get(id)?.closed))}`)
        .join("; ")}`,
    );
  }

  // ---- The room names the Hub uses
  console.log("  Room names the Hub uses, against the table and this map:");
  const report = (label: string, c: ReturnType<typeof checkNames>) => {
    console.log(`    ${label}: ${c.total} names, ${c.total - c.notInTable.length - c.notOnMap.length} on this map`);
    if (c.notInTable.length > 0) console.log(`      ! missing from the table (guests read "not on the map yet"): ${list(c.notInTable)}`);
    if (c.notOnMap.length > 0) console.log(`      ~ in the table, not on this map: ${list(c.notOnMap)}`);
    if (c.staffOnly.length > 0) console.log(`      ~ staff only on this map (no directions): ${list(c.staffOnly)}`);
  };
  report(
    "team breakouts (prisma/breakouts-data.ts, each for its track)",
    checkNames(
      BREAKOUT_SESSIONS.flatMap((s) => s.rooms.flatMap((room) => splitVenueNames(room).map((name) => ({ name, track: s.track })))),
      index,
    ),
  );
  report(
    "schedule places (prisma/seed.ts)",
    checkNames(
      seedPlaces().map((name) => ({ name, track: null })),
      index,
    ),
  );
  return { errors, index };
}

/**
 * The goshthi rooms (users.goshthi_room), counts only: read with the database (--dry-run /
 * --apply), each for its delegates' track. Never stops the import.
 */
async function printGoshthiRooms(prisma: PrismaClient, index: VenueIndex) {
  try {
    const rows = await prisma.user.findMany({
      where: { goshthiRoom: { not: null } },
      distinct: ["goshthiRoom", "gender"],
      select: { goshthiRoom: true, gender: true },
    });
    const c = checkNames(
      rows.flatMap((r) =>
        splitVenueNames(r.goshthiRoom ?? "").map((name) => ({
          name,
          track: r.gender === "MALE" ? ("BHAIO" as const) : r.gender === "FEMALE" ? ("BEHNO" as const) : null,
        })),
      ),
      index,
    );
    console.log(
      `    goshthi rooms (users.goshthi_room): ${c.total} names, ${c.total - c.notInTable.length - c.notOnMap.length} on this map, ` +
        `${c.notInTable.length} missing from the table, ${c.notOnMap.length} in the table but not on this map, ${c.staffOnly.length} staff only`,
    );
  } catch (e) {
    console.log(`    goshthi rooms (users.goshthi_room): couldn't be counted (${e instanceof Error ? e.message.split("\n")[0] : e})`);
  }
}

function printSummary(data: VenueMapData, bytes: number) {
  console.log(`Venue map from ${data.source}, generated ${data.generatedAt} (${(bytes / 1024).toFixed(0)} KB)`);
  const counts = venueCounts(data);
  for (const c of counts) {
    const sant = c.santRooms.own + c.santRooms.shared + c.santRooms.way;
    console.log(
      `  ${c.level} ${c.name.padEnd(13)} ${String(c.rooms).padStart(4)} rooms: ${String(c.publicRooms).padStart(4)} public (${c.withEntry} with an entry, ${c.staffOnly} staff only: shown, no directions), ${String(c.backOfHouse).padStart(3)} back-of-house${sant > 0 ? ` (${sant} of them walkable for santos, ${c.santRooms.own} shown to them)` : ""}; grid ${c.grid}, ${c.walkableCells} walkable cells; walls ${(c.wallsChars / 1024).toFixed(0)} KB`,
    );
  }
  const stairs = data.connectors.filter((c) => c.kind === "stair").length;
  console.log(`  ${data.connectors.length} connectors: ${stairs} stairs, ${data.connectors.length - stairs} elevators`);
  // Each with its floors (bottom to top), its place (what guests read: never the id's number) and
  // its side: who may use it.
  const orderOf = new Map(data.levels.map((l) => [l.id, l.order]));
  const byKindId = data.connectors
    .slice()
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id, undefined, { numeric: true }));
  for (const c of byKindId) {
    const floors = (Object.keys(c.points) as VenueLevelId[]).sort((a, b) => (orderOf.get(a) ?? 0) - (orderOf.get(b) ?? 0));
    const santOnly = Object.keys(c.santPoints ?? {}) as VenueLevelId[];
    const who = (["BHAIO", "BEHNO"] as const).filter((t) => connectorUsable(c, t)).map((t) => (t === "BHAIO" ? "Bhaio" : "Behno"));
    const floorText = `${floors.join(" ")}${santOnly.length > 0 ? ` (+${santOnly.join(" ")} santos only)` : ""}`;
    console.log(
      `    ${c.id.padEnd(8)} ${floorText.padEnd(8)} place: ${(c.place ?? "none").padEnd(5)} side: ${(c.side ?? "none").padEnd(5)}  used by ${who.join(" and ")}; guests read “${connectorPhrase(c)}”`,
    );
  }
  console.log(
    `    (Bhaio: ${TRACK_SIDE.BHAIO} side, Behno: ${TRACK_SIDE.BEHNO} side; elevators ${ELEVATORS_FOLLOW_SIDE ? "follow the same split" : "shared by everyone"})`,
  );
  // The Pujya Santo view's extras: counts and map ids only.
  if (hasSantExtras(data)) {
    console.log("  Pujya Santo view (the sadhus' residence, /sant/map only):");
    for (const c of counts) {
      const l = data.levels.find((x) => x.id === c.level)!;
      const ids = (cls: string) => l.rooms.filter((r) => isSantRoom(r) && r.sant === cls).map((r) => r.id);
      const total = c.santRooms.own + c.santRooms.shared + c.santRooms.way;
      if (total === 0 && !l.santGrid) continue;
      console.log(
        `    ${c.level}: ${total} rooms, ${c.santWithEntry} with an entry; own (shown, named) ${c.santRooms.own}: ${list(ids("own"))}; ` +
          `way (walkable, never shown) ${c.santRooms.way}: ${list(ids("way"))}; shared ${c.santRooms.shared}: ${list(ids("shared"))}; ` +
          `${c.santOnlyCells} santo-only cells`,
      );
    }
    const landings = data.connectors.flatMap((c) => Object.keys(c.santPoints ?? {}).map((lvl) => `${c.id} on ${lvl}`));
    console.log(`    santo-only landings: ${list(landings)}`);
  }
}

async function main() {
  const { mode, args, flags } = parseArgs(process.argv.slice(2));
  if (args.compare) assertOutsideRepo(args.compare, "--compare");
  if (args.flows) assertOutsideRepo(args.flows, "--flows");
  const rulesIn = readRules(args.file, args.rules, flags.has("no-rules"));
  const { data, bytes, ruleWarnings } = readVenue(args.file, "--file", false, rulesIn.rules);
  printSummary(data, bytes);
  printRules(data, rulesIn.from, ruleWarnings);
  const names = printNames(data);
  if (mode === "plan") console.log("    goshthi rooms (users.goshthi_room): counted with --dry-run / --apply (needs the database)");
  if (names.errors.length > 0) {
    for (const e of names.errors) console.log(`  ! ${e}`);
    throw new Error("The room name table (src/lib/venue/aliasTable.ts) doesn't fit this map (above): nothing was written.");
  }

  // The organisers' flows against the app's routes (scripts/venue-flow-check.ts): counts and ids,
  // at each flow's time and on the way to it (the rules WALK_LEAD_MIN minutes earlier).
  if (args.flows) {
    console.log("  Flow check (the organisers' flow maps against the app's routes):");
    const flows = readFlows(args.flows);
    const results = checkFlows(data, flows, data.flowRules ?? null);
    const walk = checkFlows(data, flows, data.flowRules ?? null, { leadMinutes: WALK_LEAD_MIN });
    let baseline: FlowResult[] | null = null;
    if (args.compare) {
      const prev = readVenue(args.compare, "--compare", true).data;
      baseline = checkFlows(prev, flows, prev.flowRules ?? null);
    }
    for (const l of flowSummary(results, baseline, walk)) console.log(`    ${l}`);
  } else if ((data.flowRules ?? []).length > 0) {
    console.log("    ~ No --flows file: the rules weren't checked against the organisers' drawn trips (venue:import -- --plan --flows <flows.json>)");
  }

  // The doors the rules name, against the map they were written for (--compare; with a database
  // also the stored row): a re-extraction can renumber a room's doors.
  const doorErrors: string[] = [];
  if (args.compare && (data.flowRules ?? []).length > 0) {
    doorErrors.push(...checkRuleDoors(data, readVenue(args.compare, "--compare", true).data, `--compare ${basename(args.compare)}`));
  }

  // The Pujya Santo view's routes (scripts/venue-route-check.ts): any error stops every mode.
  if (hasSantExtras(data)) {
    console.log("  Route check (the Pujya Santo view):");
    const rc = checkSantoRoutes(data);
    for (const l of rc.lines) console.log(`    ${l}`);
    for (const w of rc.warnings) console.log(`    ~ ${w}`);
    for (const e of rc.errors.slice(0, 40)) console.log(`    ! ${e}`);
    if (rc.errors.length > 40) console.log(`    ... and ${rc.errors.length - 40} more`);
    if (rc.errors.length > 0) throw new Error(`The route check found ${rc.errors.length} problem(s) (above): nothing was written.`);
  }

  // What delegates get, against another file (any mode) and, with a database, the stored row.
  const allowChange = flags.has("delegates-change");
  let differs = false;
  const compareWithFile = () => {
    console.log("  What delegates get, compared:");
    if (!args.compare) return;
    const prev = readVenue(args.compare, "--compare", true).data;
    differs = compareMaps(data, prev, `--compare ${basename(args.compare)}`) || differs;
  };
  const doorsChecked = flags.has("doors-checked");
  const reportDoors = () => {
    for (const e of doorErrors) console.log(`    ! ${e}`);
    if (doorErrors.length > 0 && doorsChecked) console.log("    The moved doors are checked (--doors-checked).");
  };
  if (mode === "plan") {
    compareWithFile();
    if (!args.compare) console.log("    (no --compare file; --dry-run / --apply compare with the stored row)");
    if (differs) {
      console.log(
        allowChange
          ? "    The difference is allowed (--delegates-change)."
          : "    ! What delegates get differs: --dry-run / --apply will stop unless --delegates-change is given.",
      );
    }
    reportDoors();
    if (doorErrors.length > 0 && !doorsChecked) {
      console.log("    ! Doors the flow rules name moved or lead elsewhere: --dry-run / --apply will stop unless --doors-checked is given.");
    }
    return;
  }

  if (args.env) loadEnvFile(args.env);
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  try {
    await printGoshthiRooms(prisma, names.index);
    compareWithFile();
    const current = await prisma.venueMap.findUnique({ where: { id: "current" }, select: { source: true, generatedAt: true, importedAt: true } });
    const host = (process.env.DATABASE_URL ?? "the .env database").replace(/\/\/.*@/, "//***@");
    if (current) {
      const stored = await prisma.venueMap.findUnique({ where: { id: "current" }, select: { data: true } });
      const v = validateVenueMap(stored?.data);
      if (v.data) {
        differs = compareMaps(data, v.data, "the stored map") || differs;
        if ((data.flowRules ?? []).length > 0) doorErrors.push(...checkRuleDoors(data, v.data, "the stored map"));
      } else console.log("    The stored map doesn't validate, so it isn't compared");
    } else {
      console.log("    No stored map to compare with");
    }
    reportDoors();
    if (differs && !allowChange) {
      throw new Error(
        "What delegates get would change (above): nothing was written. Re-run with --delegates-change if that is meant (a new extraction of the organisers' plans).",
      );
    }
    if (differs) console.log("    The difference is allowed (--delegates-change).");
    if (doorErrors.length > 0 && !doorsChecked) {
      throw new Error(
        "Doors the flow rules name moved or lead elsewhere (above): nothing was written. Check each against report.json's door_openings, fix the rules file, or re-run with --doors-checked if they still name the doors meant.",
      );
    }
    console.log("");
    console.log(
      current
        ? `Replaces the map from ${current.source}, generated ${current.generatedAt.toISOString()}, imported ${current.importedAt.toISOString()}`
        : "No venue map in the database yet",
    );
    if (mode === "dry-run") {
      console.log(`Nothing written (dry run): venue map import into ${host}`);
      return;
    }
    const row = {
      data: data as unknown as Prisma.InputJsonValue,
      source: data.source,
      generatedAt: new Date(data.generatedAt),
      importedAt: new Date(),
    };
    await prisma.$transaction([prisma.venueMap.upsert({ where: { id: "current" }, create: { id: "current", ...row }, update: row })]);
    console.log(`Written: venue map "current" into ${host}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  if (e instanceof UsageError) console.error(USAGE);
  if ((e as { code?: string })?.code === "P2021") {
    console.error("The database schema is behind: run `npm run db:push` (or `npm run db:push:lightsail`) first.");
  }
  process.exit(1);
});
