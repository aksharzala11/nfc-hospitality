/**
 * Reading the organisers' goshthi workbooks for the master-list import
 * (planDelegates() in src/lib/delegateImport.ts, which assigns what this reads
 * to the planned delegates). Each goshthi group meets in its own room during
 * the Goshthi sessions, with a moderator on the Behno side.
 *
 * Pure: no database, no file access. The script reads the workbooks (exceljs);
 * delegateImport.ts turns each worksheet into text cells with its merged
 * ranges filled (goshthiTextSheet()) and passes them to assignGoshthi(). Names,
 * emails and phones in the tabs are never read. Nothing from the workbooks
 * lives in the repo.
 *
 * Tabs (organisers, 2026-09-27, "eNAAM Goshthi Group Allocations"):
 * - Only visible tabs are read. Hidden tabs are the organisers' old copies:
 *   listed as ignored.
 * - LIST tabs: a header row with "User Id" and "Goshthi Group" (title rows
 *   above it are fine), one person per row. Optional columns: "Wing" (the wing
 *   the row is listed under; the old one-tab-per-wing workbook gave it by the
 *   tab name), "Room", "Split?", "Ppl in Group" (only to recognise summary
 *   rows). The group is stored as "Group 4", or with the
 *   row's wing ("eBKY Group 3") when that is not the person's own seva wing,
 *   since a bare number is read against their own wing (goshthiGroupLabel()
 *   in src/lib/schedule.ts). The Bhaio side ("E-Side") is a list tab; it
 *   numbers its groups across all of Bhaio (Bal 1-15, Kishore 16-32, ...; the
 *   old workbook restarted them per wing), and the stored value and label keep
 *   the wing either way.
 * - List tabs of several wings whose numbers are unique across them (found from
 *   the rows: each number's rows are listed under one wing, give or take a stray
 *   row; else the old wing + number grouping) key a group by its number alone,
 *   because the organisers' merged Wing / Room cells can slip by a row
 *   (organisers' 2026-09-29 file: the Yuvak Room merges start on each group's
 *   summary row and stop one row short). There:
 *   - A row whose Goshthi Group names another group than the rows around it (its
 *     block: the rows between two rows without a User Id) was moved without its
 *     number being changed, or not. The "Ppl in Group" counts (typed by hand, on
 *     a block's rows or the summary row just above it) decide: when both groups'
 *     counts match their blocks as laid out and not the numbers as given, the
 *     row takes its block's group; otherwise it gets no group (a conflict, for
 *     the organisers). Listed either way (movedRows).
 *   - A row takes its group's wing (the wing the group's rows share) when its
 *     Wing is blank or differs, and its group's room when its non-blank Room
 *     differs from the one the rest of the group (two rows or more) names and
 *     its "Split?" is blank; a blank Room takes the group's room by the rule
 *     below. Every row so changed is listed (groupFixes), never silently.
 * - Rows without a User Id are ignored and listed by row number, noted as group
 *   summary rows when they hold only Wing / Ppl in Group / Room (/ Split?).
 * - GRID tabs: blocks side by side, each headed by a "Group <N>" cell with its
 *   column headers to the right (Name, Seva, Center, the User Id column,
 *   Email, Location), then "Moderator:" rows and numbered member rows. The
 *   User Id column is found by its header ("User Id", "BKMS ID", ...), else by
 *   its values. The block's room is its Location (a merged cell spanning the
 *   member rows); the moderator rows' own Location (a floor) is only reported.
 *   The group is stored as "Goshthi Group <N>" (the Behno side, "I-side
 *   Groups", numbers its groups across all of Behno) and shown as given.
 * - Any other tab (a summary such as "I-Side": Seva / Wing / Count) is
 *   ignored and listed, never an error.
 * - Rooms: whitespace tidied; only the obvious misspelling "Samp Sqaure" is
 *   corrected (and reported). A blank room takes the one its group's other rows
 *   name when they agree and outnumber the blanks (a merged Room cell that stops
 *   short, organisers 2026-09-27); otherwise it is left empty and reported.
 */
import type { Track } from "./delegateImport";
import { genderForSevaWing, sevaWingOf, sheetKey, type SevaWing } from "./sevaMapping";

/** A worksheet as text: every cell tidied (or null), merged ranges filled with their top-left value. */
export type GoshthiTextSheet = { name: string; state: string; cells: (string | null)[][] };
export type GoshthiTextWorkbook = { file: string; sheets: GoshthiTextSheet[] };

export type GoshthiFormat = "list" | "grid";

/** One person's row in a goshthi tab. */
export type GoshthiEntry = {
  registrationId: string;
  /** "<file> / <tab>". */
  source: string;
  format: GoshthiFormat;
  /** The tab's side (Bhaio / Behno), or null when the tab doesn't say. */
  track: Track | null;
  /** List tabs: the wing the row is listed under ("Wing" column, else the tab name). */
  wing: SevaWing | null;
  /** List: "Group 4"; grid: "Goshthi Group 12"; null = blank cell. */
  group: string | null;
  room: string | null;
  moderator: boolean;
  /** The "Split?" cell, when not blank. */
  split: string | null;
  /** 1-based sheet row. */
  row: number;
  /**
   * Why the row can't be placed (a list row among another group's rows that the
   * "Ppl in Group" counts don't settle): the person gets no group and is listed.
   */
  unsettled?: string;
};

export type GoshthiTabInfo = {
  source: string;
  format: GoshthiFormat;
  track: Track | null;
  /** Old one-tab-per-wing format: the tab's wing. */
  wing: SevaWing | null;
  /** Rows with a User Id. */
  people: number;
  groups: number;
  rooms: number;
  moderators: number;
  /** Rows with a User Id but no room. */
  blankRooms: number;
  /** Rows with data but no User Id (1-based rows; names are never read). */
  rowsWithoutUserId: number[];
  /** Those of them holding only Wing / Ppl in Group / Room (/ Split?): a group's summary row. */
  summaryRows: number[];
  /** A title row's head count ("327 delegates ..."), when the tab has one. */
  statedPeople: number | null;
  /** List tabs of several wings whose group numbers are unique across them: a group is its number (movedRows, groupFixes). */
  groupsByNumber: boolean;
};

/**
 * A list row that took its group's wing or room: in a tab whose group numbers are
 * unique across wings, its Wing was blank or differed from the wing its group's rows
 * share, or its Room differed from the one the rest of its group names.
 */
export type GoshthiGroupFix = {
  registrationId: string;
  source: string;
  /** 1-based sheet row. */
  row: number;
  /** The group as the plan names it, with its wing ("eBKY Group 42"). */
  group: string;
  /** The Wing cell as given (null = blank or not a wing) and the group's wing, used instead. */
  wing: { given: string | null; used: SevaWing } | null;
  /** The Room as given and the room the rest of the group names, used instead. */
  room: { given: string; used: string } | null;
};

/** A group's "Ppl in Group" as typed (null = none, or several), its rows in its block and the rows naming it. */
export type GoshthiGroupCount = { group: string; stated: number | null; inBlock: number; labelled: number };

/**
 * A list row whose Goshthi Group names another group than the rows around it (its
 * block), in a tab numbering its groups across wings: moved to that block without
 * its number being changed, or not; the "Ppl in Group" counts decide.
 */
export type GoshthiMovedRow = {
  registrationId: string;
  source: string;
  /** 1-based sheet row. */
  row: number;
  /** The group its Goshthi Group cell names and its block's group, with their wings ("eBKY Group 42"). */
  labelled: string;
  among: string;
  /** The block's group, then the named group. */
  counts: GoshthiGroupCount[];
  /**
   * "block": both groups' counts match their blocks as laid out (and not the numbers
   * as given), so the row takes its block's group; "none": they don't settle it, so
   * the person gets no group (GoshthiPlan.conflicts).
   */
  outcome: "block" | "none";
};

/** One goshthi group as the workbook lays it out. */
export type GoshthiGroupInfo = {
  source: string;
  track: Track | null;
  group: string;
  room: string | null;
  people: number;
  moderators: number;
  /** Other Location values in a grid block (the moderator rows' floor), not used as the room. */
  otherLocations: string[];
  /** The "Moderator:" rows (grid tabs), in sheet order: one per group is the norm. */
  moderatorRows: { registrationId: string; row: number }[];
  /** Distinct non-blank rooms on the group's rows (one = those rows agree). */
  roomsSeen: string[];
  /** Rows with a room / with the Room cell blank. */
  roomRows: number;
  blankRoomRows: number;
};

export type GoshthiRoomInfo = { room: string; track: Track | null; groups: number; people: number };

export type GoshthiPlan = {
  tabs: GoshthiTabInfo[];
  /** Hidden tabs, and tabs that are neither a list nor a group grid, with why. */
  ignoredTabs: string[];
  /** Tracks the tabs cover: every imported delegate on them gets a group or none. */
  coveredTracks: Track[];
  /** Tabs whose name gave no side, with the side taken from the people they list. */
  inferredSides: { source: string; track: Track; onTrack: number; matched: number }[];
  /** Tabs with people whose side is still unknown (their track's coverage is not assumed). */
  unknownSides: string[];
  groups: GoshthiGroupInfo[];
  rooms: GoshthiRoomInfo[];
  /** Delegates who get a group, per track. */
  assigned: number;
  assignedByTrack: Record<Track, number>;
  /** Delegates who get a group as its moderator. */
  moderators: string[];
  /**
   * Assigned rows without a room (group set, room left empty), with the rooms
   * the rest of their group names in the workbook (none, or several).
   */
  blankRoom: { registrationId: string; source: string; group: string | null; groupRooms: string[] }[];
  /**
   * Rows with a blank Room in a group whose rows that do name a room all name the same
   * one and outnumber its blank rows: they take it (organisers, 2026-09-27: a merged
   * Room cell that stops short of a row or two).
   */
  roomFilled: { registrationId: string; source: string; group: string; room: string }[];
  /** List rows among another group's rows than their Goshthi Group names (tabs numbering groups across wings). */
  movedRows: GoshthiMovedRow[];
  /** List rows that took their group's wing / room (tabs numbering groups across wings). */
  groupFixes: GoshthiGroupFix[];
  /** Room spellings corrected, with the rows affected. */
  roomCorrections: { source: string; from: string; to: string; rows: number }[];
  /** Non-blank "Split?" cells, carried as given. */
  splits: { registrationId: string; source: string; split: string }[];
  /** Goshthi rows whose User Id is not imported, with why. */
  notImported: { registrationId: string; source: string; why: string }[];
  /** Imported people on a covered track that no goshthi row lists (group and room cleared). */
  withoutGroup: { registrationId: string; track: Track; sevaWing: SevaWing; seva: string }[];
  /**
   * Listed under a wing other than their seva wing (group assigned); `group`
   * is the stored value, with that wing ("eBKY Group 1").
   */
  tabMismatch: { registrationId: string; source: string; sevaWing: SevaWing; group: string }[];
  /** Listed on the other track's side (group assigned). */
  otherSide: { registrationId: string; source: string; track: Track }[];
  /** Listed twice in the same group (counted once). */
  listedTwice: { registrationId: string; source: string; group: string | null }[];
  /** Goshthi rows with a User Id but no group (not assigned). */
  blankGroup: { registrationId: string; source: string }[];
  /** User Ids in several groups, on both sides, or with a row the tab doesn't settle (movedRows; not assigned). */
  conflicts: { registrationId: string; sources: string[] }[];
  /** Tabs that look like goshthi tabs but can't be read: the import refuses to write. */
  errors: string[];
};

// ---------------------------------------------------------------------------
// Cells

type Range = { r0: number; c0: number; r1: number; c1: number };

/** Column letters to a 0-based index ("A" -> 0, "AA" -> 26). */
function columnIndex(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** "G7:G15" -> 0-based { r0: 6, c0: 6, r1: 14, c1: 6 }; null when unreadable. */
function parseRange(range: string): Range | null {
  const m = range.match(/^\$?([A-Z]+)\$?(\d+):\$?([A-Z]+)\$?(\d+)$/i);
  if (!m) return null;
  return { c0: columnIndex(m[1]), r0: Number(m[2]) - 1, c1: columnIndex(m[3]), r1: Number(m[4]) - 1 };
}

/** The cells with every merged range's top-left value copied into its blank cells. */
export function fillMergedCells(cells: readonly (string | null)[][], merges: readonly string[]): (string | null)[][] {
  const out = cells.map((r) => [...(r ?? [])]);
  for (const range of merges) {
    const m = parseRange(range);
    if (!m) continue;
    const master = out[m.r0]?.[m.c0] ?? null;
    for (let r = m.r0; r <= m.r1; r++) {
      out[r] ??= [];
      for (let c = m.c0; c <= m.c1; c++) if (out[r][c] === null || out[r][c] === undefined) out[r][c] = master;
    }
  }
  return out;
}

const at = (cells: readonly (string | null)[][], r: number, c: number): string | null => cells[r]?.[c] ?? null;

// ---------------------------------------------------------------------------
// Values

/** "4", "group 4", "Group  4" -> "Group 4"; other text as given. */
export function listGroupValue(value: string): string {
  const m = value.match(/^(?:group\s*)?(\d+)$/i);
  return m ? `Group ${Number(m[1])}` : value;
}

/** A grid block's group: "Goshthi Group 12". */
export function gridGroupValue(n: number): string {
  return `Goshthi Group ${n}`;
}

/** A wing as the organisers write it in a group value ("eBKY Group 3"). */
const WING_LABEL: Partial<Record<SevaWing, string>> = { EBKY: "eBKY", IBKY: "iBKY" };

/** A wing as the organisers write it ("EBKY" -> "eBKY"); other text as given. */
export function wingLabel(wing: string): string {
  return WING_LABEL[wing as SevaWing] ?? wing;
}

/**
 * The users.goshthi_group value for an entry and the person's own seva wing:
 * a list row under another wing carries that wing ("eBKY Group 1"); grid
 * values ("Goshthi Group 12") and other rows as they are.
 */
export function storedGoshthiGroup(entry: Pick<GoshthiEntry, "group" | "wing">, sevaWing: SevaWing): string | null {
  if (!entry.group) return null;
  return entry.wing && entry.wing !== sevaWing ? `${WING_LABEL[entry.wing] ?? entry.wing} ${entry.group}` : entry.group;
}

/** Misspellings corrected in room names (whole words, case ignored). */
const ROOM_CORRECTIONS: readonly (readonly [RegExp, string])[] = [[/\bsamp\s+sqaure\b/i, "Samp Square"]];

/** A room cell tidied, and whether a misspelling was corrected. */
export function readRoom(value: string | null): { room: string | null; corrected: boolean } {
  const tidy = (value ?? "").replace(/\s+/g, " ").trim();
  if (!tidy) return { room: null, corrected: false };
  let room = tidy;
  for (const [pattern, fix] of ROOM_CORRECTIONS) room = room.replace(pattern, fix);
  return { room, corrected: room !== tidy };
}

/** The side a tab's name gives: "E-Side", "eBKY ..." -> Bhaio; "I-side Groups", "iBKY ..." -> Behno. */
// "Eside" / "Iside" count too; a name that says neither falls back to the people the tab
// lists (assignGoshthi()), so a renamed tab never switches a track's coverage off.
export function trackFromName(name: string): Track | null {
  const key = sheetKey(name);
  const wing = genderForSevaWing(key.split(" ")[0]);
  if (wing) return wing;
  // Any punctuation may sit between the letter and "side" ("E-Side", "E.Side", "E–Side",
  // "Eside"); what follows must not be a letter or digit ("eBKY_Hampton" yes, "Esides" no).
  if (/^(e[^a-z0-9]*side|ebky)(?![a-z0-9])/.test(key)) return "MALE";
  if (/^(i[^a-z0-9]*side|ibky)(?![a-z0-9])/.test(key)) return "FEMALE";
  return null;
}

/** Share of a tab's matched people who must be on one track before that track is taken as its side. */
const SIDE_FROM_PEOPLE_SHARE = 0.9;
/** Fewest matched people for that inference (a tiny tab says too little). */
const SIDE_FROM_PEOPLE_MIN = 10;

/** "327 delegates (includes moderators)" in the rows above a table -> 327. */
function statedPeople(cells: readonly (string | null)[][], beforeRow: number): number | null {
  for (let r = 0; r < Math.min(beforeRow, cells.length); r++) {
    for (const v of cells[r] ?? []) {
      const m = v?.match(/^(\d+)\s+delegates\b/i);
      if (m) return Number(m[1]);
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Tabs

const LIST_COLUMNS = {
  userId: ["User Id", "UserId", "User ID"],
  group: ["Goshthi Group", "Goshti Group", "Group"],
  wing: ["Wing"],
  room: ["Room", "Location"],
  split: ["Split?", "Split"],
  count: ["Ppl in Group", "People in Group"],
} as const;
type ListKey = keyof typeof LIST_COLUMNS;

/** Grid headers: the User Id column goes by one of these, else by its values. */
const GRID_ID_HEADERS = ["User Id", "UserId", "User ID", "BKMS ID", "BKMSID", "BKMS Id", "Registration Id", "ID"];
const GRID_ROOM_HEADERS = ["Location", "Room"];
const GROUP_HEADER = /^group\s*(\d+)$/i;
/** Rows searched for a list tab's header row (title rows may sit above it). */
const HEADER_SEARCH_ROWS = 15;

const matches = (cell: string | null, names: readonly string[]) =>
  cell !== null && names.some((n) => sheetKey(n) === sheetKey(cell));

function findListHeader(cells: readonly (string | null)[][]): { row: number; cols: Record<ListKey, number> } | null {
  for (let r = 0; r < Math.min(HEADER_SEARCH_ROWS, cells.length); r++) {
    const row = cells[r] ?? [];
    const cols = {} as Record<ListKey, number>;
    for (const key of Object.keys(LIST_COLUMNS) as ListKey[]) {
      cols[key] = row.findIndex((v) => matches(v, LIST_COLUMNS[key]));
    }
    if (cols.userId >= 0 && cols.group >= 0) return { row: r, cols };
  }
  return null;
}

type TabResult = {
  info: GoshthiTabInfo;
  entries: GoshthiEntry[];
  groups: GoshthiGroupInfo[];
  /** Rows per corrected room spelling, keyed JSON [as given, corrected]. */
  corrections: Map<string, number>;
  moved: GoshthiMovedRow[];
  fixes: GoshthiGroupFix[];
};

/**
 * A list tab's block: a run of rows with a User Id (rows without one, blank or a
 * group's summary row, end it), with the "Ppl in Group" numbers on its rows and on
 * the rows without a User Id just above it (where a slipped summary row puts them).
 */
type ListBlock = { entries: GoshthiEntry[]; counts: number[] };

/** A "Ppl in Group" cell as a number ("11", "11.0"); null otherwise. */
function countValue(cell: string | null): number | null {
  const m = cell?.match(/^(\d+)(?:\.0+)?$/);
  return m ? Number(m[1]) : null;
}

function countCorrection(corrections: Map<string, number>, given: string, room: string) {
  const key = JSON.stringify([given.replace(/\s+/g, " ").trim(), room]);
  corrections.set(key, (corrections.get(key) ?? 0) + 1);
}

function newInfo(source: string, format: GoshthiFormat, track: Track | null, wing: SevaWing | null): GoshthiTabInfo {
  return {
    source,
    format,
    track,
    wing,
    people: 0,
    groups: 0,
    rooms: 0,
    moderators: 0,
    blankRooms: 0,
    rowsWithoutUserId: [],
    summaryRows: [],
    statedPeople: null,
    groupsByNumber: false,
  };
}

function readListTab(
  source: string,
  sheet: GoshthiTextSheet,
  header: { row: number; cols: Record<ListKey, number> },
): TabResult {
  const { cols } = header;
  const tabWing = sevaWingOf(sheet.name);
  const entries: GoshthiEntry[] = [];
  const corrections = new Map<string, number>();
  const info = newInfo(source, "list", null, tabWing);
  info.statedPeople = statedPeople(sheet.cells, header.row);
  // Columns that are merged across a group's rows (and its blank separator row).
  const spanning = new Set([cols.wing, cols.room, cols.split].filter((c) => c >= 0));
  // A group's summary row: its merged Wing / Room and its "Ppl in Group" count.
  const summaryCols = new Set([...spanning, cols.count].filter((c) => c >= 0));
  /** The Wing cell as given, per entry (for the fixes' listing). */
  const wingCells = new Map<GoshthiEntry, string | null>();
  const blocks: ListBlock[] = [];
  let block: ListBlock | null = null;
  /** "Ppl in Group" numbers on the rows without a User Id since the last block. */
  let countsAbove: number[] = [];
  for (let r = header.row + 1; r < sheet.cells.length; r++) {
    const registrationId = at(sheet.cells, r, cols.userId);
    const count = cols.count >= 0 ? countValue(at(sheet.cells, r, cols.count)) : null;
    if (!registrationId) {
      block = null;
      if (count !== null) countsAbove.push(count);
      // Rows between groups hold at most a merged Wing / Room cell, or a group's summary.
      const filled = (sheet.cells[r] ?? []).flatMap((v, c) => (v !== null ? [c] : []));
      if (filled.some((c) => !spanning.has(c))) {
        info.rowsWithoutUserId.push(r + 1);
        if (filled.every((c) => summaryCols.has(c))) info.summaryRows.push(r + 1);
      }
      continue;
    }
    if (!block) {
      block = { entries: [], counts: countsAbove };
      countsAbove = [];
      blocks.push(block);
    }
    if (count !== null) block.counts.push(count);
    const raw = at(sheet.cells, r, cols.group);
    const wingCell = cols.wing >= 0 ? at(sheet.cells, r, cols.wing) : null;
    const wing = (cols.wing >= 0 ? sevaWingOf(wingCell) : null) ?? tabWing;
    const cell = cols.room >= 0 ? at(sheet.cells, r, cols.room) : null;
    const { room, corrected } = readRoom(cell);
    if (corrected) countCorrection(corrections, cell!, room!);
    const entry: GoshthiEntry = {
      registrationId,
      source,
      format: "list",
      track: null,
      wing,
      group: raw ? listGroupValue(raw) : null,
      room,
      moderator: false,
      split: cols.split >= 0 ? at(sheet.cells, r, cols.split) : null,
      row: r + 1,
    };
    entries.push(entry);
    block.entries.push(entry);
    wingCells.set(entry, wingCell ? sevaWingOf(wingCell) ?? wingCell : null);
  }
  // Tabs of several wings numbering their groups across them: a group is its number.
  const wings = wingPerGroupNumber(entries);
  info.groupsByNumber = wings !== null;
  const moved = wings ? settleMovedRows(source, blocks, wings) : [];
  const fixes = wings ? fixByGroupNumber(source, entries.filter((e) => !e.unsettled), wingCells, wings) : [];
  // The side: the wings the rows are listed under, else the tab name.
  const wingTracks = new Set(entries.flatMap((e) => (e.wing ? [genderForSevaWing(e.wing)!] : [])));
  const track = wingTracks.size === 1 ? [...wingTracks][0] : trackFromName(sheet.name);
  for (const e of entries) e.track = track;
  info.track = track;
  // A row the tab doesn't settle is in no group.
  const groups = summariseGroups(source, track, entries.filter((e) => !e.unsettled), new Map());
  return { info: fillInfo(info, entries, groups), entries, groups, corrections, moved, fixes };
}

/** Rows off their number's wing (of all rows with a wing) a tab may have and still number its groups across wings. */
const STRAY_WING_SHARE = 0.05;

/**
 * Each group number's wing in a list tab of several wings that numbers its groups
 * across them (the E-side list: Bal 1-15, Kishore 16-32, ...): the wing most of its
 * rows are listed under (null when none of its rows has one). Null for a tab of one
 * wing or none (the old one-tab-per-wing workbook: read by wing + number, as ever),
 * and when the numbers restart per wing: some number has no wing holding most of its
 * rows, or more than STRAY_WING_SHARE of the rows are listed under another wing than
 * their number's.
 */
function wingPerGroupNumber(entries: readonly GoshthiEntry[]): Map<string, SevaWing | null> | null {
  if (new Set(entries.flatMap((e) => (e.wing ? [e.wing] : []))).size < 2) return null;
  const counts = new Map<string, Map<SevaWing, number>>();
  for (const e of entries) {
    if (!e.group) continue;
    const perWing = counts.get(e.group) ?? new Map<SevaWing, number>();
    if (e.wing) perWing.set(e.wing, (perWing.get(e.wing) ?? 0) + 1);
    counts.set(e.group, perWing);
  }
  const wings = new Map<string, SevaWing | null>();
  let withWing = 0;
  let stray = 0;
  for (const [group, perWing] of counts) {
    const total = [...perWing.values()].reduce((a, b) => a + b, 0);
    const [top, most] = [...perWing].sort((x, y) => y[1] - x[1])[0] ?? [null, 0];
    if (total > 0 && most * 2 <= total) return null;
    wings.set(group, top);
    withWing += total;
    stray += total - most;
  }
  return stray <= STRAY_WING_SHARE * withWing ? wings : null;
}

/** A group number with its wing, as the plan names it ("Yuvak Group 34"). */
function numberedGroupName(group: string, wings: ReadonlyMap<string, SevaWing | null>): string {
  const wing = wings.get(group);
  return wing ? `${WING_LABEL[wing] ?? wing} ${group}` : group;
}

/**
 * In a list tab numbering its groups across wings: each row whose Goshthi Group
 * names another group than most of its block's rows do. The "Ppl in Group" counts
 * (typed by hand, so the organisers' own tally of each group) decide: when every
 * count given for the two groups matches the group's rows as laid out in its block
 * and not the rows naming it (or both), the row was moved on purpose and takes its
 * block's group; otherwise (counts missing, or they fit the numbers as given, or a
 * swap leaves them equal) it is unsettled and the person gets no group. Mutates the
 * entries (group, unsettled); returns every such row.
 */
function settleMovedRows(
  source: string,
  blocks: readonly ListBlock[],
  wings: ReadonlyMap<string, SevaWing | null>,
): GoshthiMovedRow[] {
  /** The group most (over half) of a block's rows name. */
  const blockGroup = new Map<ListBlock, string>();
  for (const b of blocks) {
    const tally = new Map<string, number>();
    for (const e of b.entries) if (e.group) tally.set(e.group, (tally.get(e.group) ?? 0) + 1);
    const [top, most] = [...tally].sort((x, y) => y[1] - x[1])[0] ?? [null, 0];
    if (top && most * 2 > b.entries.length) blockGroup.set(b, top);
  }
  // Every count from the sheet as laid out, before any row is moved.
  const blocksOf = new Map<string, ListBlock[]>();
  for (const [b, g] of blockGroup) blocksOf.set(g, [...(blocksOf.get(g) ?? []), b]);
  const labelled = new Map<string, number>();
  for (const b of blocks) for (const e of b.entries) if (e.group) labelled.set(e.group, (labelled.get(e.group) ?? 0) + 1);
  const countOf = (group: string): GoshthiGroupCount => {
    const own = blocksOf.get(group) ?? [];
    const typed = new Set(own.flatMap((b) => b.counts));
    return {
      group: numberedGroupName(group, wings),
      // One block, one number: a group over several blocks, or with differing numbers, has none.
      stated: own.length === 1 && typed.size === 1 ? [...typed][0] : null,
      inBlock: own.reduce((n, b) => n + b.entries.length, 0),
      labelled: labelled.get(group) ?? 0,
    };
  };
  const moved: GoshthiMovedRow[] = [];
  for (const [b, among] of blockGroup) {
    for (const e of b.entries) {
      if (!e.group || e.group === among) continue;
      const counts = [countOf(among), countOf(e.group)];
      const fits = counts
        .filter((c) => c.stated !== null)
        .map((c) => ({ block: c.stated === c.inBlock, label: c.stated === c.labelled }));
      const byBlock = fits.some((f) => f.block && !f.label) && fits.every((f) => f.block);
      const entry: GoshthiMovedRow = {
        registrationId: e.registrationId,
        source,
        row: e.row,
        labelled: numberedGroupName(e.group, wings),
        among: numberedGroupName(among, wings),
        counts,
        outcome: byBlock ? "block" : "none",
      };
      moved.push(entry);
      if (byBlock) e.group = among;
      else e.unsettled = `Goshthi Group says ${entry.labelled}, but the row sits among ${entry.among}'s rows`;
    }
  }
  return moved.sort((x, y) => x.row - y.row);
}

/**
 * In a list tab numbering its groups across wings, a group is its number: a row
 * whose Wing is blank or differs from the wing its group's rows share takes that
 * wing, and a row whose non-blank Room differs from the one all the rest of its
 * group (two rows or more) names takes that room, unless its "Split?" is filled in
 * (mutating `entries`). Blank rooms are left to assignGoshthi()'s fill rule, which
 * then reads the group by number. Returns the rows changed.
 */
function fixByGroupNumber(
  source: string,
  entries: readonly GoshthiEntry[],
  wingCells: ReadonlyMap<GoshthiEntry, string | null>,
  wings: ReadonlyMap<string, SevaWing | null>,
): GoshthiGroupFix[] {
  // Rooms first, from the rooms as given: the rest of the group must all name one room.
  const byGroup = new Map<string, GoshthiEntry[]>();
  for (const e of entries) if (e.group) byGroup.set(e.group, [...(byGroup.get(e.group) ?? []), e]);
  const roomOf = new Map<GoshthiEntry, string>();
  for (const rows of byGroup.values()) {
    const named = rows.filter((e) => e.room);
    for (const e of named) {
      // An organiser-marked split keeps its own room.
      if (e.split) continue;
      const rest = new Set(named.filter((x) => x !== e).map((x) => x.room!));
      if (named.length - 1 >= 2 && rest.size === 1 && !rest.has(e.room!)) roomOf.set(e, [...rest][0]);
    }
  }
  const fixes: GoshthiGroupFix[] = [];
  for (const e of entries) {
    if (!e.group) continue;
    const groupWing = wings.get(e.group) ?? null;
    const wing = groupWing && e.wing !== groupWing ? { given: wingCells.get(e) ?? null, used: groupWing } : null;
    const used = roomOf.get(e);
    const room = used ? { given: e.room!, used } : null;
    if (wing) e.wing = wing.used;
    if (room) e.room = room.used;
    if (wing || room) fixes.push({ registrationId: e.registrationId, source, row: e.row, group: groupName(e), wing, room });
  }
  return fixes;
}

type Block = { headerRow: number; labelCol: number; lastCol: number; n: number; idCol: number; roomCol: number };

/** Every "Group <N>" block of a grid tab (its header row, columns and the User Id / Location columns). */
function findBlocks(sheet: GoshthiTextSheet, source: string, errors: string[]): Block[] {
  const blocks: Block[] = [];
  sheet.cells.forEach((row, r) => {
    (row ?? []).forEach((v, c) => {
      const m = v?.match(GROUP_HEADER);
      if (!m) return;
      // The block's headers run right of the label up to the first blank header.
      let lastCol = c;
      while (at(sheet.cells, r, lastCol + 1) !== null && !GROUP_HEADER.test(at(sheet.cells, r, lastCol + 1)!)) lastCol++;
      if (lastCol === c) return; // a lone "Group 4" cell, not a block header
      const headers = (row ?? []).slice(c + 1, lastCol + 1);
      const roomAt = headers.findIndex((h) => matches(h, GRID_ROOM_HEADERS));
      const idAt = headers.findIndex((h) => matches(h, GRID_ID_HEADERS));
      const block: Block = {
        headerRow: r,
        labelCol: c,
        lastCol,
        n: Number(m[1]),
        idCol: idAt >= 0 ? c + 1 + idAt : -1,
        roomCol: roomAt >= 0 ? c + 1 + roomAt : -1,
      };
      if (block.idCol < 0) block.idCol = idColumnByValues(sheet, block);
      if (block.idCol < 0) {
        errors.push(`${source}: block "${v}" (row ${r + 1}) has no User Id column (no id header, no column of numbers)`);
        return;
      }
      blocks.push(block);
    });
  });
  return blocks;
}

/** The rows of a block below its header, up to the first row empty in the block's columns. */
function blockRows(sheet: GoshthiTextSheet, b: Block): number[] {
  const rows: number[] = [];
  for (let r = b.headerRow + 1; r < sheet.cells.length; r++) {
    const label = at(sheet.cells, r, b.labelCol);
    if (label && GROUP_HEADER.test(label)) break;
    // The merged Location can run past the members: the other cells decide.
    let content = false;
    for (let c = b.labelCol; c <= b.lastCol; c++) if (c !== b.roomCol && at(sheet.cells, r, c)) content = true;
    if (!content) break;
    rows.push(r);
  }
  return rows;
}

/** No id header: the block column (not the row labels) whose values are all whole numbers. */
function idColumnByValues(sheet: GoshthiTextSheet, b: Block): number {
  const rows = blockRows(sheet, { ...b, idCol: -1 });
  for (let c = b.labelCol + 1; c <= b.lastCol; c++) {
    if (c === b.roomCol) continue;
    const values = rows.map((r) => at(sheet.cells, r, c)).filter((v): v is string => v !== null);
    if (values.length > 0 && values.length >= rows.length - 1 && values.every((v) => /^\d{1,8}$/.test(v))) return c;
  }
  return -1;
}

function readGridTab(source: string, sheet: GoshthiTextSheet, blocks: Block[], errors: string[]): TabResult {
  const track = trackFromName(sheet.name);
  const info = newInfo(source, "grid", track, null);
  info.statedPeople = statedPeople(sheet.cells, Math.min(...blocks.map((b) => b.headerRow)));
  const entries: GoshthiEntry[] = [];
  const corrections = new Map<string, number>();
  const otherLocations = new Map<string, Set<string>>();
  const seen = new Map<number, number>();
  for (const b of blocks) {
    const group = gridGroupValue(b.n);
    if (seen.has(b.n)) errors.push(`${source}: "Group ${b.n}" heads two blocks (rows ${seen.get(b.n)! + 1} and ${b.headerRow + 1})`);
    seen.set(b.n, b.headerRow);
    const rows = blockRows(sheet, b);
    const isModerator = (r: number) => sheetKey(at(sheet.cells, r, b.labelCol)).startsWith("moderator");
    // The room: the Location the members share (merged across them), else the moderators'.
    const locations = (rs: number[]) => rs.map((r) => (b.roomCol >= 0 ? at(sheet.cells, r, b.roomCol) : null)).filter((v): v is string => !!v);
    const members = rows.filter((r) => !isModerator(r));
    const pool = locations(members).length > 0 ? locations(members) : locations(rows);
    const counts = new Map<string, number>();
    for (const l of pool) counts.set(l, (counts.get(l) ?? 0) + 1);
    const raw = [...counts].sort((x, y) => y[1] - x[1])[0]?.[0] ?? null;
    const { room, corrected } = readRoom(raw);
    const others = new Set(locations(rows).filter((l) => l !== raw));
    if (others.size > 0) otherLocations.set(group, others);
    for (const r of rows) {
      const registrationId = at(sheet.cells, r, b.idCol);
      if (!registrationId) {
        info.rowsWithoutUserId.push(r + 1);
        continue;
      }
      if (corrected) countCorrection(corrections, raw!, room!);
      entries.push({
        registrationId,
        source,
        format: "grid",
        track,
        wing: null,
        group,
        room,
        moderator: isModerator(r),
        split: null,
        row: r + 1,
      });
    }
  }
  const groups = summariseGroups(source, track, entries, otherLocations);
  return { info: fillInfo(info, entries, groups), entries, groups, corrections, moved: [], fixes: [] };
}

/** A group as the tab lays it out: "Kishore Group 4" (list, with the row's wing), "Goshthi Group 12" (grid). */
function groupName(e: GoshthiEntry): string {
  return e.format === "list" && e.wing ? `${WING_LABEL[e.wing] ?? e.wing} ${e.group}` : e.group!;
}

/** The groups of a tab, in workbook order. */
function summariseGroups(
  source: string,
  track: Track | null,
  entries: readonly GoshthiEntry[],
  otherLocations: ReadonlyMap<string, ReadonlySet<string>>,
): GoshthiGroupInfo[] {
  const byGroup = new Map<string, GoshthiGroupInfo>();
  for (const e of entries) {
    if (!e.group) continue;
    // Keep the row's wing in a list group's name: the old workbook restarted its numbers per wing.
    const key = groupName(e);
    const g = byGroup.get(key) ?? {
      source,
      track,
      group: key,
      room: null,
      people: 0,
      moderators: 0,
      otherLocations: [...(otherLocations.get(e.group) ?? [])],
      moderatorRows: [],
      roomsSeen: [],
      roomRows: 0,
      blankRoomRows: 0,
    };
    g.people++;
    if (e.moderator) {
      g.moderators++;
      g.moderatorRows.push({ registrationId: e.registrationId, row: e.row });
    }
    if (e.room && !g.roomsSeen.includes(e.room)) g.roomsSeen.push(e.room);
    if (e.room) g.roomRows++;
    else g.blankRoomRows++;
    if (!g.room && e.room) g.room = e.room;
    else if (g.room && e.room && e.room !== g.room && !g.otherLocations.includes(e.room)) g.otherLocations.push(e.room);
    byGroup.set(key, g);
  }
  return [...byGroup.values()];
}

function fillInfo(info: GoshthiTabInfo, entries: readonly GoshthiEntry[], groups: readonly GoshthiGroupInfo[]): GoshthiTabInfo {
  info.people = entries.length;
  info.groups = groups.length;
  info.rooms = new Set(entries.map((e) => e.room).filter(Boolean)).size;
  info.moderators = entries.filter((e) => e.moderator).length;
  info.blankRooms = entries.filter((e) => !e.room).length;
  return info;
}

/**
 * Every goshthi row of the workbooks, with each tab read as a list, a group
 * grid, or ignored (hidden, or neither), the room corrections made and the list
 * rows that took their group's wing / room.
 */
export function readGoshthiTabs(workbooks: readonly GoshthiTextWorkbook[]): {
  tabs: GoshthiTabInfo[];
  ignoredTabs: string[];
  entries: GoshthiEntry[];
  groups: GoshthiGroupInfo[];
  roomCorrections: GoshthiPlan["roomCorrections"];
  movedRows: GoshthiMovedRow[];
  groupFixes: GoshthiGroupFix[];
  errors: string[];
} {
  const tabs: GoshthiTabInfo[] = [];
  const ignoredTabs: string[] = [];
  const entries: GoshthiEntry[] = [];
  const groups: GoshthiGroupInfo[] = [];
  const roomCorrections: GoshthiPlan["roomCorrections"] = [];
  const movedRows: GoshthiMovedRow[] = [];
  const groupFixes: GoshthiGroupFix[] = [];
  const errors: string[] = [];
  for (const wb of workbooks) {
    for (const sheet of wb.sheets) {
      const source = `${wb.file} / ${sheet.name}`;
      const hasData = sheet.cells.some((r) => (r ?? []).some((v) => v !== null));
      if (sheet.state !== "visible") {
        ignoredTabs.push(`${source} (${sheet.state}: the organisers' old copy, not read)`);
        continue;
      }
      const header = findListHeader(sheet.cells);
      let result: TabResult | null = null;
      if (header) result = readListTab(source, sheet, header);
      else {
        const blocks = findBlocks(sheet, source, errors);
        if (blocks.length > 0) result = readGridTab(source, sheet, blocks, errors);
      }
      if (!result) {
        if (hasData) ignoredTabs.push(`${source} (neither a "User Id" / "Goshthi Group" list nor "Group <N>" blocks, e.g. a summary)`);
        continue;
      }
      tabs.push(result.info);
      entries.push(...result.entries);
      groups.push(...result.groups);
      movedRows.push(...result.moved);
      groupFixes.push(...result.fixes);
      for (const [key, rows] of result.corrections) {
        const [from, to] = JSON.parse(key) as [string, string];
        roomCorrections.push({ source, from, to, rows });
      }
    }
  }
  return { tabs, ignoredTabs, entries, groups, roomCorrections, movedRows, groupFixes, errors };
}

/** A planned delegate as the goshthi assignment reads and fills it (PlannedDelegate in delegateImport.ts). */
export type GoshthiPerson = {
  registrationId: string;
  gender: Track;
  sevaWing: SevaWing;
  seva: string;
  goshthiGroup: string | null;
  goshthiRoom: string | null;
  goshthiModerator: boolean;
  goshthiSource: string | null;
  goshthiOwned: boolean;
};

const TRACKS: readonly Track[] = ["MALE", "FEMALE"];

/** An entry's group as the plan reports it: "Group 4 (Kishore)", "Goshthi Group 12". */
function entryLabel(e: GoshthiEntry): string {
  if (!e.group) return "no group";
  return e.wing && e.format === "list" ? `${e.group} (${WING_LABEL[e.wing] ?? e.wing})` : e.group;
}

/**
 * Reads the goshthi workbooks and fills in each person's group, room and
 * moderator flag (mutating `people`), with everything the plan reports.
 *
 * - A person is owned (the import writes their three goshthi columns) when a
 *   tab covers their track or a row lists them; everyone else is left as they
 *   are, so a Bhaio-only workbook never clears Behno groups.
 * - Listed in exactly one group (the same group twice counts once): that
 *   group, its room, and moderator when any of their rows is a "Moderator:" row.
 * - Owned but listed nowhere, in several groups, on both sides, with a blank
 *   group, or on a row the tab doesn't settle (among another group's rows,
 *   movedRows): none (group and room null, not a moderator), and listed.
 * - Listed on the other track's side, or under another wing than their own:
 *   assigned as the organisers placed them, and listed. In a tab numbering its
 *   groups across wings, the wing is the group's (a row's own blank or differing
 *   Wing cell was already replaced and listed in groupFixes).
 * - Rows whose User Id the plan doesn't import are listed with
 *   `whyNotImported(id)`.
 */
export function assignGoshthi(
  people: GoshthiPerson[],
  workbooks: readonly GoshthiTextWorkbook[],
  whyNotImported: (registrationId: string) => string,
): GoshthiPlan {
  const read = readGoshthiTabs(workbooks);
  // A tab whose name gives no side: take the side of the imported people it lists when
  // nearly all are on one track.
  const genderById = new Map(people.map((p) => [p.registrationId, p.gender] as const));
  const inferredSides: GoshthiPlan["inferredSides"] = [];
  const unknownSides: string[] = [];
  for (const t of read.tabs) {
    if (t.track || t.people === 0) continue;
    const tabEntries = read.entries.filter((e) => e.source === t.source);
    // Each person once, however many rows list them.
    const counts: Record<Track, number> = { MALE: 0, FEMALE: 0 };
    for (const id of new Set(tabEntries.map((e) => e.registrationId))) {
      const g = genderById.get(id);
      if (g) counts[g]++;
    }
    const matched = counts.MALE + counts.FEMALE;
    const top: Track = counts.FEMALE >= counts.MALE ? "FEMALE" : "MALE";
    if (matched >= SIDE_FROM_PEOPLE_MIN && counts[top] >= SIDE_FROM_PEOPLE_SHARE * matched) {
      t.track = top;
      for (const e of tabEntries) e.track = top;
      for (const g of read.groups) if (g.source === t.source) g.track = top;
      inferredSides.push({ source: t.source, track: top, onTrack: counts[top], matched });
    } else {
      unknownSides.push(t.source);
    }
  }
  const covered = new Set(read.tabs.filter((t) => t.track && t.people > 0).map((t) => t.track!));
  const plan: GoshthiPlan = {
    tabs: read.tabs,
    ignoredTabs: read.ignoredTabs,
    coveredTracks: TRACKS.filter((t) => covered.has(t)),
    inferredSides,
    unknownSides,
    groups: read.groups,
    rooms: summariseRooms(read.groups),
    assigned: 0,
    assignedByTrack: { MALE: 0, FEMALE: 0 },
    moderators: [],
    blankRoom: [],
    roomFilled: [],
    movedRows: read.movedRows,
    groupFixes: read.groupFixes,
    roomCorrections: read.roomCorrections,
    splits: [],
    notImported: [],
    withoutGroup: [],
    tabMismatch: [],
    otherSide: [],
    listedTwice: [],
    blankGroup: [],
    conflicts: [],
    errors: read.errors,
  };

  const byId = new Map<string, GoshthiEntry[]>();
  for (const e of read.entries) byId.set(e.registrationId, [...(byId.get(e.registrationId) ?? []), e]);
  const planned = new Set(people.map((p) => p.registrationId));
  for (const [registrationId, list] of byId) {
    if (planned.has(registrationId)) continue;
    const why = whyNotImported(registrationId);
    for (const e of list) plan.notImported.push({ registrationId, source: e.source, why });
  }

  for (const p of people) {
    const list = byId.get(p.registrationId) ?? [];
    p.goshthiOwned = covered.has(p.gender) || list.length > 0;
    if (!p.goshthiOwned) continue;
    // The workbook decides: none unless one group lists them.
    p.goshthiGroup = null;
    p.goshthiRoom = null;
    p.goshthiModerator = false;
    p.goshthiSource = null;
    if (list.length === 0) {
      plan.withoutGroup.push({ registrationId: p.registrationId, track: p.gender, sevaWing: p.sevaWing, seva: p.seva });
      continue;
    }
    // A row whose group the tab doesn't settle: none until the organisers say.
    if (list.some((e) => e.unsettled)) {
      plan.conflicts.push({
        registrationId: p.registrationId,
        sources: list.map((e) => `${e.source} row ${e.row}: ${e.unsettled ?? entryLabel(e)}`),
      });
      continue;
    }
    // One group = (tab, wing, group); the first row of each stands for it.
    const distinct = new Map<string, GoshthiEntry>();
    for (const e of list) {
      const key = JSON.stringify([e.source, e.wing, e.group]);
      if (!distinct.has(key)) distinct.set(key, e);
    }
    if (distinct.size > 1) {
      plan.conflicts.push({ registrationId: p.registrationId, sources: list.map((e) => `${e.source} row ${e.row}: ${entryLabel(e)}`) });
      continue;
    }
    const [e] = distinct.values();
    if (list.length > 1) plan.listedTwice.push({ registrationId: p.registrationId, source: e.source, group: e.group });
    if (!e.group) {
      plan.blankGroup.push({ registrationId: p.registrationId, source: e.source });
      continue;
    }
    p.goshthiGroup = storedGoshthiGroup(e, p.sevaWing);
    p.goshthiRoom = list.find((x) => x.room)?.room ?? null;
    p.goshthiModerator = list.some((x) => x.moderator);
    p.goshthiSource = e.source;
    plan.assigned++;
    plan.assignedByTrack[p.gender]++;
    if (p.goshthiModerator) plan.moderators.push(p.registrationId);
    if (!p.goshthiRoom) {
      const name = groupName(e);
      const info = read.groups.find((g) => g.source === e.source && g.group === name);
      if (info && info.roomsSeen.length === 1 && info.roomRows > info.blankRoomRows) {
        // Most of the group names one room and the rest is blank: a merged Room cell that stops short.
        p.goshthiRoom = info.roomsSeen[0];
        plan.roomFilled.push({ registrationId: p.registrationId, source: e.source, group: name, room: info.roomsSeen[0] });
      } else {
        plan.blankRoom.push({ registrationId: p.registrationId, source: e.source, group: name, groupRooms: info?.roomsSeen ?? [] });
      }
    }
    const split = list.find((x) => x.split)?.split;
    if (split) plan.splits.push({ registrationId: p.registrationId, source: e.source, split });
    if (e.wing && e.wing !== p.sevaWing) {
      plan.tabMismatch.push({ registrationId: p.registrationId, source: e.source, sevaWing: p.sevaWing, group: p.goshthiGroup! });
    }
    if (e.track && e.track !== p.gender) plan.otherSide.push({ registrationId: p.registrationId, source: e.source, track: p.gender });
  }
  return plan;
}

/** Rooms across the groups: groups and people per room, largest first. */
export function summariseRooms(groups: readonly GoshthiGroupInfo[]): GoshthiRoomInfo[] {
  const rooms = new Map<string, GoshthiRoomInfo>();
  for (const g of groups) {
    if (!g.room) continue;
    const key = JSON.stringify([g.track, g.room]);
    const r = rooms.get(key) ?? { room: g.room, track: g.track, groups: 0, people: 0 };
    r.groups++;
    r.people += g.people;
    rooms.set(key, r);
  }
  return [...rooms.values()].sort(
    (a, b) => (a.track ?? "").localeCompare(b.track ?? "") || b.people - a.people || a.room.localeCompare(b.room),
  );
}
