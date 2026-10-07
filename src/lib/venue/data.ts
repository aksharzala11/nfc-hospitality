/**
 * Server only (reads the database and, in local development, a file): the venue map.
 *
 * getVenueMap() reads row "current" of `venue_maps` (written by `npm run venue:import`); null
 * while nothing is imported or the table isn't pushed yet (P2021). In local development only
 * (NODE_ENV !== "production") it falls back to the JSON file named by VENUE_DATA_FILE, so the map
 * can be tried straight from the extractor's output without importing it; a file inside the repo
 * is refused. The blueprint and its JSON never live in the repo or /public.
 *
 * toClientVenue() (src/lib/venue/clientVenue.ts, re-exported here) is the only way the map reaches
 * a delegate's or an admin's browser; getVenueForPages() pairs it with the name index the pages
 * resolve room names on. The Pujya Santo view's payload (toSantClientVenue(), with the sadhus'
 * residence) is built only here, for a viewer with role SANT, and is not re-exported.
 *
 * The map's flow rules (VenueMapData.flowRules, merged in by `npm run venue:import`; flowRules.ts)
 * reach a page only through getVenueForPages()'s rulesAt(time, track): the rules in force then for
 * that track, resolved for the router (routeRulesFor()). A problem in them (validate.ts ruleErrors)
 * means no rule applies, never no map; admins see a count.
 */
import { readFile, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { Prisma, type UserRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { VenueFlowRule, VenueMapData, VenueTrack } from "./types";
import { validateVenueMap } from "./validate";
import { nextRuleChange, routeRulesFor, windowHolds, type RouteRules } from "./flowRules";
import { parseInEventTz } from "@/lib/time";
import { buildVenueIndex, resolveVenueRoom, type VenueIndex } from "./aliases";
import { VENUE_ALIAS_ENTRIES } from "./aliasTable";
import { hasSantExtras, santNameProblems, toClientVenue, toSantClientVenue } from "./clientVenue";
import type { ClientVenue } from "./view";

export { roundPath, toClientVenue } from "./clientVenue";

/** P2021: venue_maps doesn't exist yet (the schema isn't pushed to this database). */
export function isVenueTableMissing(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2021";
}

/** Parsed maps, keyed by where they came from and when (the row's import time or the file's mtime). */
let cached: { key: string; data: VenueMapData } | null = null;
/** Per parsed map: what an admin should know it needs (a re-extract and re-import). */
const problemCache = new WeakMap<VenueMapData, string[]>();
/** Per parsed map: its Pujya Santo extras are valid (no santErrors, SANT_ROOM_NAMES fits): santos may get them. */
const santOk = new WeakMap<VenueMapData, boolean>();
/** Per parsed map: its flow rules, checked ([] = none, or none apply because they have a problem). */
const flowRules = new WeakMap<VenueMapData, VenueFlowRule[]>();

function parse(json: unknown, from: string): VenueMapData | null {
  const v = validateVenueMap(json);
  if (!v.data) {
    console.error(`[venue] The venue map from ${from} is invalid (${v.errors.length} errors), first: ${v.errors[0]}`);
    return null;
  }
  if (v.routingErrors.length > 0) {
    console.warn(`[venue] The venue map from ${from} has ${v.routingErrors.length} routing problem(s), first: ${v.routingErrors[0]}`);
  }
  // Still served (a map beats none), but the admins see why it needs importing again: e.g. one
  // imported before 2026-09-30 has the mezzanine between the first and second floors and no
  // stair sides, so every guest may use every stair.
  const problems = [...v.routingErrors];
  if (v.data.connectors.length > 0 && !v.data.connectors.some((c) => c.side)) {
    problems.push("No stair or elevator has a side, so Bhaio and Behno may use every one: re-run scripts/venue/extract.py");
  }
  // One imported before 2026-10-01 doesn't say where each stair is: directions can only say "the stairs".
  if (v.data.connectors.length > 0 && !v.data.connectors.some((c) => c.place)) {
    problems.push(
      "No stair or elevator has a place (foyer / side / back), so directions say only “the stairs” / “the elevator”: re-run scripts/venue/extract.py",
    );
  }
  // The Pujya Santo view's extras (the sadhus' residence): any problem only gives santos the
  // delegates' map (fail closed). Counts only, here and for the admins: never an id. A map without
  // them (one extracted before 2026-10-03) simply gives santos the delegates' map: SANT_ROOM_NAMES
  // has nothing to name there.
  const extras = hasSantExtras(v.data);
  const santProblems = v.santErrors.length + (extras ? santNameProblems(v.data).length : 0);
  if (santProblems > 0) {
    console.warn(`[venue] The venue map from ${from} has ${santProblems} problem(s) in the Pujya Santo view's extras: santos get the delegates' map`);
    if (extras) {
      problems.push(
        `The Pujya Santo view's extras in this map have ${santProblems} problem(s), so santos see the delegates' map: check it with npm run venue:import -- --file <venue-map.json> --plan`,
      );
    }
  }
  santOk.set(v.data, extras && santProblems === 0);
  // The flow rules: any problem and none apply (fail closed to the building alone). Counts only.
  if (v.ruleErrors.length > 0) {
    console.warn(`[venue] The flow rules in the venue map from ${from} have ${v.ruleErrors.length} problem(s): no flow rule applies`);
    problems.push(
      `The flow rules in this map have ${v.ruleErrors.length} problem(s), so directions ignore them all: check it with npm run venue:import -- --file <venue-map.json> --plan`,
    );
  }
  flowRules.set(v.data, v.rules ?? []);
  problemCache.set(v.data, problems);
  return v.data;
}

async function fromDatabase(): Promise<VenueMapData | null> {
  let head: { importedAt: Date } | null;
  try {
    head = await prisma.venueMap.findUnique({ where: { id: "current" }, select: { importedAt: true } });
  } catch (err) {
    if (isVenueTableMissing(err)) return null;
    throw err;
  }
  if (!head) return null;
  const key = `db:${head.importedAt.toISOString()}`;
  if (cached?.key === key) return cached.data;
  const row = await prisma.venueMap.findUnique({ where: { id: "current" }, select: { data: true, importedAt: true } });
  if (!row) return null;
  const data = parse(row.data, "the database");
  if (data) cached = { key: `db:${row.importedAt.toISOString()}`, data };
  return data;
}

/** Local development only: the extractor's JSON, named by VENUE_DATA_FILE. */
async function fromDevFile(): Promise<VenueMapData | null> {
  if (process.env.NODE_ENV === "production") return null;
  const file = process.env.VENUE_DATA_FILE?.trim();
  if (!file) return null;
  const path = isAbsolute(file) ? file : resolve(process.cwd(), file);
  // Derived from the blueprint: never read from inside the repo (the import refuses it too).
  const rel = relative(process.cwd(), path);
  if (!(rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel))) {
    console.error("[venue] VENUE_DATA_FILE is inside the repo: keep the venue map outside it (it is derived from the blueprint). Ignored.");
    return null;
  }
  try {
    const info = await stat(path);
    const key = `file:${path}:${info.mtimeMs}`;
    if (cached?.key === key) return cached.data;
    const data = parse(JSON.parse(await readFile(path, "utf8")), "VENUE_DATA_FILE");
    if (data) cached = { key, data };
    return data;
  } catch (err) {
    console.error(`[venue] Couldn't read VENUE_DATA_FILE: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

/** The venue map: the imported row, else (local development) VENUE_DATA_FILE, else null. */
export async function getVenueMap(): Promise<VenueMapData | null> {
  return (await fromDatabase()) ?? (await fromDevFile());
}

/**
 * The map for the hub's pages: the client payload (rooms under their team names), the name index
 * (VENUE_ALIASES, server only, per-track entries included: resolve names with the guest's track;
 * plus the public rooms' own names) and, for admins only, why the map needs importing again
 * (routing errors, no stair sides, no places); null while there is no map. Memoised per parsed map.
 * `viewer`: only the Pujya Santo pages (behind requireSant()) pass it. A viewer with role SANT gets
 * the Pujya Santo payload (toSantClientVenue(): the sadhus' residence too) when the map's santo
 * extras are valid; everyone else, and santos otherwise, the delegates' (toClientVenue()). Never
 * pass a viewer from a page or route a non-santo can reach.
 */
export async function getVenueForPages(viewer?: { role: UserRole } | null): Promise<{
  venue: ClientVenue;
  index: VenueIndex;
  problems: string[];
  /**
   * The flow rules in force at `at` (a page's now, or a breakout session's start; null = no time:
   * only rules without a window) for a viewer of `track` (null = no gender on file), resolved for
   * the router and safe to send to that viewer's browser; null when none apply.
   */
  rulesAt: (at: Date | null, track: VenueTrack | null) => RouteRules | null;
  /** The next instant after `after` at which the rules in force for `track` change (a window opens or closes); null = none. */
  nextRulesChange: (after: Date, track: VenueTrack | null) => Date | null;
} | null> {
  const data = await getVenueMap();
  if (!data) return null;
  const santo = viewer?.role === "SANT" && santOk.get(data) === true;
  const venue = santo ? toSantClientVenue(data) : toClientVenue(data);
  let index = indexCache.get(venue);
  if (!index) {
    index = buildVenueIndex(
      venue.levels.flatMap((l) => l.rooms),
      VENUE_ALIAS_ENTRIES,
    );
    indexCache.set(venue, index);
  }
  return {
    venue,
    index,
    problems: problemCache.get(data) ?? [],
    rulesAt: (at, track) => rulesAt(data, at, track),
    nextRulesChange: (after, track) => nextRuleChange(flowRules.get(data), after, track, parseInEventTz),
  };
}
const indexCache = new WeakMap<ClientVenue, VenueIndex>();

/** Resolved rule sets per parsed map, by which rules are in force and the track. */
const rulesAtCache = new WeakMap<VenueMapData, Map<string, RouteRules | null>>();

/** The map's flow rules in force at `at` for `track` (routeRulesFor()), memoised per set of rules in force. */
function rulesAt(data: VenueMapData, at: Date | null, track: VenueTrack | null): RouteRules | null {
  const rules = flowRules.get(data) ?? [];
  if (rules.length === 0) return null;
  const live = rules.filter((r) => windowHolds(r.window, at)).map((r) => r.id);
  const key = `${track ?? "any"}|${live.join(",")}`;
  let byKey = rulesAtCache.get(data);
  if (!byKey) {
    byKey = new Map();
    rulesAtCache.set(data, byKey);
  }
  if (byKey.has(key)) return byKey.get(key)!;
  const out = routeRulesFor(data, rules, at, track);
  byKey.set(key, out);
  return out;
}

/**
 * The /map deep link for a room name ("Niyam", "Green Room 2 · Green Room 3"), or null when
 * none of it is on the map, or all of it is staff only (so callers show plain text, never a link
 * to nowhere). `track` = the guest's (a place with one room per track is looked up for them);
 * `now` keeps a demo "?now=" override; `base` = the map page the link opens: "/map" (the
 * delegate hub, the default), or "/sant/map" for the Pujya Santo view.
 */
export function venueHref(
  name: string,
  index: VenueIndex,
  opts: { now?: string; track?: VenueTrack | null; base?: "/map" | "/sant/map" } = {},
): string | null {
  const ids = resolveVenueRoom(name, index, opts.track).roomIds;
  if (!ids.some((id) => !index.rooms.get(id)?.closed)) return null;
  const q = new URLSearchParams({ to: name });
  if (opts.now) q.set("now", opts.now);
  return `${opts.base ?? "/map"}?${q.toString()}`;
}
