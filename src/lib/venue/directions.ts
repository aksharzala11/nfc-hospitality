/**
 * Directions between two rooms of the venue map, worded one way wherever they show: the /map and
 * /sant/map pages (src/components/map/VenueMap.tsx, in the browser) and the "How to get there"
 * section of the breakouts page (src/lib/venue/breakoutDirections.ts, on the server). They run it
 * over the viewer's payload (toClientVenue(); on /sant/map, for santos, toSantClientVenue()), so
 * back-of-house rooms (bare outlines there) can't appear.
 *
 * What lives here: the default start (the main foyer), which of several rooms a name opens, the
 * stairs / elevators a guest may use (their track's side), room titles as guests read them (the
 * organisers' team name where the room has one, ClientRoom.named), where a route leaves its start
 * room, the numbered steps, the note under them and, when there is no route, why in plain words.
 * Pure and client-safe: no database, no alias table.
 *
 * Staff-only rooms (ClientRoom.closed; organisers, 2026-10-01) are on the map by name but have no
 * directions: never a start (routeStartPoint()), never a destination (routeBetween()), and the
 * message says so (directionsProblem()). Stairs and elevators are never named by number: the steps
 * call them by place (steps.ts), their rooms are "Foyer Stairs" etc. (shaftRoomName(), view.ts).
 *
 * Flow rules (the organisers' flow maps; flowRules.ts routeRulesFor(): the rules in force for this
 * viewer at the page's time, or at a session's start on /breakouts) ride along as `rules`:
 * routeBetween() hands the router both rooms' ids and, for a room left by its door, starts at the
 * doors its rule allows; the steps name a room walked through by its shown name (placeOf).
 */
import type { VenueConnector, VenueLevelId, VenuePoint, VenueTrack } from "./types";
import type { RouteRules } from "./flowRules";
import { normalizeVenueName, type VenueIndex } from "./aliases";
import {
  ELEVATORS_FOLLOW_SIDE,
  TRACK_SIDE,
  connectorUsable,
  createVenueRouter,
  type RouteResult,
  type VenueRoute,
  type VenueRouter,
} from "./route";
import { routeSteps, type RouteStep } from "./steps";
import {
  UNLISTED_KINDS,
  connectorOfRoom,
  connectorPhrase,
  startPointOf,
  startsAtDoor,
  withArticle,
  type ClientRoom,
  type ClientVenue,
} from "./view";

/**
 * How a name that finds several rooms reads (the same union as MatchSpread in
 * src/components/map/mapTypes.ts and spreadOf() in aliases.ts).
 */
export type VenueSpread = "one" | "split" | "covers" | "same-name";

export const TRACK_NAME: Record<VenueTrack, string> = { BHAIO: "Bhaio", BEHNO: "Behno" };

/** "stairs and elevators" for a track's side (just "stairs" while the elevators are shared). */
export const SIDE_THINGS = ELEVATORS_FOLLOW_SIDE ? "stairs and elevators" : "stairs";

/**
 * Why there are no directions, in plain words: the guest's side's stairs don't reach the room
 * (never routed through the other side), no step-free way, or none at all. When their side's
 * stairs / elevators don't stop on the floor they're starting from (or the room's floor) at all,
 * it names that floor rather than the room: a step-free Behno guest on a floor only the right-hand
 * elevator serves is told that floor, not that the left-hand elevators miss a room they do reach.
 */
export function routeProblem(
  fail: Extract<RouteResult, { ok: false }>,
  at: {
    dest: string;
    startLevel: VenueLevelId;
    destLevel: VenueLevelId;
    stepFree: boolean;
    track: VenueTrack | null;
    /** Floors the guest's side's connectors stop on (elevators only, or stairs and elevators). */
    served: (elevatorsOnly: boolean) => ReadonlySet<VenueLevelId>;
    levelName: (id: VenueLevelId) => string;
  },
): string {
  const { dest, startLevel, destLevel, stepFree, track } = at;
  if (fail.reason === "side" && track) {
    const elevatorsOnly = stepFree && fail.withStairs;
    const who = `The ${elevatorsOnly ? "elevators" : SIDE_THINGS} on the ${TRACK_SIDE[track]} (for ${TRACK_NAME[track]})`;
    const next = elevatorsOnly ? "Turn off Step-free to take the stairs, or ask a volunteer." : "Please ask a volunteer.";
    const served = at.served(elevatorsOnly);
    if (startLevel !== destLevel && !served.has(startLevel)) {
      return `${who} don’t reach the ${at.levelName(startLevel)}, where you’re starting. ${next}`;
    }
    if (startLevel !== destLevel && !served.has(destLevel)) {
      return `${who} don’t reach the ${at.levelName(destLevel)}, where ${dest} is. ${next}`;
    }
    return `${who} don’t reach ${dest}. ${next}`;
  }
  if (stepFree) {
    return fail.withStairs
      ? `We couldn’t find a step-free way to ${dest}. Try with stairs, or ask a volunteer.`
      : `We couldn’t find a step-free way to ${dest}. Please ask a volunteer.`;
  }
  return `We couldn’t find a way to ${dest} from there. Please ask a volunteer.`;
}

/**
 * Which of several rooms a name found to open: for a name several rooms share ("same-name": also a
 * place with one room per track, for a guest with no track), the one nearest the start (same floor
 * first); otherwise the list's order (the organisers' split, or an event name's rooms). Rooms with
 * directions come first either way (a staff-only room is opened only when nothing else was found).
 * `ids` are already the guest's (resolveVenueRoom() with their track).
 */
export function pickRoom(
  ids: string[],
  spread: VenueSpread,
  start: ClientRoom | null,
  roomById: Map<string, ClientRoom>,
  orderOf: (l: VenueLevelId) => number,
): string | null {
  const rooms = ids.map((id) => roomById.get(id)).filter((r): r is ClientRoom => Boolean(r));
  if (rooms.length === 0) return null;
  const withEntry = rooms.filter((r) => r.entry && !r.closed);
  const pool = withEntry.length > 0 ? withEntry : rooms;
  if (spread !== "same-name" || !start) return pool[0].id;
  const cost = (r: ClientRoom) =>
    Math.abs(orderOf(r.level) - orderOf(start.level)) * 1e6 + Math.hypot(r.label[0] - start.label[0], r.label[1] - start.label[1]);
  return pool.reduce((best, r) => (cost(r) < cost(best) ? r : best)).id;
}

/**
 * The best default start: the main entrance / lobby / foyer (the organisers' "Main Foyer"), on the
 * first floor if there is one there. Null when the map has no lobby or entrance with an entry.
 */
export function defaultStart(rooms: ClientRoom[]): ClientRoom | null {
  let best: ClientRoom | null = null;
  let bestScore = Infinity;
  for (const r of rooms) {
    if (!r.entry || r.closed) continue;
    const n = normalizeVenueName(r.name);
    let s = Infinity;
    if (/\bmain (entrance|lobby|foyer)\b/.test(n)) s = 0;
    else if (r.kind === "lobby" && /\b(lobby|foyer)\b/.test(n)) s = 1;
    else if (r.kind === "lobby") s = 2;
    else if (/\b(entrance|vestibule)\b/.test(n)) s = 3;
    else if (r.kind === "exit") s = 4;
    if (s === Infinity) continue;
    s += r.level === "1" ? 0 : 0.5;
    if (s < bestScore) {
      bestScore = s;
      best = r;
    }
  }
  return best;
}

/**
 * Searchable, labelled and tappable: every public room but corridors (unless the organisers named
 * one, or an event name is mapped to one: "2nd Floor Foyer") and stairs / elevators that don't
 * stop on that floor for guests (no landing there, e.g. one that opens into back-of-house or
 * private quarters). Staff-only rooms (`closed`) are listed like any other: shown and named,
 * without directions.
 */
export function listedRooms(rooms: ClientRoom[], index: VenueIndex): ClientRoom[] {
  return rooms.filter(
    (r) =>
      (!UNLISTED_KINDS.has(r.kind) || r.named || index.eventNames.has(r.id)) &&
      !((r.kind === "stair" || r.kind === "elevator") && !r.entry),
  );
}

/** Stairs / elevators this guest may use (their side's; every one without a track). */
export function usableConnectorIds(connectors: readonly VenueConnector[], track: VenueTrack | null): Set<string> {
  return new Set(connectors.filter((c) => connectorUsable(c, track)).map((c) => c.id));
}

/** A stair / elevator room on the other side (not a start for this guest). */
export function isOtherSideRoom(r: ClientRoom, connectors: readonly VenueConnector[], usable: ReadonlySet<string>): boolean {
  if (r.kind !== "stair" && r.kind !== "elevator") return false;
  const c = connectorOfRoom(r, connectors);
  return Boolean(c && !usable.has(c.id));
}

/** Step-free needs an elevator this guest may use. */
export function canStepFreeWith(connectors: readonly VenueConnector[], usable: ReadonlySet<string>): boolean {
  return connectors.some((c) => c.kind === "elevator" && usable.has(c.id));
}

/** Floors this guest's stairs and elevators (or elevators only) stop on, for routeProblem(). */
export function servedLevelsOf(
  connectors: readonly VenueConnector[],
  usable: ReadonlySet<string>,
  elevatorsOnly: boolean,
): Set<VenueLevelId> {
  const out = new Set<VenueLevelId>();
  for (const c of connectors) {
    if (!usable.has(c.id) || (elevatorsOnly && c.kind !== "elevator")) continue;
    for (const id of Object.keys(c.points) as VenueLevelId[]) out.add(id);
  }
  return out;
}

/** How many rooms share each name ("Classroom", "Bath", "Ladies' Restroom"). */
export function repeatedNames(rooms: ClientRoom[]): Map<string, number> {
  const count = new Map<string, number>();
  for (const r of rooms) if (!UNLISTED_KINDS.has(r.kind)) count.set(r.name, (count.get(r.name) ?? 0) + 1);
  return count;
}

/** Where a room is among the rooms of its name on its floor (twinSpots()). */
export type TwinSpot = "left" | "right" | "front" | "back";

/** "on the left", "at the back": a twin's spot in running text and in the From list. */
export function spotPhrase(spot: TwinSpot): string {
  return spot === "left" || spot === "right" ? `on the ${spot}` : `at the ${spot}`;
}

/** "Left side", "At the back": a twin's spot on the line under a room's name. */
export function spotLabel(spot: TwinSpot): string {
  return spot === "left" ? "Left side" : spot === "right" ? "Right side" : spot === "back" ? "At the back" : "At the front";
}

/**
 * What tells apart the rooms the organisers gave one name on one floor ("Samp Square", "Cry
 * Room", "Water Station"): where each is, by the map (left / right; or, one behind the other,
 * back / front: the main foyer is the front, the bottom of the map), not the blueprint's room
 * number, which guests have no way to read. Room id -> its spot, for every such room whose spot is
 * its alone; a group where two would share one (three in a row) gets none, and its rooms fall
 * back to their numbers. `rooms` = the listed rooms (listedRooms()).
 */
export function twinSpots(rooms: readonly ClientRoom[]): Map<string, TwinSpot> {
  const groups = new Map<string, ClientRoom[]>();
  for (const r of rooms) {
    if (!r.named || r.kind === "stair" || r.kind === "elevator") continue;
    const key = `${r.level}|${r.name}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const out = new Map<string, TwinSpot>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const spots = group.map((r): TwinSpot => {
      const others = group.filter((o) => o !== r);
      const dx = r.label[0] - others.reduce((s, o) => s + o.label[0], 0) / others.length;
      const dy = r.label[1] - others.reduce((s, o) => s + o.label[1], 0) / others.length;
      // Map y grows down: the smaller y is further from the foyer, the back.
      return Math.abs(dx) >= Math.abs(dy) ? (dx < 0 ? "left" : "right") : dy < 0 ? "back" : "front";
    });
    if (new Set(spots).size !== group.length) continue;
    group.forEach((r, i) => out.set(r.id, spots[i]));
  }
  return out;
}

/**
 * A room by its own name: the organisers' team name as it is ("Ashro", "Ladies' Restroom"; never
 * with a number), else the blueprint's, with its number when that name repeats ("Classroom 123").
 */
export function blueprintTitleOf(r: ClientRoom, repeated: ReadonlyMap<string, number>): string {
  if (r.named) return r.name;
  return r.number && (repeated.get(r.name) ?? 0) > 1 ? `${r.name} ${r.number}` : r.name;
}

/**
 * A room as guests read it: the organisers' team name ("Sahajanand Hall"), else its first event
 * name ("Niyam", on a room the team-name table doesn't have), else its blueprint title.
 */
export function roomTitleOf(
  id: string,
  index: VenueIndex,
  roomById: ReadonlyMap<string, ClientRoom>,
  repeated: ReadonlyMap<string, number>,
): string {
  const r = roomById.get(id);
  if (r?.named) return r.name;
  return index.eventNames.get(id)?.[0] ?? (r ? blueprintTitleOf(r, repeated) : id);
}

/**
 * The title is the blueprint's description of the room ("Bath", "Office"), not a name of its own:
 * it reads "the Bath" in running text (withArticle()). Never for a room the organisers named.
 */
export function isGenericTitle(r: ClientRoom, title: string, blueprintTitle: (r: ClientRoom) => string): boolean {
  return !r.named && title === blueprintTitle(r);
}

/**
 * A room found by its floor's own name (the organisers call Mahant Hall "the Mezzanine", which is
 * also the floor): beside the floor's name (the steps' "up to the Mezzanine", a message's "don't
 * reach the Mezzanine") it goes by its own name, "Walk to Mahant Hall". Any other title stays.
 */
export function titleBesideFloor(r: ClientRoom, title: string, levelName: (id: VenueLevelId) => string): string {
  return r.named && normalizeVenueName(title) === normalizeVenueName(levelName(r.level)) ? r.name : title;
}

/** A room in running text: "the Main Foyer", "Ashro", "the Bath" (withArticle() + isGenericTitle()). */
export function placeTextOf(r: ClientRoom, title: string, blueprintTitle: (r: ClientRoom) => string): string {
  return withArticle(title, isGenericTitle(r, title, blueprintTitle));
}

/**
 * The destination's title: the name the guest picked it by, when that event name maps to it ("Main
 * Hall" for the room the map labels "Sahajanand Hall"); else its own title.
 */
export function destTitleOf(dest: ClientRoom, label: string | null, index: VenueIndex, titleOf: (id: string) => string): string {
  return label && index.aliases.get(normalizeVenueName(label))?.roomIds.includes(dest.id) ? label : titleOf(dest.id);
}

/**
 * Where the route starts in a room: a lobby's middle, else inside its door (startPointOf()); its
 * entry when the middle doesn't snap to the walkable grid. Null without an entry, and for a
 * staff-only room.
 */
export function routeStartPoint(start: ClientRoom | null, router: VenueRouter): VenuePoint | null {
  const p = start ? startPointOf(start) : null;
  if (!start || !p) return null;
  return p !== start.entry && router.snap({ level: start.level, point: p }) ? p : start.entry;
}

/**
 * A route from `start` (leaving from `from`, routeStartPoint()) to the room's outline, so it ends
 * at its nearest door (its entry is the fallback). Only the guest's side's stairs / elevators
 * (never the other side's as a fallback, unless a flow rule in `rules` allows one now). Both rooms
 * go to the router by id for the flow rules; a room left by its door (startsAtDoor()) starts at the
 * doors its rule allows. Null when either room has no directions (no entry, or staff only).
 */
export function routeBetween(
  router: VenueRouter,
  start: ClientRoom,
  from: VenuePoint,
  dest: ClientRoom,
  options: { stepFree: boolean; track: VenueTrack | null; rules?: RouteRules | null },
): RouteResult | null {
  if (!dest.entry || dest.closed || start.closed) return null;
  return router.route(
    { level: start.level, point: from, room: start.id, ...(startsAtDoor(start) && from === start.entry ? { fromDoors: true } : {}) },
    { level: dest.level, point: dest.entry, area: dest.pts, room: dest.id },
    { stepFree: options.stepFree, track: options.track, rules: options.rules ?? null },
  );
}

/** The numbered steps for a route, naming its ends as guests know them. */
export function stepsBetween(
  route: VenueRoute,
  start: ClientRoom,
  dest: ClientRoom,
  names: {
    startTitle: string;
    destTitle: string;
    blueprintTitle: (r: ClientRoom) => string;
    levelName: (id: VenueLevelId) => string;
    /** No line drawn beside the steps (see StepContext.noLine). */
    noLine?: boolean;
    /** A room walked through, in running text ("the Ladies' Gym"; StepContext.placeOf). */
    placeOf?: (roomId: string) => string | null;
  },
): RouteStep[] {
  // Named "Mezzanine" on the Mezzanine: the room's own name ("Mahant Hall").
  const startTitle = titleBesideFloor(start, names.startTitle, names.levelName);
  const destTitle = titleBesideFloor(dest, names.destTitle, names.levelName);
  return routeSteps(route, {
    startName: startTitle,
    destName: destTitle,
    // A blueprint description ("Bath"), not an event or team name: "the Bath".
    startGeneric: isGenericTitle(start, startTitle, names.blueprintTitle),
    destGeneric: isGenericTitle(dest, destTitle, names.blueprintTitle),
    destPolygon: dest.pts,
    levelName: names.levelName,
    noLine: names.noLine,
    placeOf: names.placeOf,
  });
}

/**
 * Why a room shows no steps although directions were asked for: staff only, no entry, no start,
 * no entry at the start, or no route (routeProblem()). Null when there is a route.
 */
export function directionsProblem(at: {
  dest: ClientRoom;
  destTitle: string;
  start: ClientRoom | null;
  startTitle: string | null;
  result: RouteResult | null;
  stepFree: boolean;
  track: VenueTrack | null;
  served: (elevatorsOnly: boolean) => ReadonlySet<VenueLevelId>;
  levelName: (id: VenueLevelId) => string;
}): string | null {
  const { dest, start, result } = at;
  if (result?.ok) return null;
  const destTitle = titleBesideFloor(dest, at.destTitle, at.levelName);
  if (dest.closed) return `${destTitle} is for staff only, so there are no directions to it.`;
  if (!dest.entry) return `There are no directions to ${destTitle} yet.`;
  if (!start) return "Choose where you are starting from.";
  if (start.closed) return `${at.startTitle ?? start.name} is for staff only: choose another start.`;
  if (!start.entry) return `There are no directions from ${at.startTitle ?? start.name} yet: choose another start.`;
  if (result && !result.ok) {
    return routeProblem(result, {
      dest: destTitle,
      startLevel: start.level,
      destLevel: dest.level,
      stepFree: at.stepFree,
      track: at.track,
      served: at.served,
      levelName: at.levelName,
    });
  }
  return `We couldn’t find a way to ${destTitle} from there. Please ask a volunteer.`;
}

/**
 * Under the steps: which stairs / elevators the directions use. With `route`, a stair on the other
 * side a flow rule lets the track use (RouteClimb.exception) is named too, so the note stays true
 * wherever it is read: "Bhaio directions use the stairs and elevators on the right; at this time
 * also the back stairs on the left." `when` = what the rules were taken for: "time" (/map: the
 * page's time, or the session a card's link names) or "session" (a /breakouts card, read at any
 * hour: "for this session also ...").
 */
export function routeNoteFor(
  track: VenueTrack | null,
  stepFreeOn: boolean,
  route?: VenueRoute | null,
  when: "time" | "session" = "time",
): string | null {
  const extra = [
    ...new Set(
      (route?.segments ?? []).flatMap((s) => (s.type === "connector" && s.exception && s.sideHint ? [connectorPhrase(s, s.sideHint)] : [])),
    ),
  ];
  if (track && extra.length > 0) {
    const things = stepFreeOn && ELEVATORS_FOLLOW_SIDE ? "elevators" : SIDE_THINGS;
    const lead = stepFreeOn ? "Step-free: " : "";
    return `${lead}${TRACK_NAME[track]} directions use the ${things} on the ${TRACK_SIDE[track]}; ${when === "session" ? "for this session" : "at this time"} also ${extra.join(" and ")}.`;
  }
  return track && stepFreeOn && ELEVATORS_FOLLOW_SIDE
    ? `Step-free: ${TRACK_NAME[track]} directions use only the elevators on the ${TRACK_SIDE[track]}.`
    : stepFreeOn
      ? "Step-free: elevators only."
      : track
        ? `${TRACK_NAME[track]} directions use only the ${SIDE_THINGS} on the ${TRACK_SIDE[track]}.`
        : null;
}

// ---------------------------------------------------------------------------
// A venue's lookups in one object (the server's; /map keeps its own per-render memos)
// ---------------------------------------------------------------------------

/** One venue map's lookups and router, for directions away from /map (see createVenueGuide()). */
export type VenueGuide = {
  venue: ClientVenue;
  index: VenueIndex;
  roomById: Map<string, ClientRoom>;
  /** listedRooms(): what /map offers as destinations and starts. */
  listed: ClientRoom[];
  /** /map's default start (defaultStart() over the listed rooms): the Main Foyer. */
  lobby: ClientRoom | null;
  router: VenueRouter;
  levelName: (id: VenueLevelId) => string;
  orderOf: (id: VenueLevelId) => number;
  titleOf: (id: string) => string;
  blueprintTitle: (r: ClientRoom) => string;
  /** A room in running text, as the steps name a room walked through ("the Ladies' Gym"). */
  placeOf: (id: string) => string | null;
};

/**
 * Every lookup /map builds for a venue, plus its router (the grids decoded, landings snapped):
 * build it once per map version and keep it. `index` = the page's name index (getVenueForPages());
 * `router` = one already built for this venue (createVenueRouter()), else a new one.
 */
export function createVenueGuide(venue: ClientVenue, index: VenueIndex, router: VenueRouter = createVenueRouter(venue)): VenueGuide {
  const rooms = venue.levels.flatMap((l) => l.rooms);
  const roomById = new Map(rooms.map((r) => [r.id, r]));
  const listed = listedRooms(rooms, index);
  const repeated = repeatedNames(rooms);
  const levelById = new Map(venue.levels.map((l) => [l.id, l]));
  return {
    venue,
    index,
    roomById,
    listed,
    lobby: defaultStart(listed),
    router,
    levelName: (id) => levelById.get(id)?.name ?? id,
    orderOf: (id) => levelById.get(id)?.order ?? 0,
    titleOf: (id) => roomTitleOf(id, index, roomById, repeated),
    blueprintTitle: (r) => blueprintTitleOf(r, repeated),
    placeOf: (id) => {
      const r = roomById.get(id);
      return r ? placeTextOf(r, roomTitleOf(id, index, roomById, repeated), (x) => blueprintTitleOf(x, repeated)) : null;
    },
  };
}

/** Steps (or why there are none) from one room to another, as /map's room sheet shows them. */
export type Directions = {
  steps: RouteStep[] | null;
  problem: string | null;
  /** Which stairs / elevators the steps use (shown under them only when there are steps). */
  note: string | null;
};

/**
 * The directions /map would show from `start` to `dest` for this guest (their track's side;
 * `stepFree` = elevators only, ignored when their side has no elevator, as /map's switch is).
 * `destTitle` = the name they know it by (destTitleOf()); `startTitle` likewise for the start (the
 * breakouts page names it as the schedule does); without it, the start's own title (as /map does).
 */
export function directionsFor(
  guide: VenueGuide,
  start: ClientRoom | null,
  dest: ClientRoom,
  opts: {
    destTitle: string;
    startTitle?: string | null;
    track: VenueTrack | null;
    stepFree: boolean;
    noLine?: boolean;
    /** The flow rules in force (flowRules.ts routeRulesFor()); null / absent = none. */
    rules?: RouteRules | null;
    /** What the rules were taken for (routeNoteFor()): a /breakouts card's session, else the page's time. */
    when?: "time" | "session";
  },
): Directions {
  const { venue, router } = guide;
  const usable = usableConnectorIds(venue.connectors, opts.track);
  const stepFreeOn = opts.stepFree && canStepFreeWith(venue.connectors, usable);
  const from = routeStartPoint(start, router);
  const result =
    start && from ? routeBetween(router, start, from, dest, { stepFree: stepFreeOn, track: opts.track, rules: opts.rules }) : null;
  const route = result?.ok ? result.route : null;
  const startTitle = start ? (opts.startTitle ?? guide.titleOf(start.id)) : null;
  const steps =
    route && start && startTitle
      ? stepsBetween(route, start, dest, {
          startTitle,
          destTitle: opts.destTitle,
          blueprintTitle: guide.blueprintTitle,
          levelName: guide.levelName,
          noLine: opts.noLine,
          placeOf: guide.placeOf,
        })
      : null;
  const problem = steps
    ? null
    : directionsProblem({
        dest,
        destTitle: opts.destTitle,
        start,
        startTitle,
        result,
        stepFree: stepFreeOn,
        track: opts.track,
        served: (elevatorsOnly) => servedLevelsOf(venue.connectors, usable, elevatorsOnly),
        levelName: guide.levelName,
      });
  return { steps, problem, note: routeNoteFor(opts.track, stepFreeOn, route, opts.when) };
}
