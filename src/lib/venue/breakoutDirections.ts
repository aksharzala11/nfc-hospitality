/**
 * Server only: the breakouts page's "How to get there", worked out on the server so the browser
 * gets plain text (where from, where to, the numbered steps, why there are none, a /map link) and
 * never geometry, grids or the ids of back-of-house rooms.
 *
 * For each of a guest's breakout sessions:
 *  - START: where they are just before it (previousPlaceFor() in src/lib/schedule.ts: their other
 *    sessions and their own schedule), found on the map the way /map reads ?from= (the first of
 *    its rooms with an entry that isn't the other side's stair) and named as the schedule names it
 *    when that name maps to the room, so the From line and step 1 agree; a split place starts at
 *    the first one found and says so. Arriving (the day's first session, after a bus ride or an
 *    off-site place), a place with no room, an unconfirmed goshthi room, a shared session the two
 *    tracks come to from different places, a name not on the map yet or a room with no directions
 *    from it (staff only included) all start at /map's default start (the Main Foyer,
 *    defaultStart()) and say why in plain words.
 *  - DESTINATION: each of the session's rooms (several for a team split amongst rooms), picked the
 *    way /map reads ?to= (pickRoom()). The room the place before names (on the map or not) says
 *    "You’re already there"; a room not on the map yet says so and gets no link, and so does a
 *    staff-only room (no session should be in one: it reads like a room not on the map). With no
 *    directions to show, the From line says where they really are, never "directions start at the
 *    Main Foyer".
 *  - NAMES are resolved with the guest's track: a place with one room per track ("Samp Square")
 *    is theirs. With no gender on file it is the session's track's (a Bhaio session starts from, or
 *    is held in, Bhaio's; the /map link then names that room by its map id, so /map opens the same
 *    one); only for a session of both tracks is it the nearer of the two. A room listed by its
 *    floor's name ("Mezzanine") is shown under its own ("Mahant Hall") in the From line and the
 *    messages, as in the steps.
 *  - ROUTE: directionsFor() over the same toClientVenue() payload /map routes on, with the guest's
 *    track (their side's stairs / elevators) and Step-free off and on, so the steps and failure
 *    wording are /map's own; the /map link (?from= / ?to=, plus ?now= when time-travelling; the
 *    client adds ?stepFree=1 while its switch is on) opens the same route there. The flow rules are
 *    those in force at the session's printed start (rulesAt(), data.ts), so a rule with a window
 *    applies to the sessions it covers; when one does, the link carries that time (?at=) and /map
 *    takes the rules at it (mapRulesTime(), mapPage.ts), not at the hour it is opened.
 * The venue guide (lookups + router) is kept per payload object (one per parsed map), and each
 * route's text per (payload, track, step-free, flow rules in force, start, room): guests of one
 * team share them, so a page costs a few lookups once warm. Delegates only: it never takes the Pujya Santo payload
 * (toSantClientVenue(); breakoutWays() returns nothing for one), so no route text worked out over
 * the sadhus' residence can reach a delegate's page.
 */
import "server-only";
import { previousPlaceFor, type PlaceItem, type PlaceSession, type PreviousPlace } from "@/lib/schedule";
import { toEventLocalInput } from "@/lib/time";
import type { VenueTrack } from "./types";
import type { RouteRules } from "./flowRules";
import { looseVenueKey, normalizeVenueName, resolveVenueRoom, splitVenueNames, spreadOf, type VenueIndex } from "./aliases";
import { createVenueRouter, type VenueRouter } from "./route";
import {
  canStepFreeWith,
  createVenueGuide,
  destTitleOf,
  directionsFor,
  isOtherSideRoom,
  pickRoom,
  placeTextOf,
  titleBesideFloor,
  usableConnectorIds,
  type VenueGuide,
} from "./directions";
import { capitalise, withArticle, type ClientRoom, type ClientVenue } from "./view";

/** One way of getting there (with stairs, or step-free): plain text only. */
export type WayVariant = {
  /** The numbered steps ("Start at the Main Foyer (First Floor)", ...); null when there is no route. */
  steps: string[] | null;
  /** Why there are no steps, in /map's words; null when there are steps. */
  problem: string | null;
  /** Which stairs / elevators the steps use ("Bhaio directions use only ..."); only with steps. */
  note: string | null;
};

/** Where a guest starts for one room of a session (plain text). */
export type BreakoutWayFrom = {
  /** "From the Main Hall (after Keynote Program 1)", "From the Main Foyer, as you arrive". */
  label: string;
  /** "the Main Hall", "the Main Foyer"; null when there is no one place to name. */
  place: string | null;
  /** "after Keynote Program 1", "as you arrive"; null when it isn't where they just were. */
  context: string | null;
  /** Why directions start somewhere else, which of a split's rooms they start from, or why the place isn't known. */
  note: string | null;
};

/** Directions to one room of a session. */
export type BreakoutRoomWay = {
  /** The room as the session lists it ("Niyam"). */
  room: string;
  /**
   * Its floor ("Second Floor") when it is on the map: what the To line shows after the room. A
   * room listed by its floor's own name ("Mezzanine") shows the room's own name there instead
   * ("Mahant Hall"), never "Mezzanine · Mezzanine".
   */
  floor: string | null;
  /** Where they start: the directions' start, or (with a message instead) where they really are. */
  from: BreakoutWayFrom;
  /** Instead of directions: "Niyam isn’t on the map yet.", "You’re already there: stay in Niyam." */
  message: string | null;
  /** The message is "You’re already there" (the place before is this room). */
  here: boolean;
  /** With stairs (as /map starts); null with a message. */
  stairs: WayVariant | null;
  /** Step-free (elevators only); null when it reads the same as `stairs` or their side has no elevator. */
  stepFree: WayVariant | null;
  /**
   * The note under the steps while Step-free is on and the steps are the same either way (no
   * `stepFree` variant although their side has an elevator): /map's Step-free note, so the card
   * and the map it links to (?stepFree=1) say the same. Null otherwise.
   */
  stepFreeNote: string | null;
  /** The same route on /map (the client adds stepFree=1 while its switch is on); null when the room isn't on the map. */
  mapHref: string | null;
};

/** "How to get there" for one session (serialisable: the page hands it to the client). */
export type BreakoutWay = {
  /** One per room of the session, in the session's order. */
  rooms: BreakoutRoomWay[];
};

// ---------------------------------------------------------------------------
// Caches (module scope: one per server instance)
// ---------------------------------------------------------------------------

/** The router per payload object (decoding the grids is the costly part): never shared between two payloads. */
const routers = new WeakMap<ClientVenue, VenueRouter>();
/** The lookups over that router, per page payload and name index. */
let guideCache: { venue: ClientVenue; index: VenueIndex; guide: VenueGuide } | null = null;

/** The venue guide for this payload: built once per payload object (and name index), then reused. */
export function venueGuideFor(venue: ClientVenue, index: VenueIndex): VenueGuide {
  if (guideCache && guideCache.venue === venue && guideCache.index === index) return guideCache.guide;
  let router = routers.get(venue);
  if (!router) {
    router = createVenueRouter(venue);
    routers.set(venue, router);
  }
  const guide = createVenueGuide(venue, index, router);
  guideCache = { venue, index, guide };
  return guide;
}

/** Route texts by payload, track, step-free, start (and its name) and room (bounded; oldest out first). */
const wayCache = new Map<string, WayVariant>();
const WAY_CACHE_MAX = 2000;
/** A number per payload object for wayCache's keys (two payloads of one map version never share texts). */
const payloadTokens = new WeakMap<ClientVenue, number>();
let nextToken = 0;
function payloadToken(venue: ClientVenue): number {
  let t = payloadTokens.get(venue);
  if (t === undefined) {
    t = ++nextToken;
    payloadTokens.set(venue, t);
  }
  return t;
}

function wayBetween(
  guide: VenueGuide,
  start: MapStart,
  dest: ClientRoom,
  destTitle: string,
  track: VenueTrack | null,
  stepFree: boolean,
  rules: RouteRules | null,
): WayVariant {
  const key = [
    payloadToken(guide.venue),
    track ?? "any",
    stepFree ? "sf" : "st",
    rules?.key ?? "-",
    start.room?.id ?? "-",
    start.title ?? "",
    dest.id,
    destTitle,
  ].join("|");
  const hit = wayCache.get(key);
  if (hit) return hit;
  const d = directionsFor(guide, start.room, dest, { destTitle, startTitle: start.title, track, stepFree, noLine: true, rules, when: "session" });
  const way: WayVariant = { steps: d.steps ? d.steps.map((s) => s.text) : null, problem: d.problem, note: d.steps ? d.note : null };
  wayCache.set(key, way);
  if (wayCache.size > WAY_CACHE_MAX) wayCache.delete(wayCache.keys().next().value!);
  return way;
}

const sameWay = (a: WayVariant, b: WayVariant) =>
  a.problem === b.problem && (a.steps ?? []).join("\n") === (b.steps ?? []).join("\n") && Boolean(a.steps) === Boolean(b.steps);

// ---------------------------------------------------------------------------
// Start and destination
// ---------------------------------------------------------------------------

/** The rooms a schedule place names: "A · B" (a split session) and "A / B" both mean A and B. */
function placeNames(location: string): string[] {
  const names = splitVenueNames(location).flatMap((n) => n.split(/\s+\/\s+/).map((p) => p.trim()));
  return [...new Set(names.filter(Boolean))];
}

/** "A and B", "A, B and C" ("A or B" with `word` "or"). */
function listOf(names: readonly string[], word = "and"): string {
  return names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} ${word} ${names[names.length - 1]}`;
}

/** "From the Main Hall (after Keynote Program 1)"; "From Mahant Hall (Mezz), after Goshthi 1" (no "(Mezz) (after …)"). */
function fromLabel(place: string, context: string | null): string {
  if (!context) return `From ${place}`;
  return context.startsWith("after ") && !place.endsWith(")") ? `From ${place} (${context})` : `From ${place}, ${context}`;
}

/** "was", or "were" after several sessions' titles ("BM RA / KM RC"). */
const wasOf = (title: string) => (title.includes(" / ") ? "were" : "was");

type MapStart = {
  /** Where the directions start (a public room with an entry), null when the map offers none. */
  room: ClientRoom | null;
  /** The start's name in the steps (the schedule's, when it maps there); null = its own title. */
  title: string | null;
  /** The name /map's ?from= takes for it; null = /map's own default start (the Main Foyer). */
  query: string | null;
  /** The From line over directions from `room`. */
  from: BreakoutWayFrom;
  /** The From line with no directions to show (already there, not on the map): where they really are. */
  plain: BreakoutWayFrom;
  /** The rooms of the place before, as the schedule names them ([] unless it is a room). */
  names: string[];
  /** What was there ("Goshthi 1"); null when they arrive for the day's first session. */
  before: string | null;
};

/**
 * What a /map link takes for `name` so that it opens `room`: the name itself, or, when the guest's
 * own track (none) would be offered a choice the card already made by the session's track, the
 * room's map id (a public room's id: /map reads it like a name).
 */
function linkNameOf(name: string, room: ClientRoom, guide: VenueGuide, track: VenueTrack | null, nameTrack: VenueTrack | null): string {
  if (track === nameTrack) return name;
  return resolveVenueRoom(name, guide.index, track).parts.some((p) => p.either) ? room.id : name;
}

/** A name as the From line and the messages show it: a room listed by its floor's name under its own ("Mahant Hall"). */
function shownNameOf(name: string, guide: VenueGuide, nameTrack: VenueTrack | null): string {
  const id = resolveVenueRoom(name, guide.index, nameTrack).roomIds[0];
  const room = id ? guide.roomById.get(id) : undefined;
  return room ? titleBesideFloor(room, name, guide.levelName) : name;
}

/**
 * A PreviousPlace on the map (see the file comment). Pure over the guide. `track` = the guest's
 * (their side's stairs); `nameTrack` = whose room a per-track place means: theirs, else the
 * session's (default: `track`).
 */
export function startOnMap(
  prev: PreviousPlace,
  guide: VenueGuide,
  track: VenueTrack | null,
  nameTrack: VenueTrack | null = track,
): MapStart {
  const { index, roomById, lobby, venue } = guide;
  // As /map names its default start in its notices ("the Main Foyer").
  const lobbyPlace = lobby ? placeTextOf(lobby, guide.titleOf(lobby.id), guide.blueprintTitle) : null;
  const fromLobby = (context: string | null, note: string | null): BreakoutWayFrom =>
    lobbyPlace
      ? { label: fromLabel(lobbyPlace, context), place: lobbyPlace, context, note }
      : { label: "Choose where you are starting from on the map", place: null, context: null, note };
  const atLobby = (from: BreakoutWayFrom, plain: BreakoutWayFrom, names: string[] = []): MapStart => ({
    room: lobby,
    title: null,
    query: null,
    from,
    plain,
    names,
    before: prev.title,
  });
  const so = (reason: string) => (lobbyPlace ? `${reason}, so directions start at ${lobbyPlace}.` : `${reason}.`);

  if (prev.kind === "arriving") {
    const context = prev.title ? `after ${prev.title}` : "as you arrive";
    const plain: BreakoutWayFrom = lobbyPlace
      ? fromLobby(context, null)
      : { label: capitalise(context), place: null, context: null, note: null };
    return atLobby(fromLobby(context, prev.offSite ? so(`${prev.offSite} is away from the mandir`) : null), plain);
  }
  if (prev.kind === "unknown") {
    const reason =
      prev.reason === "tracks"
        ? "Bhaio and Behno come to this session from different places"
        : prev.reason === "tbc"
          ? `The room for ${prev.title} isn’t confirmed yet`
          : `${prev.title} has no room listed`;
    const plain: BreakoutWayFrom = {
      label: prev.reason === "tracks" ? "Depends on your track" : `After ${prev.title}`,
      place: null,
      context: null,
      note: `${reason}.`,
    };
    return atLobby(fromLobby(null, so(reason)), plain);
  }

  const names = placeNames(prev.location);
  const context = `after ${prev.title}`;
  const shown = (n: string) => withArticle(shownNameOf(n, guide, nameTrack));
  // Where they really are, as the schedule names it (one of a split's rooms: "Niyam or the Men's Gym").
  const plainPlace = listOf(names.map(shown), "or");
  const plain: BreakoutWayFrom = { label: fromLabel(plainPlace, context), place: plainPlace, context, note: null };

  // The first of its rooms /map would start from: one with an entry, not the other side's stair.
  const usable = usableConnectorIds(venue.connectors, track);
  for (const name of names) {
    // Their track's room for a per-track place (the session's, with no gender on file); never a
    // staff-only room (no entry).
    const id = resolveVenueRoom(name, index, nameTrack)
      .roomIds.filter((i) => roomById.get(i)?.entry)
      .find((i) => !isOtherSideRoom(roomById.get(i)!, venue.connectors, usable));
    if (!id) continue;
    const room = roomById.get(id)!;
    // The schedule's name when it maps to this room ("Boy's Gym"), else the map's: step 1 says the same.
    const title = destTitleOf(room, name, index, guide.titleOf);
    // Beside "(after ...)" a room listed by its floor's name goes by its own, as step 1 has it.
    const place = placeTextOf(room, titleBesideFloor(room, title, guide.levelName), guide.blueprintTitle);
    const note = names.length > 1 ? `${prev.title} ${wasOf(prev.title)} in ${listOf(names.map(shown))}: directions start from ${place}.` : null;
    return {
      room,
      title,
      query: linkNameOf(name, room, guide, track, nameTrack),
      from: { label: fromLabel(place, context), place, context, note },
      plain,
      names,
      before: prev.title,
    };
  }
  // "The Main Hall, where Keynote Program 1 was, isn’t on the map yet" (not "Mahant Hall (Mezz) (Goshthi 1)").
  const where = listOf(names.map(shown));
  const was = `where ${prev.title} ${wasOf(prev.title)}`;
  const onMap = names.some((n) => resolveVenueRoom(n, index, nameTrack).roomIds.length > 0);
  const reason = onMap
    ? `There are no directions yet from ${where}, ${was}`
    : `${capitalise(where)}, ${was}, ${names.length > 1 ? "aren’t" : "isn’t"} on the map yet`;
  return atLobby(fromLobby(null, so(reason)), plain, names);
}

/** What the To line shows after the room: its floor, or (a room listed by its floor's name) the room's own name. */
function floorOf(guide: VenueGuide, room: ClientRoom, listedAs: string): string {
  const floor = guide.levelName(room.level);
  const own = titleBesideFloor(room, listedAs, guide.levelName);
  return own === listedAs ? floor : own;
}

function roomWay(
  guide: VenueGuide,
  start: MapStart,
  name: string,
  track: VenueTrack | null,
  nameTrack: VenueTrack | null,
  stepFreeOk: boolean,
  now: string | undefined,
  rules: RouteRules | null,
  rulesFor: string | undefined,
): BreakoutRoomWay {
  const res = resolveVenueRoom(name, guide.index, nameTrack);
  // A staff-only room has no directions: a session in one reads like a room not on the map yet.
  const toIds = res.roomIds.filter((id) => {
    const r = guide.roomById.get(id);
    return Boolean(r) && !r!.closed;
  });
  const none = { stairs: null, stepFree: null, stepFreeNote: null };
  // `to` = the room the card settled on (its map id replaces the name only when /map, resolving
  // for the guest's own track, would have to choose again: linkNameOf()). `at` = the time the
  // card's flow rules were taken for, when a rule with a window applies then: /map takes the rules
  // at it, so it opens the card's route whenever it is opened.
  const href = (from: string | null, to: ClientRoom) => {
    const q = new URLSearchParams();
    if (from) q.set("from", from);
    q.set("to", linkNameOf(name, to, guide, track, nameTrack));
    if (rulesFor) q.set("at", rulesFor);
    if (now) q.set("now", now);
    return `/map?${q.toString()}`;
  };

  // Already there: the place before names this room (mapped or not), or its start on the map is this
  // room. Only the real place before counts (start.query), never the Main Foyer it may fall back to.
  const key = normalizeVenueName(name);
  const sameName = start.names.some((n) => normalizeVenueName(n) === key);
  const sameRoom = start.query !== null && start.room !== null && toIds.includes(start.room.id);
  if (sameName || sameRoom) {
    const at = sameRoom
      ? start.room!
      : toIds.length > 0
        ? guide.roomById.get(pickRoom(toIds, spreadOf(res), null, guide.roomById, guide.orderOf)!)!
        : null;
    // A room listed by its floor's name ("Mezzanine") goes by its own here: "stay in Mahant Hall".
    const title = at ? titleBesideFloor(at, destTitleOf(at, name, guide.index, guide.titleOf), guide.levelName) : name;
    const shown = at ? placeTextOf(at, title, guide.blueprintTitle) : withArticle(title);
    // One room under two names ("Boy's Gym" before, "Men's Gym" now): say so (not for two
    // spellings of one name, "Mahant Hall" and "Mahant Hall (Mezz)").
    const before = sameRoom && start.title ? titleBesideFloor(start.room!, start.title, guide.levelName) : null;
    const alsoKnownAs =
      before && !sameName && looseVenueKey(before) !== looseVenueKey(title) ? placeTextOf(start.room!, before, guide.blueprintTitle) : null;
    return {
      room: name,
      floor: at ? floorOf(guide, at, name) : null,
      from: start.plain,
      // A split place: they were in one of its rooms, maybe not this one.
      message:
        start.names.length > 1
          ? `If you were in ${alsoKnownAs ?? shown} for ${start.before}, stay there.`
          : alsoKnownAs
            ? `You’re already there: ${alsoKnownAs} is ${shown}.`
            : `You’re already there: stay in ${shown}.`,
      here: true,
      ...none,
      // /map from and to this room ("You're already at …"), not a route from the Main Foyer.
      mapHref: at ? href(sameRoom ? start.query : linkNameOf(name, at, guide, track, nameTrack), at) : null,
    };
  }

  if (toIds.length === 0) {
    return { room: name, floor: null, from: start.plain, message: `${name} isn’t on the map yet.`, here: false, ...none, mapHref: null };
  }
  const dest = guide.roomById.get(pickRoom(toIds, spreadOf(res), start.room, guide.roomById, guide.orderOf)!)!;
  const destTitle = destTitleOf(dest, name, guide.index, guide.titleOf);
  const stairs = wayBetween(guide, start, dest, destTitle, track, false, rules);
  const stepFree = stepFreeOk ? wayBetween(guide, start, dest, destTitle, track, true, rules) : null;
  const same = stepFree ? sameWay(stairs, stepFree) : false;
  return {
    room: name,
    floor: floorOf(guide, dest, name),
    from: start.from,
    message: null,
    here: false,
    stairs,
    stepFree: stepFree && !same ? stepFree : null,
    // The same steps either way (no climb): with Step-free on, the note is still /map's Step-free one.
    stepFreeNote: stepFree && same ? stepFree.note : null,
    mapHref: href(start.query, dest),
  };
}

/**
 * "How to get there" for each of a guest's breakout sessions, by session id.
 *  - `sessions`: getBreakoutsForUser(guest) (every one of theirs: they are each other's starts);
 *  - `items`: their schedule, as previousPlaceFor() takes it (forAudience() + personalizeGoshthi());
 *  - `track`: venueTrackOf(tracksFor(trackGender(guest))) (null = no gender on file: any stairs,
 *    and a place with one room per track is then the session's track's);
 *  - `now`: the page's ?now= while time-travelling, carried on the /map links;
 *  - `rulesAt`: the flow rules in force at a time for this guest's track (getVenueForPages()'s
 *    rulesAt with their track; null = no time: the rules without a window), taken at each
 *    session's printed start (originalStartsAt, else startsAt: the windows describe the printed
 *    programme, so a live delay doesn't take a session out of its rules); absent = none. When a
 *    rule with a window applies then, the /map links carry that time (?at=, event-local).
 * Sessions with no room get no entry.
 */
export function breakoutWays(input: {
  venue: ClientVenue;
  index: VenueIndex;
  sessions: readonly (PlaceSession & { originalStartsAt?: Date | string | null })[];
  items: readonly PlaceItem[];
  track: VenueTrack | null;
  now?: string;
  rulesAt?: (at: Date | null) => RouteRules | null;
}): Record<string, BreakoutWay> {
  // Never the Pujya Santo payload (the sadhus' residence): a santo "How to get there" isn't
  // designed, and its texts must never be cached where a delegate's page could read them. The
  // cards then read as with no map.
  if (input.venue.levels.some((l) => l.guestGrid || l.rooms.some((r) => r.sant))) return {};
  const guide = venueGuideFor(input.venue, input.index);
  const stepFreeOk = canStepFreeWith(guide.venue.connectors, usableConnectorIds(guide.venue.connectors, input.track));
  const out: Record<string, BreakoutWay> = {};
  // The rules without a window: a session whose rules differ has a windowed rule in force.
  const always = input.rulesAt?.(null) ?? null;
  for (const s of input.sessions) {
    const names = splitVenueNames(s.room);
    if (names.length === 0) continue;
    // Whose room a per-track place means: the guest's, else (no gender on file) the session's.
    const nameTrack: VenueTrack | null = input.track ?? (s.audience === "BHAIO" || s.audience === "BEHNO" ? s.audience : null);
    const start = startOnMap(previousPlaceFor(s, input.sessions, input.items), guide, input.track, nameTrack);
    // The flow rules in force at the session's printed start (a rule's window covers the walk to it).
    const printed = new Date(s.originalStartsAt ?? s.startsAt);
    const rules = input.rulesAt?.(printed) ?? null;
    const rulesFor = (rules?.key ?? null) !== (always?.key ?? null) ? toEventLocalInput(printed) : undefined;
    out[s.id] = { rooms: names.map((n) => roomWay(guide, start, n, input.track, nameTrack, stepFreeOk, input.now, rules, rulesFor)) };
  }
  return out;
}
