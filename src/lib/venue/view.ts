/**
 * The venue map as the browser gets it (toClientVenue() in src/lib/venue/clientVenue.ts; for the
 * Pujya Santo view toSantClientVenue()) and the pure helpers the map UI shares. Client-safe: no
 * database, no file system, no blueprint names of rooms this viewer isn't shown (those arrive as
 * bare outlines in `blocks`).
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
} from "./types";

/**
 * A room this viewer is shown (public; in the Pujya Santo payload also a residence room
 * SANT_ROOM_NAMES names): named, searchable, routable when it has an entry.
 */
export type ClientRoom = {
  id: string;
  level: VenueLevelId;
  kind: VenueRoomKind;
  /**
   * The name guests read: the organisers' team name when the room has one (`named`; "Ashro",
   * "Main Foyer"), else the blueprint's ("Classroom", "Lobby"; or the organisers' own where the
   * extraction was given one). A stair / elevator room's is shaftRoomName(): by its place, never
   * a number.
   */
  name: string;
  /**
   * True = `name` is a proper name given to the room: the organisers' (VENUE_ROOM_NAMES, applied
   * by toClientVenue()), or in the Pujya Santo payload the user's for a residence room
   * (SANT_ROOM_NAMES, applied by toSantClientVenue()). Shown as it is, without the room number,
   * and read as a proper name in running text ("Ashro", not "the Ashro"; see isGenericTitle() in
   * directions.ts). Absent on a room that keeps the blueprint's description.
   */
  named?: boolean;
  number: string | null;
  /** Outline as flat [x0, y0, x1, y1, ...], rounded to 0.1 map unit. */
  pts: number[];
  label: VenuePoint;
  /** Null = no directions to or from it (always null for a `closed` room). */
  entry: VenuePoint | null;
  /**
   * True = staff only (VenueRoom.closed): drawn, named, searchable and tappable, but never a
   * start or a destination and never walked through. Absent on every other room.
   */
  closed?: boolean;
  /**
   * The Pujya Santo payload only (toSantClientVenue()), never a delegate's: a room of the sadhus'
   * residence, sent under the name the user gave it (SANT_ROOM_NAMES) with no number. Only "own"
   * rooms are sent as rooms; the router never uses one as a way through on someone else's trip
   * unless nothing else gets there (route.ts THROUGH_QUARTERS).
   */
  sant?: VenueSantClass;
};

export type ClientLevel = {
  id: VenueLevelId;
  name: string;
  order: number;
  bounds: { x: number; y: number; width: number; height: number };
  walls: string;
  grid: VenueGrid;
  /**
   * The Pujya Santo payload only, never a delegate's: the grid every other viewer gets for this level
   * (`grid` is then the santos' floor, the sadhus' residence included). route.ts routes a trip that
   * neither starts nor ends in the residence over it, so such a trip is the delegates' route exactly.
   */
  guestGrid?: VenueGrid;
  rooms: ClientRoom[];
  /**
   * Rooms not shown to this viewer (back-of-house, private): outlines only, flat [x0, y0, ...], no
   * id, name or number. In the Pujya Santo payload the residence floor santos walk is not among
   * them (it is sent as nothing: plain floor to them).
   */
  blocks: number[][];
};

export type ClientVenue = {
  generatedAt: string;
  /** Bottom to top (by `order`: basement, first floor, second floor, mezzanine). */
  levels: ClientLevel[];
  /**
   * Stairs and elevators, with their `side` and `place` when they have one (not sensitive: routing
   * and the steps need them). `name` is connectorLabel() ("Stairs" / "Elevator"), never a number.
   */
  connectors: VenueConnector[];
};

/** A stair / elevator on the map and in lists: "Stairs" / "Elevator". Never numbered: the building has no stair signs. */
export function connectorLabel(c: Pick<VenueConnector, "kind">): string {
  return c.kind === "stair" ? "Stairs" : "Elevator";
}

/**
 * A stair / elevator in running text, by where it is: "the foyer stairs", "the side stairs", "the
 * back stairs", "the foyer elevator", "the back elevator"; "the stairs" / "the elevator" when the
 * map gives it no place (one extracted before 2026-10-01). `sideHint` adds "on the left" / "on
 * the right": for a guest who may use both of a pair (no gender on file). Stairs are plural
 * (connectorPronoun()).
 */
export function connectorPhrase(c: Pick<VenueConnector, "kind"> & { place?: VenuePlace | null }, sideHint?: VenueSide | null): string {
  const noun = c.kind === "stair" ? "stairs" : "elevator";
  return `the ${c.place ? `${c.place} ` : ""}${noun}${sideHint ? ` on the ${sideHint}` : ""}`;
}

/** "them" for stairs, "it" for an elevator: "take them up to the Second Floor". */
export function connectorPronoun(c: Pick<VenueConnector, "kind">): "them" | "it" {
  return c.kind === "stair" ? "them" : "it";
}

/**
 * A stair / elevator room's name, as scripts/venue/extract.py writes it: "Foyer Stairs", "Side
 * Stairs", "Back Stairs", "Foyer Elevator", "Back Elevator"; "Stairs" / "Elevator" without a place.
 * toClientVenue() sets it on every shaft room, so a stored map's numbered names ("Stair 5") never
 * reach the browser.
 */
export function shaftRoomName(kind: "stair" | "elevator", place?: VenuePlace | null): string {
  const noun = kind === "stair" ? "Stairs" : "Elevator";
  return place ? `${place.charAt(0).toUpperCase()}${place.slice(1)} ${noun}` : noun;
}

/** Room kinds that aren't destinations: not labelled on the map and not offered in search. */
export const UNLISTED_KINDS: ReadonlySet<VenueRoomKind> = new Set(["corridor"]);

/** Big rooms you could be anywhere in: directions from them start in their middle. */
const START_IN_MIDDLE: ReadonlySet<VenueRoomKind> = new Set(["lobby", "other", "hall", "dining"]);

/**
 * Where directions from a room start: the middle of a lobby, open area, hall or shop (you are
 * somewhere in it, and the route leaves by whichever door suits; a lobby's entry is only its
 * opening towards the corridors, not the main doors), else just inside the room's main door.
 * Null when the room has no entry or is staff only (no directions from it). The router snaps the point to the
 * nearest walkable cell; callers fall back to `entry` when it can't.
 */
export function startPointOf(r: Pick<ClientRoom, "kind" | "label" | "entry" | "closed">): VenuePoint | null {
  if (!r.entry || r.closed) return null;
  return START_IN_MIDDLE.has(r.kind) ? r.label : r.entry;
}

/**
 * Directions from this room start at its door (a room, an office), not in its middle (startPointOf()):
 * with a flow rule on its exits they start at the doors it allows (route.ts RouteEnd.fromDoors).
 */
export function startsAtDoor(r: Pick<ClientRoom, "kind">): boolean {
  return !START_IN_MIDDLE.has(r.kind);
}

/** How near (map units) a shaft room's label must be to a connector's landing on its floor to be that connector. */
const SHAFT_MATCH = 200;

/**
 * The stair / elevator a shaft room belongs to: the connector named by its id
 * (`<level>-<connector id>`, "2-stair-3"), else the nearest one of its kind with a landing on its
 * floor (within SHAFT_MATCH). Null for other rooms and unmatched shafts.
 */
export function connectorOfRoom(
  r: Pick<ClientRoom, "id" | "level" | "kind" | "label">,
  connectors: readonly VenueConnector[],
): VenueConnector | null {
  if (r.kind !== "stair" && r.kind !== "elevator") return null;
  const byId = connectors.find((c) => `${r.level}-${c.id}` === r.id);
  if (byId) return byId;
  let best: VenueConnector | null = null;
  let bestD = SHAFT_MATCH;
  for (const c of connectors) {
    const p = c.points[r.level];
    if (c.kind !== r.kind || !p) continue;
    const d = Math.hypot(p[0] - r.label[0], p[1] - r.label[1]);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

export function polygonPath(pts: number[]): string {
  if (pts.length < 6) return "";
  let d = `M${pts[0]} ${pts[1]}`;
  for (let i = 2; i < pts.length; i += 2) d += `L${pts[i]} ${pts[i + 1]}`;
  return `${d}Z`;
}

export type Box = { x0: number; y0: number; x1: number; y1: number };

export function boxOf(pts: number[]): Box {
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
  return { x0, y0, x1, y1 };
}

export function boxOfPoints(points: VenuePoint[]): Box | null {
  if (points.length === 0) return null;
  return boxOf(points.flat());
}

export function unionBox(a: Box | null, b: Box | null): Box | null {
  if (!a) return b;
  if (!b) return a;
  return { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };
}

/** Even-odd point in polygon (flat points). */
export function pointInPolygon(pts: number[], x: number, y: number): boolean {
  let inside = false;
  const n = pts.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = pts[2 * i];
    const yi = pts[2 * i + 1];
    const xj = pts[2 * j];
    const yj = pts[2 * j + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** The union of every level's bounds: the shared frame of the 3D stack. */
export function venueFrame(venue: ClientVenue) {
  let box: Box | null = null;
  for (const l of venue.levels) {
    box = unionBox(box, { x0: l.bounds.x, y0: l.bounds.y, x1: l.bounds.x + l.bounds.width, y1: l.bounds.y + l.bounds.height });
  }
  const b = box ?? { x0: 0, y0: 0, x1: 1, y1: 1 };
  return { x: b.x0, y: b.y0, width: b.x1 - b.x0, height: b.y1 - b.y0 };
}

/** "the Second Floor", "the Basement", "the Mezzanine": a level name in running text. */
export function levelPhrase(name: string): string {
  return /^the\s/i.test(name) ? name : `the ${name}`;
}

/** First words that make a room name generic, so it reads "the Main Hall", not "Main Hall". */
const GENERIC_START =
  /^(?:main|dining|sabha|men'?s|mens|ladies'?|lady'?s|women'?s|womens|girls?'?|girl'?s|boys?'?|boy'?s|upstairs|downstairs|small|large|upper|lower|2nd|1st|second|first|third|lobby|foyer|basement|mezzanine|mandir|green|guest|guestroom|kitchen|restroom|restrooms|bath|bathroom|cry|water|north|south|east|west|front|back|side|freight|multipurpose|multi-purpose|multi|assembly|reception|lounge|library|gym|stage|chapel|vestibule|corridor|hallway|stairs|elevator|elevators|classroom|office|conference|seminar|banquet|bookstore|shop|nursery|entrance|entry|exit)\b/i;

/**
 * A room name in running text: "the Main Foyer", "the Main Hall", "the Men's Gym", but "Niyam",
 * "Pramukh Hall", "Room 5", "Green Room 2", "Mezzanine Ladies Office 3" (a proper name or a
 * numbered thing takes no article).
 * `generic`: the name is the blueprint's description of the room ("Bath", "Office", "Classroom
 * 123"), never a proper name: it takes "the" unless it ends in a room number.
 */
export function withArticle(name: string, generic = false): string {
  const n = name.trim();
  if (/^the\s/i.test(n)) return n;
  if (/\d/.test(n) && /^(?:stair|stairs|elevator|room|rm)\b/i.test(n)) return n;
  // "Green Room 2", "Ladies Dance Room 2", "Classroom 123": numbered, so no article.
  if (/\s\d+[A-Za-z]?$/.test(n)) return n;
  if (generic) return `the ${n}`;
  return GENERIC_START.test(n) ? `the ${n}` : n;
}

/** Sentence start: capitalises a leading "the". */
export function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
