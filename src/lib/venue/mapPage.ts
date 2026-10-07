/**
 * What the two venue map pages share (server side: they resolve names on the server's name index,
 * whose per-track entries never reach the browser): the delegate hub's /map and the Pujya Santo
 * view's /sant/map. Each page resolves every name with its viewer's track (resolveVenueRoom()),
 * so a place with one room per track ("Samp Square") is theirs.
 */
import type { MapDeepLink, MapHere, QuickPlace } from "@/components/map/mapTypes";
import { HERE_PLACE_RE, MAP_ID_LIKE_RE, herePath, hereSlug } from "@/lib/here";
import { EVENT_DAYS, dayKey, formatDayShort, formatTime, parseInEventTz } from "@/lib/time";
import { normalizeVenueName, resolveVenueRoom, spreadOf, type VenueIndex } from "./aliases";
import { listedRooms, repeatedNames, roomTitleOf } from "./directions";
import type { ClientVenue } from "./view";
import type { RouteRules } from "./flowRules";
import type { VenueTrack } from "./types";

/**
 * The schedule's main places (prisma/seed.ts), offered to everyone as "Programme" chips and From
 * lines. Names of one room ("Main Hall" and "Sabha Hall" are both Sahajanand Hall) are offered
 * once, under the first (programmePlaces()).
 */
export const MAP_PLACES = ["Main Hall", "Dining Hall", "Mandir", "Sabha Hall"];

/** How long after its time a /breakouts card's ?at= still counts (after that its session is over). */
const AT_GRACE_MS = 60 * 60 * 1000;
const AT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

/**
 * The organisers' flow rules a map page (/map, /sant/map) sends its browser, and when they change:
 *  - taken at `?at=` (a /breakouts card's /map link: the printed start of the session the card
 *    worked its route out for, event-local "YYYY-MM-DDTHH:MM", sent only when a rule with a window
 *    applies then) when that is on an event day and not more than an hour gone, so the map opens
 *    the card's route whenever it is opened; `note` then says so, when those rules differ from the
 *    page's own time's;
 *  - else at the page's now (?now= honoured); `until` = when the rules in force next change (not
 *    while time-travelling): the page refreshes then (AutoRefresh skips the map pages), so an open
 *    map never keeps a rule whose window has closed, or misses one that has opened.
 */
export function mapRules(
  map: {
    rulesAt: (at: Date | null, track: VenueTrack | null) => RouteRules | null;
    nextRulesChange: (after: Date, track: VenueTrack | null) => Date | null;
  },
  atParam: string | string[] | undefined,
  now: Date,
  traveling: boolean,
  track: VenueTrack | null,
): { rules: RouteRules | null; until: string | null; note: string | null } {
  const raw = typeof atParam === "string" ? atParam.trim() : "";
  const at = AT_RE.test(raw) ? parseInEventTz(raw) : null;
  const usable =
    at !== null && !Number.isNaN(at.getTime()) && (EVENT_DAYS as readonly string[]).includes(dayKey(at)) && at.getTime() >= now.getTime() - AT_GRACE_MS;
  const current = map.rulesAt(now, track);
  if (usable) {
    const rules = map.rulesAt(at, track);
    const differs = (rules?.key ?? null) !== (current?.key ?? null);
    return {
      rules,
      until: null,
      note: differs ? `These directions are for your session at ${formatTime(at)}, ${formatDayShort(dayKey(at))}.` : null,
    };
  }
  const next = traveling ? null : map.nextRulesChange(now, track);
  return { rules: current, until: next ? next.toISOString() : null, note: null };
}

/** A ?to= / ?from= value as the map opens it, resolved for the viewer's track; null when absent or blank. */
export function mapDeepLink(value: string | string[] | undefined, index: VenueIndex, track: VenueTrack | null): MapDeepLink | null {
  if (typeof value !== "string") return null;
  const query = value.trim().slice(0, 200);
  if (!query) return null;
  const res = resolveVenueRoom(query, index, track);
  return { query, roomIds: res.roomIds, spread: spreadOf(res) };
}

/**
 * An NFC tag's place (?here=, src/lib/here.ts): a map id exactly (one that isn't on the map finds
 * nothing), else the slug as words ("main-foyer" -> "main foyer") resolved like any name but with
 * NO track: where a tag is doesn't
 * depend on who scans it, so a place with one room per track ("Samp Square"), or a name several
 * rooms share, finds no room (its tag must carry the map id; hereLinks() does that). Null when absent.
 */
export function mapHereLink(value: string | string[] | undefined, index: VenueIndex): MapHere | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!HERE_PLACE_RE.test(raw)) return null;
  const byId = index.rooms.get(raw);
  const label = raw.replace(/[-_.]+/g, " ").trim();
  // A map id no longer on the map (a re-extraction) finds nothing, never a room read from its words.
  const ids = byId ? [byId.id] : MAP_ID_LIKE_RE.test(raw) ? [] : resolveVenueRoom(label, index, null).roomIds;
  const roomIds = ids.length === 1 ? ids : [];
  const alias = byId || roomIds.length === 0 ? undefined : index.aliases.get(normalizeVenueName(label));
  return { label, name: alias?.roomIds.includes(roomIds[0]) ? alias.name : null, roomIds };
}

/**
 * Admins only (the room sheet's "NFC tag link"): the /here path a tag at each room guests can
 * start from should carry: its title as a slug when that finds exactly this room (mapHereLink()),
 * else its map id. Map id -> path.
 */
export function hereLinks(venue: ClientVenue, index: VenueIndex): Record<string, string> {
  const rooms = venue.levels.flatMap((l) => l.rooms);
  const roomById = new Map(rooms.map((r) => [r.id, r]));
  const repeated = repeatedNames(rooms);
  const out: Record<string, string> = {};
  for (const r of listedRooms(rooms, index)) {
    if (!r.entry || r.closed) continue;
    const slug = hereSlug(roomTitleOf(r.id, index, roomById, repeated));
    const bySlug = slug && HERE_PLACE_RE.test(slug) ? mapHereLink(slug, index)?.roomIds : undefined;
    const place =
      bySlug?.length === 1 && bySlug[0] === r.id && !MAP_ID_LIKE_RE.test(slug) ? slug : HERE_PLACE_RE.test(r.id) ? r.id : null;
    if (place) out[r.id] = herePath(place);
  }
  return out;
}

/** A one-tap place (a chip and a From line): `label` resolved for the viewer's track. */
export function mapPlace(key: string, label: string, context: string, index: VenueIndex, track: VenueTrack | null): QuickPlace {
  const res = resolveVenueRoom(label, index, track);
  return { key, label, context, roomIds: res.roomIds, spread: spreadOf(res) };
}

/**
 * MAP_PLACES as "Programme" places, one per room: a second name for a room already offered ("Sabha
 * Hall") is left out, and so are the names in `except` (/sant/map: "Dining Hall", the delegates'
 * dining rooms).
 */
export function programmePlaces(index: VenueIndex, track: VenueTrack | null, except: readonly string[] = []): QuickPlace[] {
  const places: QuickPlace[] = [];
  for (const name of MAP_PLACES) {
    if (except.includes(name)) continue;
    const p = mapPlace(`p-${normalizeVenueName(name)}`, name, "Programme", index, track);
    if (p.roomIds.length > 0 && places.some((o) => o.roomIds.join() === p.roomIds.join())) continue;
    places.push(p);
  }
  return places;
}
