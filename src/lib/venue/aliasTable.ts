/**
 * Server only: the organisers' names for the venue map's rooms. Three tables, all read by the
 * hub's server code (src/lib/venue/clientVenue.ts and data.ts for /map and /breakouts, the /map
 * page's admin note) and by `npm run venue:import`. Never import this file from a client
 * component: "server-only" turns that into a build error. The browser gets only what its page
 * sends: rooms already carrying their team name (toClientVenue()) and the alias list filtered to
 * public rooms and to the guest's track (aliasEntriesFor() in aliases.ts).
 * (scripts/tsconfig.server-only.json lets tsx scripts load it.)
 *
 * 1. VENUE_ROOM_NAMES: map id -> the name the organisers' labelled floor plans give the room
 *    ("Ashro", "Nij Mandir", "Sahajanand Hall", "Main Foyer"). toClientVenue() puts it on the room
 *    in place of the blueprint's description, so the map, search, the room sheet, the steps and
 *    /breakouts all say it, and it resolves in search and in ?to= / ?from= links with no alias
 *    entry. A room without an entry keeps the blueprint's name (the staff-only rooms, kept as they
 *    are). Public rooms only: back-of-house and private-quarters rooms are never sent, so a name
 *    for one is an error in `venue:import --plan` (and stops --dry-run / --apply). Stairs and
 *    elevators are never named here (they are named by where they are: view.ts shaftRoomName()).
 *    Several rooms may share a name ("Ladies' Restroom", "Samp Square"): they are told apart by
 *    their floor and, on one floor, by where they are ("on the left", "at the back": twinSpots()
 *    in directions.ts; their room number only where that wouldn't tell them apart).
 *
 * 2. VENUE_ALIASES: event room name -> map ids. The names the Hub shows that are not simply a
 *    room's team name: the team breakout rooms (prisma/breakouts-data.ts), the goshthi rooms
 *    (users.goshthi_room, from the organisers' goshthi workbooks) and the schedule's places
 *    (prisma/seed.ts), in every spelling the sheets use. Every such name is listed, also when it
 *    equals the room's team name (so `--plan` can check the sheets against this table).
 *     - `["<map id>"]`: that room; several ids = one name covering several rooms.
 *     - `{ BEHNO: [...], BHAIO: [...] }`: a place there are two of, one per track ("Samp Square":
 *       Behno are sent to theirs, Bhaio to theirs; a guest with no gender on file is offered both,
 *       the nearer first). The guest's track is passed wherever a name is resolved for them.
 *     - `null`: not on the map yet. The name is still offered in search, as "not on the map yet",
 *       and gets no map link.
 *    VENUE_ALIAS_TENTATIVE lists the mappings that are assumed until the organisers confirm them,
 *    each with what is assumed; `--plan` and the admin note on /map list them.
 *
 * 3. SANT_ROOM_NAMES (the Pujya Santo view only): map id -> the name santos read for a room of the
 *    sadhus' residence; see its own comment (also for how to change it: not as below). Never sent
 *    to anyone but santos.
 *
 * How to fill them in:
 *  1. Sign in as an admin and open Venue map (More -> Venue map). Tap the room on the map: its
 *     sheet shows "Map id" (admins only): level + blueprint number, or level + a name slug when
 *     the blueprint gives no number ("<level>-open-area-<n>" for unnamed open floor).
 *  2. To rename the room everywhere, add `"<map id>": "<the organisers' name>"` to
 *     VENUE_ROOM_NAMES. To make another name the sheets use lead there, add
 *     `"<event name>": ["<map id>"]` to VENUE_ALIASES (and remove it from VENUE_ALIAS_TENTATIVE
 *     once it is confirmed).
 *  3. Check with `npm run venue:import -- --file <venue-map.json> --plan`: it counts the named
 *     rooms and the mapped / tentative / null event names, lists any id in either table that isn't
 *     a public room on the map (or is staff only: shown, but no directions), and lists the room
 *     names the breakout data and the seed's schedule use that this table doesn't have.
 * Spellings don't matter much: matching ignores case, spaces, apostrophes and punctuation, and one
 * mapped spelling covers another that differs only by a floor note ("(Mezz)") or a leading
 * "Mezzanine": map "Mezzanine Ladies Office 2" and "Ladies' Office 2 (Mezz)" follows.
 *
 * Only name <-> id pairs here: no blueprint room descriptions and no other room inventory (those
 * are derived from the blueprint and stay outside the repo with the extractor's output). A room
 * the organisers' plans mark staff only is made so with the extractor's --closed, not here.
 */
import "server-only";
import type { VenueTrack } from "./types";

/** One room per track: Behno's and Bhaio's (see the file comment). */
export type VenueTrackRooms = Record<VenueTrack, string[]>;

export const VENUE_ROOM_NAMES: Record<string, string> = {
  // ---- First floor ------------------------------------------------------------------------------
  "1-102": "Main Foyer",
  "1-103": "Shayona Aksharpith",
  "1-106": "Prapti",
  "1-107": "Upasana",
  "1-108": "Samp Square",
  "1-109": "BKY Office",
  "1-111": "Ashro",
  "1-112": "Samarpan",
  "1-114": "Ruchi",
  "1-115": "Yagnapurush Hall",
  "1-116": "Pratigna",
  "1-117": "Jodan",
  // The first-floor plan spells it "Suhradbhav" (the breakout sheet: "Suradhbhav").
  "1-118": "Suhradbhav",
  "1-119": "Pragati",
  "1-121": "Ladies' Restroom",
  "1-125": "Ladies' Shoe Rack",
  // An older plan printed "Ladies Guest Room" here; that name is the second-floor room's.
  "1-127": "Ladies Swagat Room",
  "1-144": "Yogi Hall",
  "1-173": "Samp Square",
  "1-175": "Sarva Karta Office",
  "1-177": "Sant Office 2",
  "1-178": "Sant Office 1",
  "1-182": "Mahima",
  "1-183": "Niyam",
  "1-184": "Atma",
  "1-185": "Gnan",
  "1-186": "Paksh",
  "1-187": "Pramukh Hall",
  "1-188": "Men's Restroom",
  // The plan spells it "Nischay"; the schedule and the sheets say "Nishchay".
  "1-190": "Nishchay",
  "1-191": "Divyabhav",
  "1-192": "Seva",
  "1-195": "Men's Swagat Room",
  "1-196": "Men's Shoe Rack",
  "1-198": "Premvati",
  "1-199": "Nij Mandir",

  // ---- Second floor -----------------------------------------------------------------------------
  "2-205": "Ladies' Restroom",
  "2-208": "Ladies' Guest Room",
  "2-209": "Men's Guest Room",
  "2-210": "Cry Room",
  "2-212": "Green Room 3",
  "2-213": "Green Room 2",
  "2-214": "Bath",
  "2-215": "Green Room 1",
  "2-216": "Bath",
  "2-221": "Stage",
  "2-224": "Men's Shoe Room",
  "2-226": "Cry Room",
  "2-229": "Water Station",
  "2-232": "Ladies' Shoe Room",
  "2-233": "Water Station",
  "2-234": "Ladies' Restroom",
  "2-238A": "Ladies' Gym",
  "2-238B": "Men's Gym",
  "2-238C": "Sahajanand Hall",
  "2-men-s-toilet": "Men's Restroom",
  "2-open-area-1": "2nd Floor Foyer",

  // ---- Mezzanine --------------------------------------------------------------------------------
  "M-302": "Bath",
  "M-303": "Ladies' Office 3",
  "M-304": "Ladies' Office 2",
  "M-305": "Ladies' Office 1",
  "M-306": "Mahant Hall",
  "M-309": "Men's Office 3",
  "M-310": "Men's Office 2",
  "M-315": "Bath",

  // ---- Basement ---------------------------------------------------------------------------------
  "B-001": "Multipurpose Room",
  "B-015": "Multipurpose Room",
  "B-022": "Small Banquet Hall",
  "B-023": "Large Banquet Hall",
  "B-024": "Ladies' Dance Room 2",
  "B-033": "Men's Restroom",
  "B-034": "Ladies' Restroom",
  "B-open-area-1": "Basement Foyer",
};

/** VENUE_ROOM_NAMES by id (a Map: a room id is never looked up on an object's prototype). */
export const VENUE_ROOM_NAME_BY_ID: ReadonlyMap<string, string> = new Map(Object.entries(VENUE_ROOM_NAMES));

/**
 * The Pujya Santo view only: map id -> the name santos read for a room of the sadhus' residence
 * (VenueRoom.sant "own"; the user, 2026-10-03: one room is Sarvasva, the others numbered Santo
 * Rooms in ascending order of the blueprint's room numbers). Applied only by toSantClientVenue()
 * (clientVenue.ts), so these names reach santos' browsers and nobody else's.
 * A residence room is sent by name only when this table names it: every "own" room must have an
 * entry, and nothing else may (not a "way" / "shared" room, a shaft, a public room, or an id also
 * in VENUE_ROOM_NAMES); VENUE_ALIASES never maps to a residence room. `venue:import --plan` checks
 * all of it (and stops on any mismatch); at run time a mismatch gives santos the delegates' map.
 * Name <-> id pairs only, like VENUE_ROOM_NAMES.
 *
 * Changing it (not as in "How to fill them in" above: admins can't tap a residence room on /map,
 * it is a bare outline for them, and santos never see map ids):
 *  - the ids: the "own (shown, named)" list in the "Pujya Santo view" section of
 *    `npm run venue:import -- --file <venue-map.json> --plan`;
 *  - renaming a room: edit its name here and deploy; no re-import;
 *  - showing or hiding a room: give the extractor --sant / --not-sant / --sant-class (recorded in
 *    the arguments note beside its output, outside the repo), re-extract, edit this table to
 *    match, check with `--plan`, then deploy and import back to back: until the deployed table
 *    and the stored map agree, santos get the delegates' map.
 */
export const SANT_ROOM_NAMES: Readonly<Record<string, string>> = {
  "1-154": "Sarvasva",
  "1-158": "Santo Room 1",
  "1-160": "Santo Room 2",
  "1-162": "Santo Room 3",
  "1-165": "Santo Room 4",
  "1-167": "Santo Room 5",
  "1-179": "Santo Room 6",
};

/** SANT_ROOM_NAMES by id. */
export const SANT_ROOM_NAME_BY_ID: ReadonlyMap<string, string> = new Map(Object.entries(SANT_ROOM_NAMES));

export const VENUE_ALIASES: Record<string, string[] | VenueTrackRooms | null> = {
  // ---- Schedule places (prisma/seed.ts) ------------------------------------
  Mandir: ["1-199"],
  // Main Hall = Sabha Hall = Sahajanand Hall: one room (organisers, 2026-10-01).
  "Main Hall": ["2-238C"],
  "Sabha Hall": ["2-238C"],
  "Sahajanand Hall": ["2-238C"],
  // The Hub's own name for where meals are served (every breakfast, lunch and dinner in the seed's
  // schedule): one room per track. The organisers' flow maps (2026-10-04) show only Friday's lunch
  // (lunch -> Goshthi 1: Behno in the Ladies' Gym, Bhaio in the Large Banquet Hall); the other meals
  // are assumed to be in the same rooms (VENUE_ALIAS_TENTATIVE).
  "Dining Hall": { BEHNO: ["2-238A"], BHAIO: ["B-023"] },

  // ---- Halls and large rooms ------------------------------------------------
  "Pramukh Hall": ["1-187"],
  "Yogi Hall": ["1-144"],
  "Yagnapurush Hall": ["1-115"],
  "Mahant Hall (Mezz)": ["M-306"],
  "Large Banquet Hall": ["B-023"],
  "Small Banquet Hall": ["B-022"],
  // Two places, one per track (organisers, 2026-10-01).
  "Samp Square": { BEHNO: ["1-108"], BHAIO: ["1-173"] },
  "Men's Gym": ["2-238B"],
  "Boy's Gym": ["2-238B"],
  "Girls Game Room": null,
  "Ladies Dance Room 2": ["B-024"],
  "Dance Practice 2 (Basement)": ["B-024"],
  "Ladies Multipurpose Room": ["B-001"],
  // Two basement rooms carry this team name; as a goshthi or breakout room it is the one the
  // organisers' flow maps (2026-10-04) take groups to (the Ladies Multipurpose Room).
  "Multipurpose Room": ["B-001"],
  // Saturday's header in the Behno breakout grid for the Ladies Multipurpose Room.
  "Ladies Storage Room": ["B-001"],

  // ---- Foyers and the mezzanine ---------------------------------------------
  "2nd Floor Foyer": ["2-open-area-1"],
  "Upstairs Foyer": ["2-open-area-1"],
  // As a room name, "Mezzanine" is Mahant Hall (the whole floor is the mezzanine too).
  Mezzanine: ["M-306"],

  // ---- Offices (the mezzanine offices appear under two spellings) -----------------
  "Mezzanine Ladies Office 1": ["M-305"],
  "Ladies' Office 1 (Mezz)": ["M-305"],
  "Mezzanine Ladies Office 2": ["M-304"],
  "Ladies' Office 2 (Mezz)": ["M-304"],
  "Mezzanine Ladies Office 3": ["M-303"],
  "Ladies' Office 3 (Mezz)": ["M-303"],
  "Mezzanine Men's Office 2": ["M-310"],
  // Staff only on the organisers' plan: no directions, so it stays unmapped.
  "Men's Office 1": null,
  "Men's Office 3": ["M-309"],
  "Sarva Karta Office": ["1-175"],

  // ---- Guest, swagat, VIP and green rooms -------------------------------------
  // The second-floor guest rooms (the breakout sheet's columns since 2026-10-01).
  "Ladies Guest Room": ["2-208"],
  "Men's Guest Room": ["2-209"],
  "Ladies VIP Room": ["2-208"],
  "Men's VIP Room": ["2-209"],
  // The first-floor ladies' guest room, which the plan of 2026-10-01 calls the Ladies Swagat Room.
  "Guestroom (First Floor)": ["1-127"],
  "Ladies Swagat Room": ["1-127"],
  "Men's Swagat Room": ["1-195"],
  "Green Room 2": ["2-213"],
  "Green Room 3": ["2-212"],

  // ---- Named rooms (breakouts and goshthis) ----------------------------------------------------
  Ashro: ["1-111"],
  Atma: ["1-184"],
  Divyabhav: ["1-191"],
  Gnan: ["1-185"],
  Jodan: ["1-117"],
  Mahima: ["1-182"],
  Nishchay: ["1-190"],
  Niyam: ["1-183"],
  Paksh: ["1-186"],
  Pragati: ["1-119"],
  Prapti: ["1-106"],
  Pratigna: ["1-116"],
  Premvati: ["1-198"],
  Ruchi: ["1-114"],
  Samarpan: ["1-112"],
  Seva: ["1-192"],
  Shayona: ["1-103"],
  // The breakout sheet spells it "Suradhbhav", the goshthi sheet "Suhradbhav": the same room.
  Suradhbhav: ["1-118"],
  Suhradbhav: ["1-118"],
  Upasana: ["1-107"],

  // ---- Other names guests may type or follow a link by -------------------------------------------
  // The first-floor plan's spelling of Nishchay.
  Nischay: ["1-190"],
  // What the map called the Main Foyer before the organisers' plans (search, older ?from= links).
  Lobby: ["1-102"],
};

/**
 * Mappings in VENUE_ALIASES that are assumed, not confirmed: event name -> what is assumed. The
 * user is confirming each with the organisers (2026-10-01: "match them as you did, I'll confirm
 * and change if needed"); remove an entry here once it is confirmed, or change the mapping.
 * Confirmed by the organisers' flow maps (2026-10-04), so no longer listed: Ladies Dance Room 2,
 * Ladies Swagat Room and Men's Swagat Room (their flows go to those rooms).
 */
export const VENUE_ALIAS_TENTATIVE: Record<string, string> = {
  "Dining Hall":
    "the room of every meal (breakfast and dinner too) that the flow maps show for Friday's lunch: Behno the Ladies' Gym, Bhaio the Large Banquet Hall",
  "Dance Practice 2 (Basement)": "the same room as Ladies Dance Room 2",
  "Ladies VIP Room": "an older name of the second-floor Ladies' Guest Room",
  "Men's VIP Room": "an older name of the second-floor Men's Guest Room",
};

/** VENUE_ALIASES as buildVenueIndex() takes it (a per-track entry: both tracks' rooms, Behno's first, plus `byTrack`). */
export const VENUE_ALIAS_ENTRIES = Object.entries(VENUE_ALIASES).map(([name, rooms]) =>
  rooms && !Array.isArray(rooms)
    ? { name, roomIds: [...new Set([...rooms.BEHNO, ...rooms.BHAIO])], byTrack: { BEHNO: rooms.BEHNO, BHAIO: rooms.BHAIO } }
    : { name, roomIds: rooms },
);
