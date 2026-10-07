/**
 * The venue map's data: the mandir's public floors as the Hub draws and routes them.
 * Generated from the organisers' blueprint (a vector CAD PDF) by
 * `scripts/venue/extract.py` and stored in the `venue_maps` table by
 * `npm run venue:import`; never committed, never in /public, and only ever sent to
 * signed-in pages as props.
 *
 * Coordinates are map units in one frame shared by every level (so floors stack in
 * the 3D overview): 1 unit = 1 PDF point of the blueprint after its sheet rotation is
 * undone and the sheets are aligned on their shared stair / elevator shafts; x grows
 * right, y grows down (SVG).
 */

/**
 * Levels, bottom to top: basement (B), first floor (1), second floor (2), mezzanine (M). The
 * mezzanine is the TOP floor, above the second floor (organisers, 2026-09-30), so B < 1 < 2 < M
 * by `VenueLevel.order` (0, 1, 2, 3). Code orders levels by `order`, never by these ids.
 */
export type VenueLevelId = "B" | "1" | "2" | "M";

/**
 * A guest's track, which decides the stairs they may use (src/lib/venue/route.ts TRACK_SIDE):
 * Bhaio (gents, users.gender MALE) the right-hand ones, Behno (ladies, FEMALE) the left-hand ones.
 * Null (no track) only for an account with no gender on file: any. Admins follow their gender
 * like anyone else.
 */
export type VenueTrack = "BHAIO" | "BEHNO";

/** Which half of the map (as the app draws it) a stair or elevator is in. */
export type VenueSide = "left" | "right";

/**
 * Where a stair or elevator is in the building, which is how guests are told which one to take
 * (the building has no stair signs; organisers, 2026-10-01): "foyer" = beside the main foyer (near
 * the building's central axis), "side" = off the axis in the front half (the half the main lobby is
 * in), "back" = off the axis in the far half. With a guest's side (TRACK_SIDE) that names one stair:
 * "the foyer stairs", "the side stairs", "the back stairs", "the foyer elevator", "the back elevator".
 */
export type VenuePlace = "foyer" | "side" | "back";

export type VenuePoint = [number, number];

/**
 * A room of the sadhus' residence as the Pujya Santo view treats it (VenueRoom.sant):
 *  - "own": a sadhu's own room: shown to santos, named, a start and a destination, and never a way
 *    through on someone else's trip (unless nothing else gets there);
 *  - "shared": another room of the residence santos walk: never named or shown;
 *  - "way": the residence's corridors, its common area, its stair / elevator shafts, and a room that
 *    is the only way into an own room: walkable for santos, never named or shown.
 */
export type VenueSantClass = "own" | "shared" | "way";

export type VenueRoomKind =
  | "room"
  | "hall"
  | "corridor"
  | "lobby"
  | "restroom"
  | "stair"
  | "elevator"
  | "exit"
  | "dining"
  | "other";

export type VenueRoom = {
  /** Stable id: `<level>-<room number>` ("1-999", "B-099A"), else `<level>-<slug of the name>`. */
  id: string;
  level: VenueLevelId;
  /** The blueprint's room number ("999", "099A"), null when it has none. */
  number: string | null;
  /** The blueprint's name, tidied to title case ("Classroom", "Lobby"). */
  name: string;
  kind: VenueRoomKind;
  /**
   * False = back-of-house (electrical, IT, boiler, storage, ...): drawn as a plain block,
   * never labelled, searched or routed to. Only public rooms carry their name to the client.
   */
  public: boolean;
  /** Simplified outline, closed implicitly (first point not repeated). */
  polygon: VenuePoint[];
  /** Where the label goes (inside the polygon). */
  label: VenuePoint;
  /** A walkable point just inside the room's main door: the route's end. Null = unreachable. */
  entry: VenuePoint | null;
  /**
   * True = STAFF ONLY on the organisers' plans (organisers, 2026-10-01): the room stays drawn and
   * named (`public` is true; sent to the browser, it is not sensitive), but there are no directions
   * to it, from it or through it: its `entry` is null and its floor is not walkable. Absent on
   * every other room (and on maps extracted before 2026-10-01).
   */
  closed?: boolean;
  /**
   * Set only on a room of the sadhus' residence (with `public: false`, never `closed`): what the
   * Pujya Santo view does with it (VenueSantClass). The room stays `public: false`, `entry: null`
   * and keeps its stored name: delegates and admins get it as a bare outline like any private room;
   * only toSantClientVenue() (clientVenue.ts) shows an "own" one, under the name the user gave it
   * (SANT_ROOM_NAMES, aliasTable.ts), never the stored one.
   */
  sant?: VenueSantClass;
  /**
   * Only with `sant`: the room's entry on its level's `santGrid` (a shaft room's = its connector's
   * santo landing, VenueConnector.santPoints). Null = none found.
   */
  santEntry?: VenuePoint | null;
  /**
   * The room's door openings on the level's (delegates') walkable grid, as scripts/venue/extract.py
   * finds them (room_doors()): the walkable cells just outside the outline that touch walkable cells
   * inside it, in 8-connected groups. Only on public rooms guests can go to (not staff only, not a
   * stair / elevator); absent on a map extracted before 2026-10-04. Flow rules (`flowRules`) name
   * doors by `id`; the router finds the same opening on the same grid by `at` (flowRules.ts).
   */
  doors?: VenueDoor[];
};

/** One door opening of a room (VenueRoom.doors). */
export type VenueDoor = {
  /**
   * "<room id>:<side><n>": the side of the room's box the opening is on (n / e / s / w) and its
   * number along that side (west to east on n / s, north to south on e / w). Stable while the
   * blueprint and the extractor's arguments are.
   */
  id: string;
  /** The middle of the opening's cells. */
  at: VenuePoint;
  /** Its extent in map units. */
  width: number;
  /** The room on the other side (its map id), null when there is none (open floor in no room). */
  to: string | null;
};

/** A stair or elevator shaft joining levels (the only way between floors). */
export type VenueConnector = {
  /** "stair-5", "elev-1". */
  id: string;
  kind: "stair" | "elevator";
  /**
   * "Stairs" / "Elevator". Never shown to guests as it is stored: a map extracted before 2026-10-01
   * has the blueprint's numbers here ("Stair 5"), and the building has no stair signs, so the app
   * names a connector by its kind and `place` (connectorPhrase() / connectorLabel(), view.ts).
   */
  name: string;
  /** Where it lands on each level it serves (a walkable point beside the shaft). */
  points: Partial<Record<VenueLevelId, VenuePoint>>;
  /**
   * The half of the map it is in, as the app draws it (x in the shared frame against the
   * building's central axis; scripts/venue/extract.py, overridable with --side): Bhaio use only
   * the right-hand stairs, Behno only the left-hand ones (and elevators the same while
   * ELEVATORS_FOLLOW_SIDE, src/lib/venue/route.ts). Absent = anyone may use it. Not sensitive:
   * sent to the browser as is.
   */
  side?: VenueSide;
  /**
   * Where it is in the building (scripts/venue/extract.py, overridable with --place). Absent on a
   * map extracted before 2026-10-01: directions then say "the stairs" / "the elevator". Not
   * sensitive: sent to the browser as is.
   */
  place?: VenuePlace;
  /**
   * Landings only the Pujya Santo view uses: on levels `points` lacks (a stair / elevator whose
   * landing there opens only into the sadhus' residence). Never repeats a level of `points`, and
   * never makes a connector by itself (a connector always has two levels in `points`).
   */
  santPoints?: Partial<Record<VenueLevelId, VenuePoint>>;
};

/** Where people can walk on a level, as a coarse grid (walls, back-of-house and staff-only rooms and voids blocked). */
export type VenueGrid = {
  /** Cell size in map units. */
  cell: number;
  cols: number;
  rows: number;
  /** Map coordinates of the top-left corner of cell (0, 0). */
  origin: VenuePoint;
  /** Row-major bitset, 1 = walkable, packed 8 cells per byte (bit 7 first), base64. */
  walkable: string;
};

export type VenueLevel = {
  id: VenueLevelId;
  /** "Basement", "First Floor", "Second Floor", "Mezzanine". */
  name: string;
  /** Height rank, 0 = lowest: B 0, 1 1, 2 2, M 3 (the mezzanine is on top). Floor lists, the 3D stack and routing use it. */
  order: number;
  /** The level's bounding box in map units (the SVG viewBox). */
  bounds: { x: number; y: number; width: number; height: number };
  /** SVG path data of the building's walls on this level (simplified; no text, furniture or dimensions). */
  walls: string;
  rooms: VenueRoom[];
  grid: VenueGrid;
  /**
   * The Pujya Santo view's walkable grid: in exactly `grid`'s frame (the same cell, cols, rows and
   * origin), every walkable cell of `grid` plus the sadhus' residence floor (openings without a door
   * swing sealed). Only on a level with `sant` rooms; absent = `grid`.
   */
  santGrid?: VenueGrid;
};

/**
 * `version` stays 1: every field added since 2026-09-28 (`closed`, `side`, `place`, the Pujya
 * Santo view's `sant`, `santEntry`, `santGrid`, `santPoints`, and the flow maps' `doors` and
 * `flowRules`) is optional, because older builds still running read the same `venue_maps` row (they
 * ignore fields they don't know: validate.ts lists them as a warning and toClientVenue() rebuilds
 * every object field by field).
 */
export type VenueMapData = {
  version: 1;
  /** ISO time the extraction ran. */
  generatedAt: string;
  /** The blueprint's file name (never its path). */
  source: string;
  levels: VenueLevel[];
  connectors: VenueConnector[];
  /**
   * How guests are to walk, beyond the building itself (the organisers' flow maps, 2026-10-04):
   * which doors a room is left or entered by, which stairs trips to some rooms take, rooms never
   * walked through or walked through freely, the other side's stairs a track may use at a time, and
   * (a last resort) a whole route. Not in the extractor's output: `npm run venue:import` merges them
   * from a rules file kept outside the repo (flowRules.ts). Absent = none. A problem in them makes
   * the app ignore them all (validate.ts ruleErrors), never the map.
   */
  flowRules?: VenueFlowRule[];
};

/** Whose a flow rule is: Bhaio's, Behno's or everyone's. */
export type VenueFlowTrack = VenueTrack | "ALL";

/**
 * When a flow rule applies: one event day ("YYYY-MM-DD") from `from` to `to` ("HH:MM", end
 * excluded), Eastern wall clock (EVENT_TZ). Absent = always.
 */
export type VenueFlowWindow = { day: string; from: string; to: string };

type VenueFlowRuleBase = {
  /** Unique within the rules (the import names rules by it). */
  id: string;
  track: VenueFlowTrack;
  window?: VenueFlowWindow;
  /** What the rule is for, in words (the rules file and the import's printout only; never sent to a browser). */
  note?: string;
};

/**
 * A room is left (`exits`) / entered (`entries`) only by these doors (VenueDoor ids of `room`); an
 * absent list = any door. Several rules on one room narrow it together. A cost, not a wall: a route
 * that can't do otherwise still goes another way, and a trip from a room started at its door (not a
 * hall's middle) starts at its allowed exits.
 */
export type VenueDoorsRule = VenueFlowRuleBase & { kind: "doors"; room: string; exits?: string[]; entries?: string[] };
/** Trips to or from these rooms arrive on / leave their floor only by these stairs / elevators (connector ids). */
export type VenueStairsRule = VenueFlowRuleBase & { kind: "stairs"; rooms: string[]; connectors: string[] };
/**
 * Rooms never walked through on the way elsewhere: stepping into one costs a very high, finite penalty
 * once per entry (a route that must cross one still takes the short way across, and no other room
 * becomes a way round it). Not for a trip that starts or ends in one, or in a room that opens onto one.
 */
export type VenueAvoidRule = VenueFlowRuleBase & { kind: "avoid"; rooms: string[] };
/** Rooms walked through freely (no through-room cost): the steps say "Walk through the X". */
export type VenuePassageRule = VenueFlowRuleBase & { kind: "passage"; rooms: string[] };
/** The track may also use these stairs / elevators on the other side (with a window, e.g. while the other track is elsewhere). */
export type VenueSideRule = VenueFlowRuleBase & { kind: "side"; connectors: string[] };
/** One waypoint of a route rule: a door (VenueDoor id), a stair / elevator between two of its floors, or a point. */
export type VenueWaypoint =
  | { door: string }
  | { connector: string; from: VenueLevelId; to: VenueLevelId }
  | { level: VenueLevelId; point: VenuePoint };
/** A last resort: trips from `from` to `to` (room ids) go by these waypoints, in order (Step-free off only). */
export type VenueRouteRule = VenueFlowRuleBase & { kind: "route"; from: string; to: string; via: VenueWaypoint[] };

export type VenueFlowRule = VenueDoorsRule | VenueStairsRule | VenueAvoidRule | VenuePassageRule | VenueSideRule | VenueRouteRule;
export type VenueFlowRuleKind = VenueFlowRule["kind"];
