/**
 * The planning half of the rooming import (scripts/import-rooming.ts). Turns
 * the organisers' rooming workbook ("FINAL Rooming List") into one
 * room_groups row per room group and stay (whoever is in it) and one
 * room_assignments row per person and stay, and says what was skipped and
 * what looks odd. reconcileRooming() / reconcileRoomGroups() then compare the
 * plan with the database, and checkRoomingPeople() with the people on file
 * (the users table, or offline the master list) for accounts and mixed-track
 * rooms.
 *
 * Pure: no database, no file access. The script reads the workbook (exceljs)
 * and passes each sheet in as rows of raw cell values plus its merged ranges
 * and visibility; nothing from the spreadsheet lives in the repo. Names are
 * never read: the app names people from `users` by their User Id.
 *
 * The workbook:
 * - The per-hotel tabs, the organisers' final lists, all VISIBLE, and named
 *   in ROOMING_TABS below: "eBKY Hampton Wednesday", "eBKY Hampton Thursday",
 *   "eBKY Courtyard", "eBKY-iBKY DoubleTree", "iBKY Hilton". A header row that
 *   starts "Mock Room" (not always row 1: "iBKY Hilton" has a title above it),
 *   then one row per bed: Mock Room | Hotel | Bed | User ID | (BAPS ID, blank)
 *   | Full Name. The Mock Room and Hotel cells are merged down across a room's
 *   beds: every row of a Mock Room merge is one bed of that room group. A bed
 *   row without a User ID is an open bed (its Full Name cell says "OPEN BED";
 *   any other name there is flagged).
 * - Only those five tabs are read, and each must be there, visible and with
 *   beds: a hotel tab missing, hidden or emptied is an error (the import
 *   would otherwise read it as everyone at that hotel leaving, and delete
 *   them). Any other visible tab with a "Mock Room" header is an error too (a
 *   working sheet unhidden, or a new hotel tab to add to ROOMING_TABS).
 * - Hidden tabs ("Summary", "Hotel Allocation", "_Invitee Lookup", "eBKY
 *   NAAM", "iBKY Wednesday", "Family Rooms", "Exceptions", the "v2" copies)
 *   are the organisers' working and mock sheets: ignored, whatever they hold.
 * - "Summary V2" (visible): room totals, used only as a cross-check of the
 *   rooms per hotel and their sizes.
 *
 * Rules (the organisers', 2026-09-26):
 * - Stay per tab (ROOMING_TABS): "eBKY Hampton Wednesday" = WED, the night of
 *   Wed, Oct 7 (early arrivals); every other hotel tab = MAIN, from Thu, Oct 8.
 * - A room group is (stay, hotel, Mock Room number). The number is an
 *   assignment, not a hotel room number: the app shows "Room group N". The
 *   hotel comes from the Hotel cell (spellings in src/lib/hotels.ts; a blank
 *   cell falls back to the tab name); an unknown hotel stops the import.
 * - A User Id on more than one bed row within one stay (two rooms, or two beds
 *   of one room) is a conflict: that person's assignment for that stay is
 *   skipped (none written, none deleted) and listed; their beds still count
 *   toward the room's capacity, as held beds, and the room group is stored
 *   (room_groups) even when nobody else is in it, so the board shows it.
 * - Wednesday vs Thursday: someone in the same room group on both nights is
 *   shown "From Wed, Oct 7"; a different Wednesday room, or a Wednesday night
 *   without a Thursday room, is representable (two rows) and listed.
 * - Rooms mixing Bhaio and Behno (by users.gender) are fine only as family /
 *   couple rooms: listed, never fixed. Every other oddity is flagged, not fixed.
 */
import { cellText, idList, type SheetRows } from "./delegateImport";
import {
  STAYS,
  STAY_LABELS,
  compareHotels,
  hotelInfo,
  hotelKeyFor,
  hotelKeyInText,
  roomKeyFor,
  type HotelKey,
  type Stay,
} from "./hotels";
import { sheetKey } from "./sevaMapping";

// ---------------------------------------------------------------------------
// Types

/** One worksheet: rows as read (row 1 first), its merged ranges ("A2:A5") and its exceljs state. */
export type RoomingSheet = SheetRows & {
  merges?: readonly string[];
  /** "visible" | "hidden" | "veryHidden" (exceljs `ws.state`); missing = visible. */
  state?: string;
};

/** A room_assignments row as the import writes it. */
export type PlannedAssignment = {
  /** "<registrationId>-wed" / "<registrationId>-main". */
  id: string;
  registrationId: string;
  stay: Stay;
  hotel: HotelKey;
  roomNumber: number;
  bed: number | null;
  /** "MAIN-hampton-12". */
  roomKey: string;
  roomCapacity: number;
  roomOpenBeds: number;
  sourceSheet: string;
};

/** The fields an assignment is compared on. */
export const ASSIGNMENT_FIELDS = [
  "hotel",
  "roomNumber",
  "bed",
  "roomKey",
  "roomCapacity",
  "roomOpenBeds",
  "sourceSheet",
] as const satisfies readonly (keyof PlannedAssignment)[];
export type AssignmentField = (typeof ASSIGNMENT_FIELDS)[number];

const FIELD_LABELS: Record<AssignmentField, string> = {
  hotel: "hotel",
  roomNumber: "room group",
  bed: "bed",
  roomKey: "room key",
  roomCapacity: "room capacity",
  roomOpenBeds: "open beds",
  sourceSheet: "source sheet",
};

/** One room group as the workbook gives it. */
export type PlannedRoom = {
  roomKey: string;
  stay: Stay;
  hotel: HotelKey;
  roomNumber: number;
  sheet: string;
  /** 1-based sheet rows of its first and last bed. */
  firstRow: number;
  lastRow: number;
  /** Bed rows (filled or open). */
  capacity: number;
  /** Bed rows without a User Id. */
  openBeds: number;
  /** Bed rows of User Ids skipped as conflicts. */
  heldBeds: number;
  /** The User Id on each held bed row, in bed order (one twice when it holds two beds here). */
  heldRegistrationIds: string[];
  /** User Ids assigned here by this plan, in bed order. */
  registrationIds: string[];
};

/** The fields a room group is compared on (room_groups; `sheet` is stored as source_sheet). */
export const ROOM_GROUP_FIELDS = [
  "hotel",
  "roomNumber",
  "capacity",
  "openBeds",
  "heldBeds",
  "heldRegistrationIds",
  "sheet",
] as const satisfies readonly (keyof PlannedRoom)[];
type RoomGroupField = (typeof ROOM_GROUP_FIELDS)[number];

const ROOM_GROUP_FIELD_LABELS: Record<RoomGroupField, string> = {
  hotel: "hotel",
  roomNumber: "room group",
  capacity: "beds",
  openBeds: "open beds",
  heldBeds: "held beds",
  heldRegistrationIds: "held User Ids",
  sheet: "source sheet",
};

export type RoomingSheetRole = "rooming" | "cross-check" | "ignored";

export type RoomingSheetInfo = {
  name: string;
  role: RoomingSheetRole;
  /** exceljs state ("visible" when not given). */
  state: string;
  stay?: Stay;
  /** 1-based. */
  headerRow?: number;
  rooms: number;
  beds: number;
  /** Bed rows with a User Id. */
  filled: number;
  openBeds: number;
  merges: number;
  /** Why the tab was ignored, or what it is used for. */
  note?: string;
};

/** A User Id on more than one bed row within one stay: skipped for that stay. */
export type RoomingConflict = { registrationId: string; stay: Stay; places: string[] };

export type NoteKind =
  | "row-without-room"
  | "name-without-user-id"
  | "placeholder-user-id"
  | "hotel-from-tab-name"
  | "bed-unreadable"
  | "bed-repeated"
  | "room-nobody-placed"
  | "wed-room-differs"
  | "wed-only"
  | "summary-unknown-hotel"
  | "summary-mismatch";

export const NOTE_LABELS: Record<NoteKind, string> = {
  "row-without-room": "Row with data outside any room group (skipped)",
  "name-without-user-id": "Bed row with a name but no User Id (counted as an open bed)",
  "placeholder-user-id": "User Id cell is a placeholder such as TBD (counted as an open bed)",
  "hotel-from-tab-name": "Hotel cell blank: hotel taken from the tab name",
  "bed-unreadable": "Bed cell not a number (stored blank)",
  "bed-repeated": "Bed number used twice in one room group",
  "room-nobody-placed": "Room group with nobody placed (open, or held by skipped User Ids): listed empty on the admin board",
  "wed-room-differs": "Wednesday room group differs from the Thursday one (shown as two stays)",
  "wed-only": "Wednesday night but no room from Thursday",
  "summary-unknown-hotel": "Summary row naming no known hotel (not compared)",
  "summary-mismatch": "Summary totals disagree with the hotel tabs",
};

/** Report-safe items: User Ids, room keys, sheet names and row numbers only. */
export type RoomingNote = { kind: NoteKind; items: string[] };

/** One hotel of a summary tab against the hotel tabs. */
export type HotelCheck = {
  hotel: HotelKey;
  summaryTotal: number | null;
  /** Rooms per "N/Room" column, by N ("4" -> 23). */
  summaryBySize: Record<string, number>;
  summaryFamily: number;
  /** Distinct room groups at the hotel over both stays (Wednesday room N is Thursday room N). */
  plannedTotal: number;
  /** By beds per room ("4" -> 23). */
  plannedBySize: Record<string, number>;
  ok: boolean;
};

export type SummaryCrossCheck = {
  sheet: string;
  hotels: HotelCheck[];
  summaryTotal: number;
  plannedTotal: number;
  ok: boolean;
};

export type Continuity = {
  /** People with a WED and a MAIN assignment. */
  both: number;
  sameRoom: number;
  sameBed: number;
  /** User Ids whose Wednesday room group differs from the Thursday one. */
  moved: string[];
  /** User Ids with a Wednesday night and no room from Thursday. */
  wedOnly: string[];
};

export type RoomingPlan = {
  sheets: RoomingSheetInfo[];
  assignments: PlannedAssignment[];
  rooms: PlannedRoom[];
  /** Distinct User Ids with at least one assignment. */
  people: string[];
  conflicts: RoomingConflict[];
  continuity: Continuity;
  crossChecks: SummaryCrossCheck[];
  notes: RoomingNote[];
  /** Invariant failures: the import refuses to write while there are any. */
  errors: string[];
};

// ---------------------------------------------------------------------------
// Cells and sheets

const COLUMNS = {
  room: ["Mock Room"],
  hotel: ["Hotel"],
  bed: ["Bed"],
  userId: ["User ID", "User Id", "UserId"],
  name: ["Full Name", "Name"],
} as const;
type ColumnKey = keyof typeof COLUMNS;

/** User Id cells that mean "nobody yet". */
const OPEN_BED_TEXT = new Set(["tbd", "tba", "na", "n/a", "x", "-", "--", "none", "?", "open", "empty", "vacant"]);

/** Full Name cells that mark a bed as open (the sheet writes "OPEN BED"): an open bed, not a flag. */
const OPEN_BED_NAMES = new Set(["open bed", "open", "empty bed", "empty", "vacant", "available", "tbd"]);

/** A positive whole number from a cell: 12, "12", "Room 12", "#12"; null when blank; NaN when unreadable. */
function wholeNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isInteger(value) && value > 0 ? value : Number.NaN;
  const s = cellText(value);
  if (s === null) return null;
  const m = s.match(/^(?:room\s*(?:group\s*)?)?(?:no\.?\s*)?#?\s*(\d+)$/i);
  return m && Number(m[1]) > 0 ? Number(m[1]) : Number.NaN;
}

/** The 0-based header row: the first of the top ten rows with a "Mock Room" cell. */
function headerRowIndex(sheet: RoomingSheet): number | null {
  const want = sheetKey(COLUMNS.room[0]);
  for (let i = 0; i < Math.min(10, sheet.rows.length); i++) {
    if ((sheet.rows[i] ?? []).some((v) => sheetKey(cellText(v)) === want)) return i;
  }
  return null;
}

function columnIndexes(header: readonly unknown[]): Partial<Record<ColumnKey, number>> {
  const keys = header.map((v) => sheetKey(cellText(v)));
  const cols: Partial<Record<ColumnKey, number>> = {};
  for (const key of Object.keys(COLUMNS) as ColumnKey[]) {
    const idx = keys.findIndex((h) => h !== "" && COLUMNS[key].some((name) => sheetKey(name) === h));
    if (idx >= 0) cols[key] = idx;
  }
  return cols;
}

type Range = { r0: number; c0: number; r1: number; c1: number };

/** Column letters to a 0-based index ("A" -> 0, "AA" -> 26). */
function columnIndex(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** "A2:A5" -> 0-based { r0: 1, c0: 0, r1: 4, c1: 0 }; null when unreadable. */
function parseRange(range: string): Range | null {
  const m = range.match(/^\$?([A-Z]+)\$?(\d+):\$?([A-Z]+)\$?(\d+)$/i);
  if (!m) return null;
  return { c0: columnIndex(m[1]), r0: Number(m[2]) - 1, c1: columnIndex(m[3]), r1: Number(m[4]) - 1 };
}

/** The rows with every merged range's top-left value copied into its blank cells. */
function fillMerges(rows: readonly unknown[][], ranges: readonly Range[]): unknown[][] {
  const out = rows.map((r) => [...(r ?? [])]);
  for (const { r0, c0, r1, c1 } of ranges) {
    const master = out[r0]?.[c0];
    for (let r = r0; r <= r1; r++) {
      out[r] ??= [];
      for (let c = c0; c <= c1; c++) if (out[r][c] === null || out[r][c] === undefined) out[r][c] = master;
    }
  }
  return out;
}

/**
 * The organisers' hotel tabs and the stay each holds: the import reads these
 * and only these (names matched with sheetKey(): case and repeated spaces
 * ignored). Each must be in the workbook, visible and with beds, or the plan
 * has an error and nothing is written. When the organisers rename a tab or
 * add a hotel, change this list.
 */
export const ROOMING_TABS: Readonly<Record<string, Stay>> = {
  "eBKY Hampton Wednesday": "WED",
  "eBKY Hampton Thursday": "MAIN",
  "eBKY Courtyard": "MAIN",
  "eBKY-iBKY DoubleTree": "MAIN",
  "iBKY Hilton": "MAIN",
};

const TAB_STAY: ReadonlyMap<string, Stay> = new Map(
  Object.entries(ROOMING_TABS).map(([name, stay]) => [sheetKey(name), stay] as const),
);

/** The stay a hotel tab holds (ROOMING_TABS), or null for any other tab. */
export function stayForSheet(name: string): Stay | null {
  return TAB_STAY.get(sheetKey(name)) ?? null;
}

function roleFor(sheet: RoomingSheet): { role: RoomingSheetRole; note?: string; stay?: Stay } {
  const state = sheet.state ?? "visible";
  const stay = stayForSheet(sheet.name);
  if (state !== "visible") {
    return { role: "ignored", note: stay ? `${state}: a hotel tab, not read while hidden` : `${state}: an organisers' working sheet` };
  }
  if (stay) return { role: "rooming", stay };
  if (sheetKey(sheet.name).startsWith("summary")) return { role: "cross-check", note: "room totals per hotel" };
  if (headerRowIndex(sheet) !== null) return { role: "ignored", note: 'has a "Mock Room" header but is not a hotel tab the import reads' };
  return { role: "ignored", note: 'no "Mock Room" header' };
}

// ---------------------------------------------------------------------------
// Planning

type BedRow = {
  sheet: string;
  /** 1-based. */
  row: number;
  stay: Stay;
  roomKey: string;
  roomNumber: number;
  bed: number | null;
  registrationId: string | null;
};

type RoomDraft = Omit<PlannedRoom, "heldBeds" | "heldRegistrationIds" | "registrationIds" | "openBeds"> & { beds: BedRow[] };

const byId = (a: string, b: string) => a.localeCompare(b, "en", { numeric: true });

/**
 * The import plan for the rooming workbook's sheets (every worksheet, in
 * workbook order, each with its state and merges). A hotel tab of
 * ROOMING_TABS missing, hidden, without its header or without beds, or an
 * unexpected visible "Mock Room" tab, is an error in the plan (so nothing is
 * written), never a hotel's worth of deletes.
 */
export function planRooming(sheets: readonly RoomingSheet[]): RoomingPlan {
  const errors: string[] = [];
  const noteMap = new Map<NoteKind, string[]>();
  const note = (kind: NoteKind, item: string) => {
    const list = noteMap.get(kind) ?? [];
    if (!list.includes(item)) list.push(item);
    noteMap.set(kind, list);
  };

  const infos: RoomingSheetInfo[] = [];
  const rooms = new Map<string, RoomDraft>();
  const summaries: RoomingSheet[] = [];

  for (const sheet of sheets) {
    const { role, note: why, stay } = roleFor(sheet);
    const info: RoomingSheetInfo = {
      name: sheet.name,
      role,
      state: sheet.state ?? "visible",
      rooms: 0,
      beds: 0,
      filled: 0,
      openBeds: 0,
      merges: sheet.merges?.length ?? 0,
      ...(why ? { note: why } : {}),
    };
    infos.push(info);
    if (role === "cross-check") summaries.push(sheet);
    if (role === "ignored" && info.state === "visible" && headerRowIndex(sheet) !== null) {
      errors.push(
        `"${sheet.name}" is a visible tab with a "Mock Room" header that the import doesn't read: hide it if it's a ` +
          `working sheet, or add it to ROOMING_TABS in src/lib/roomingImport.ts if it's a new hotel tab`,
      );
    }
    if (role !== "rooming" || !stay) continue;
    readHotelTab(sheet, stay, info, rooms, errors, note);
  }

  // Every hotel tab there, visible and with beds: a missing one must never read as "everyone left".
  for (const [name, stay] of Object.entries(ROOMING_TABS)) {
    const sheet = sheets.find((s) => sheetKey(s.name) === sheetKey(name));
    const info = sheet ? infos[sheets.indexOf(sheet)] : undefined;
    const why = `(the import would otherwise delete everyone's ${stay} room there; if it was renamed or retired, update ROOMING_TABS in src/lib/roomingImport.ts)`;
    if (!sheet || !info) errors.push(`Hotel tab "${name}" is missing from the workbook ${why}`);
    else if (info.state !== "visible") errors.push(`Hotel tab "${name}" is ${info.state} ${why}`);
    else if (info.headerRow !== undefined && info.beds === 0) errors.push(`Hotel tab "${name}" has no beds ${why}`);
  }

  // Conflicts: a User Id on more than one bed row within one stay.
  const bedsByPerson = new Map<string, BedRow[]>();
  for (const room of rooms.values()) {
    for (const b of room.beds) {
      if (!b.registrationId) continue;
      const k = `${b.stay}|${b.registrationId}`;
      bedsByPerson.set(k, [...(bedsByPerson.get(k) ?? []), b]);
    }
  }
  const conflicts: RoomingConflict[] = [];
  const conflicted = new Set<string>();
  for (const [k, list] of bedsByPerson) {
    if (list.length < 2) continue;
    conflicted.add(k);
    conflicts.push({
      registrationId: list[0].registrationId!,
      stay: list[0].stay,
      places: list.map((b) => `${b.sheet} row ${b.row} (${b.roomKey})`),
    });
  }
  conflicts.sort((a, b) => STAYS.indexOf(a.stay) - STAYS.indexOf(b.stay) || byId(a.registrationId, b.registrationId));

  // Rooms and assignments.
  const plannedRooms: PlannedRoom[] = [];
  const assignments: PlannedAssignment[] = [];
  for (const draft of rooms.values()) {
    const { beds, ...rest } = draft;
    const openBeds = beds.filter((b) => !b.registrationId).length;
    const held = beds.filter((b) => b.registrationId && conflicted.has(`${b.stay}|${b.registrationId}`));
    const placed = beds.filter((b) => b.registrationId && !conflicted.has(`${b.stay}|${b.registrationId}`));
    const room: PlannedRoom = {
      ...rest,
      openBeds,
      heldBeds: held.length,
      heldRegistrationIds: held.map((b) => b.registrationId!),
      registrationIds: placed.map((b) => b.registrationId!),
    };
    plannedRooms.push(room);
    if (placed.length === 0) {
      note("room-nobody-placed", `${room.roomKey} (${room.capacity} beds: ${openBeds} open, ${held.length} held; ${room.sheet} rows ${room.firstRow}-${room.lastRow})`);
    }
    const numbered = beds.map((b) => b.bed).filter((n): n is number => n !== null);
    if (new Set(numbered).size < numbered.length) note("bed-repeated", `${room.roomKey} (${room.sheet} rows ${room.firstRow}-${room.lastRow})`);
    for (const b of placed) {
      assignments.push({
        id: `${b.registrationId}-${b.stay.toLowerCase()}`,
        registrationId: b.registrationId!,
        stay: b.stay,
        hotel: room.hotel,
        roomNumber: room.roomNumber,
        bed: b.bed,
        roomKey: room.roomKey,
        roomCapacity: room.capacity,
        roomOpenBeds: openBeds,
        sourceSheet: room.sheet,
      });
    }
  }
  const roomOrder = (a: { stay: Stay; hotel: string; roomNumber: number }, b: { stay: Stay; hotel: string; roomNumber: number }) =>
    STAYS.indexOf(a.stay) - STAYS.indexOf(b.stay) || compareHotels(a.hotel, b.hotel) || a.roomNumber - b.roomNumber;
  plannedRooms.sort(roomOrder);
  assignments.sort((a, b) => roomOrder(a, b) || (a.bed ?? 99) - (b.bed ?? 99) || byId(a.registrationId, b.registrationId));

  // Wednesday vs Thursday.
  const mainOf = new Map(assignments.filter((a) => a.stay === "MAIN").map((a) => [a.registrationId, a]));
  const mainConflicts = new Set(conflicts.filter((c) => c.stay === "MAIN").map((c) => c.registrationId));
  const continuity: Continuity = { both: 0, sameRoom: 0, sameBed: 0, moved: [], wedOnly: [] };
  for (const wed of assignments.filter((a) => a.stay === "WED")) {
    const main = mainOf.get(wed.registrationId);
    if (!main) {
      if (!mainConflicts.has(wed.registrationId)) continuity.wedOnly.push(wed.registrationId);
      continue;
    }
    continuity.both++;
    if (main.hotel === wed.hotel && main.roomNumber === wed.roomNumber) {
      continuity.sameRoom++;
      if (main.bed !== null && main.bed === wed.bed) continuity.sameBed++;
    } else {
      continuity.moved.push(wed.registrationId);
    }
  }
  for (const id of continuity.moved) note("wed-room-differs", id);
  for (const id of continuity.wedOnly) note("wed-only", id);

  const crossChecks = summaries
    .map((s) => crossCheckSummary(s, plannedRooms, note))
    .filter((c): c is SummaryCrossCheck => c !== null);

  const notes: RoomingNote[] = (Object.keys(NOTE_LABELS) as NoteKind[])
    .filter((k) => noteMap.has(k))
    .map((kind) => ({ kind, items: noteMap.get(kind)! }));

  const plan: RoomingPlan = {
    sheets: infos,
    assignments,
    rooms: plannedRooms,
    people: [...new Set(assignments.map((a) => a.registrationId))].sort(byId),
    conflicts,
    continuity,
    crossChecks,
    notes,
    errors,
  };
  plan.errors.push(...validatePlan(plan));
  return plan;
}

/** Reads one hotel tab's room groups into `rooms` (keyed by room key). */
function readHotelTab(
  sheet: RoomingSheet,
  stay: Stay,
  info: RoomingSheetInfo,
  rooms: Map<string, RoomDraft>,
  errors: string[],
  note: (kind: NoteKind, item: string) => void,
) {
  info.stay = stay;
  const headerIdx = headerRowIndex(sheet);
  if (headerIdx === null) {
    errors.push(`Hotel tab "${sheet.name}": no "Mock Room" header row in its first ten rows`);
    return;
  }
  info.headerRow = headerIdx + 1;
  const cols = columnIndexes(sheet.rows[headerIdx] ?? []);
  if (cols.room === undefined || cols.userId === undefined) {
    errors.push(`${sheet.name}: no "User ID" column in the header row ${headerIdx + 1}`);
    return;
  }
  const roomCol = cols.room;
  const ranges = (sheet.merges ?? []).map(parseRange).filter((r): r is Range => r !== null);
  const rows = fillMerges(sheet.rows, ranges);
  const cell = (r: readonly unknown[], key: ColumnKey) => (cols[key] === undefined ? null : r[cols[key]!]);

  // A room group = the rows of one Mock Room merge, or one row with its own Mock Room.
  const rangeOfRow = new Map<number, string>();
  for (const g of ranges) {
    if (g.r1 <= g.r0 || g.c0 > roomCol || g.c1 < roomCol || g.r0 <= headerIdx) continue;
    for (let r = g.r0; r <= g.r1; r++) rangeOfRow.set(r, `${g.r0}:${g.r1}`);
  }
  const segments: number[][] = [];
  const segmentOfRange = new Map<string, number[]>();
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const rangeId = rangeOfRow.get(i);
    if (rangeId) {
      let seg = segmentOfRange.get(rangeId);
      if (!seg) {
        seg = [];
        segmentOfRange.set(rangeId, seg);
        segments.push(seg);
      }
      seg.push(i);
    } else if (cellText(cell(r, "room")) !== null) {
      segments.push([i]);
    } else if (r.some((v) => cellText(v) !== null)) {
      const id = cellText(cell(r, "userId"));
      note("row-without-room", `${sheet.name} row ${i + 1}${id ? ` (User Id ${id})` : ""}`);
    }
  }

  for (const seg of segments) {
    const first = seg[0];
    const last = seg[seg.length - 1];
    const where = `${sheet.name} rows ${first + 1}-${last + 1}`;
    const number = wholeNumber(cell(rows[first], "room"));
    if (number === null || Number.isNaN(number)) {
      errors.push(`${where}: Mock Room "${cellText(cell(rows[first], "room")) ?? ""}" is not a room number`);
      continue;
    }

    const hotelTexts = [...new Set(seg.map((i) => cellText(cell(rows[i], "hotel"))).filter((t): t is string => t !== null))];
    let hotel: HotelKey | null = null;
    if (hotelTexts.length === 0) {
      hotel = hotelKeyInText(sheet.name);
      if (!hotel) {
        errors.push(`${where}: no hotel (the Hotel cell is blank and the tab name names no hotel in src/lib/hotels.ts)`);
        continue;
      }
      note("hotel-from-tab-name", roomKeyFor(stay, hotel, number));
    } else {
      const unknown = hotelTexts.filter((t) => hotelKeyFor(t) === null);
      if (unknown.length > 0) {
        errors.push(`${where}: unknown hotel ${unknown.map((t) => `"${t}"`).join(", ")} (add it to src/lib/hotels.ts)`);
        continue;
      }
      const keys = [...new Set(hotelTexts.map((t) => hotelKeyFor(t)!))];
      if (keys.length > 1) {
        errors.push(`${where}: room group ${number} names several hotels (${hotelTexts.join(", ")})`);
        continue;
      }
      hotel = keys[0];
    }

    const roomKey = roomKeyFor(stay, hotel, number);
    const earlier = rooms.get(roomKey);
    if (earlier) {
      errors.push(
        `${hotelInfo(hotel).name} room group ${number} (${stay}) appears twice: ${earlier.sheet} rows ${earlier.firstRow}-${earlier.lastRow} and ${where}`,
      );
      continue;
    }

    const beds: BedRow[] = [];
    for (const i of seg) {
      const r = rows[i] ?? [];
      const bed = wholeNumber(cell(r, "bed"));
      if (bed !== null && Number.isNaN(bed)) note("bed-unreadable", `${sheet.name} row ${i + 1} (${roomKey})`);
      let registrationId = cellText(cell(r, "userId"));
      if (registrationId && OPEN_BED_TEXT.has(sheetKey(registrationId))) {
        note("placeholder-user-id", `${sheet.name} row ${i + 1} (${roomKey})`);
        registrationId = null;
      }
      const name = cellText(cell(r, "name"));
      if (!registrationId && name !== null && !OPEN_BED_NAMES.has(sheetKey(name))) {
        note("name-without-user-id", `${sheet.name} row ${i + 1} (${roomKey})`);
      }
      beds.push({
        sheet: sheet.name,
        row: i + 1,
        stay,
        roomKey,
        roomNumber: number,
        bed: bed === null || Number.isNaN(bed) ? null : bed,
        registrationId,
      });
    }
    rooms.set(roomKey, {
      roomKey,
      stay,
      hotel,
      roomNumber: number,
      sheet: sheet.name,
      firstRow: first + 1,
      lastRow: last + 1,
      capacity: beds.length,
      beds,
    });
    info.rooms++;
    info.beds += beds.length;
    info.filled += beds.filter((b) => b.registrationId).length;
    info.openBeds += beds.filter((b) => !b.registrationId).length;
  }
}

/**
 * A summary tab's hotel table ("Hotel | eBKY Wed. 4/Room | ... | Family Room |
 * Total") against the hotel tabs: per hotel, the room total and the rooms per
 * size. A hotel's rooms are its distinct room numbers over both stays
 * (Wednesday room N is Thursday room N). Family rooms may be any size: the
 * sizes check out when every "N/Room" count is met and the rooms left over
 * are exactly the family rooms. Null when the tab has no such table.
 */
function crossCheckSummary(
  sheet: RoomingSheet,
  rooms: readonly PlannedRoom[],
  note: (kind: NoteKind, item: string) => void,
): SummaryCrossCheck | null {
  const rows = sheet.rows;
  let headerIdx = -1;
  let hotelCol = -1;
  let totalCol = -1;
  for (let i = 0; i < rows.length && headerIdx < 0; i++) {
    const keys = (rows[i] ?? []).map((v) => sheetKey(cellText(v)));
    const h = keys.indexOf("hotel");
    const t = keys.indexOf("total");
    if (h >= 0 && t > h) [headerIdx, hotelCol, totalCol] = [i, h, t];
  }
  if (headerIdx < 0) return null;
  const header = (rows[headerIdx] ?? []).map((v) => cellText(v) ?? "");
  const sizeCols: { col: number; size: string }[] = [];
  const familyCols: number[] = [];
  header.forEach((h, col) => {
    const m = h.match(/(\d+)\s*\/\s*room/i);
    if (m) sizeCols.push({ col, size: m[1] });
    else if (/family/i.test(h)) familyCols.push(col);
  });
  const count = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : Number(cellText(v)) || 0);

  // Distinct physical room groups per hotel: MAIN's size wins over WED's.
  const physical = new Map<string, Map<number, number>>();
  for (const r of [...rooms].sort((a, b) => STAYS.indexOf(a.stay) - STAYS.indexOf(b.stay))) {
    const byNumber = physical.get(r.hotel) ?? new Map<number, number>();
    byNumber.set(r.roomNumber, r.capacity);
    physical.set(r.hotel, byNumber);
  }

  const hotels: HotelCheck[] = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const name = cellText(r[hotelCol]);
    if (!name) continue; // blank, or the grand-total row
    const hotel = hotelKeyFor(name);
    if (!hotel) {
      note("summary-unknown-hotel", `${sheet.name} row ${i + 1} ("${name}")`);
      continue;
    }
    const summaryBySize: Record<string, number> = {};
    for (const { col, size } of sizeCols) summaryBySize[size] = (summaryBySize[size] ?? 0) + count(r[col]);
    const summaryFamily = familyCols.reduce((n, col) => n + count(r[col]), 0);
    const totalCell = r[totalCol];
    const summaryTotal = cellText(totalCell) === null ? null : count(totalCell);
    const mine = physical.get(hotel) ?? new Map<number, number>();
    const plannedBySize: Record<string, number> = {};
    for (const cap of mine.values()) plannedBySize[String(cap)] = (plannedBySize[String(cap)] ?? 0) + 1;
    let leftOver = 0;
    let sizesOk = true;
    for (const size of new Set([...Object.keys(summaryBySize), ...Object.keys(plannedBySize)])) {
      const diff = (plannedBySize[size] ?? 0) - (summaryBySize[size] ?? 0);
      if (diff < 0) sizesOk = false;
      leftOver += diff;
    }
    const ok = summaryTotal === mine.size && sizesOk && leftOver === summaryFamily;
    hotels.push({ hotel, summaryTotal, summaryBySize, summaryFamily, plannedTotal: mine.size, plannedBySize, ok });
    if (!ok) note("summary-mismatch", `${sheet.name}: ${hotelInfo(hotel).name}`);
  }
  if (hotels.length === 0) return null;
  const plannedTotal = [...physical.values()].reduce((n, m) => n + m.size, 0);
  const summaryTotal = hotels.reduce((n, h) => n + (h.summaryTotal ?? 0), 0);
  const missing = [...physical.keys()].filter((k) => !hotels.some((h) => h.hotel === k));
  for (const k of missing) note("summary-mismatch", `${sheet.name}: ${hotelInfo(k).name} missing from the summary`);
  return { sheet: sheet.name, hotels, summaryTotal, plannedTotal, ok: hotels.every((h) => h.ok) && missing.length === 0 && summaryTotal === plannedTotal };
}

/** Checks the invariants the database relies on. */
function validatePlan(plan: RoomingPlan): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  const perStay = new Set<string>();
  for (const a of plan.assignments) {
    const who = `User Id ${a.registrationId} ${a.stay}`;
    if (ids.has(a.id)) problems.push(`${who}: planned more than once`);
    ids.add(a.id);
    const k = `${a.registrationId}|${a.stay}`;
    if (perStay.has(k)) problems.push(`${who}: two rooms in one stay`);
    perStay.add(k);
    if (!/^\S{1,64}$/.test(a.registrationId)) problems.push(`${who}: User Id must be one word`);
    if (!Number.isInteger(a.roomNumber) || a.roomNumber < 1) problems.push(`${who}: bad room number`);
    if (a.bed !== null && (!Number.isInteger(a.bed) || a.bed < 1)) problems.push(`${who}: bad bed number`);
    if (a.roomCapacity < 1 || a.roomOpenBeds < 0 || a.roomOpenBeds >= a.roomCapacity) problems.push(`${who}: bad room capacity`);
    if (a.roomKey !== roomKeyFor(a.stay, a.hotel, a.roomNumber)) problems.push(`${who}: room key out of step`);
  }
  const roomKeys = new Set<string>();
  for (const room of plan.rooms) {
    if (roomKeys.has(room.roomKey)) problems.push(`${room.roomKey}: planned more than once`);
    roomKeys.add(room.roomKey);
    if (room.roomKey !== roomKeyFor(room.stay, room.hotel, room.roomNumber)) problems.push(`${room.roomKey}: room key out of step`);
    if (room.capacity < 1 || room.openBeds + room.heldBeds + room.registrationIds.length !== room.capacity) {
      problems.push(`${room.roomKey}: beds don't add up (open + held + placed != capacity)`);
    }
    if (room.heldRegistrationIds.length !== room.heldBeds) problems.push(`${room.roomKey}: held User Ids out of step`);
  }
  for (const a of plan.assignments) {
    if (!roomKeys.has(a.roomKey)) problems.push(`User Id ${a.registrationId} ${a.stay}: room group ${a.roomKey} not planned`);
  }
  return problems;
}

// ---------------------------------------------------------------------------
// People on file (users, or the master list offline)

/** A person as the check needs them: users.registration_id and users.gender. */
export type RoomingPersonRef = { registrationId: string | null; gender: "MALE" | "FEMALE" | null };

export type MixedRoom = { roomKey: string; bhaio: number; behno: number; unknown: number };

export type RoomingPeopleCheck = {
  /** Planned User Ids with nobody on file (stored anyway; they link by User Id later). */
  notOnFile: string[];
  /** Planned User Ids on file without a gender (no track). */
  noGender: string[];
  /** Room groups whose people on file include both tracks (fine only for family / couple rooms). */
  mixedRooms: MixedRoom[];
  /** Room groups with someone whose track is unknown (not on file, or no gender): a mix can't be ruled out. */
  roomsWithUnknownTrack: MixedRoom[];
  /** People per stay, hotel and track. */
  byStayHotel: { stay: Stay; hotel: HotelKey; bhaio: number; behno: number; unknown: number; notOnFile: number }[];
};

/** Who of the plan is on file, their tracks per hotel, and the rooms that mix Bhaio and Behno. */
export function checkRoomingPeople(plan: RoomingPlan, people: readonly RoomingPersonRef[]): RoomingPeopleCheck {
  const gender = new Map<string, "MALE" | "FEMALE" | null>();
  for (const p of people) if (p.registrationId) gender.set(p.registrationId, p.gender);
  const notOnFile = plan.people.filter((id) => !gender.has(id));
  const noGender = plan.people.filter((id) => gender.has(id) && gender.get(id) === null);

  const mixedRooms: MixedRoom[] = [];
  const roomsWithUnknownTrack: MixedRoom[] = [];
  for (const room of plan.rooms) {
    const tally = { bhaio: 0, behno: 0, unknown: 0 };
    for (const id of room.registrationIds) {
      const g = gender.get(id);
      if (g === "MALE") tally.bhaio++;
      else if (g === "FEMALE") tally.behno++;
      else tally.unknown++;
    }
    if (tally.bhaio > 0 && tally.behno > 0) mixedRooms.push({ roomKey: room.roomKey, ...tally });
    else if (tally.unknown > 0) roomsWithUnknownTrack.push({ roomKey: room.roomKey, ...tally });
  }

  const byKey = new Map<string, RoomingPeopleCheck["byStayHotel"][number]>();
  for (const a of plan.assignments) {
    const k = `${a.stay}|${a.hotel}`;
    const row = byKey.get(k) ?? { stay: a.stay, hotel: a.hotel, bhaio: 0, behno: 0, unknown: 0, notOnFile: 0 };
    if (!gender.has(a.registrationId)) row.notOnFile++;
    else if (gender.get(a.registrationId) === "MALE") row.bhaio++;
    else if (gender.get(a.registrationId) === "FEMALE") row.behno++;
    else row.unknown++;
    byKey.set(k, row);
  }
  return { notOnFile, noGender, mixedRooms, roomsWithUnknownTrack, byStayHotel: [...byKey.values()] };
}

// ---------------------------------------------------------------------------
// Summary

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Rooms per size, largest first: "4 beds: 23, 2 beds: 3" ("beds") or "4/room 23, 2/room 3" ("/room"). */
function sizeText(bySize: Record<string, number>, unit: "beds" | "/room"): string {
  return Object.entries(bySize)
    .filter(([, n]) => n > 0)
    .sort((a, b) => Number(b[0]) - Number(a[0]))
    .map(([size, n]) => (unit === "beds" ? `${plural(Number(size), "bed")}: ${n}` : `${size}/room ${n}`))
    .join(", ");
}

/**
 * The plan as report lines: counts, sheet names, room keys and User Ids only
 * (no names), so it is safe to print.
 */
export function planSummary(plan: RoomingPlan): string[] {
  const lines: string[] = [];
  lines.push("Sheets:");
  for (const s of plan.sheets) {
    if (s.role === "rooming" && s.headerRow === undefined) {
      lines.push(`  ${s.name}: ${s.stay}, no "Mock Room" header (not read)`);
    } else if (s.role === "rooming") {
      lines.push(
        `  ${s.name}: ${s.stay}, header row ${s.headerRow}, ${s.rooms} room groups, ${s.beds} beds ` +
          `(${s.filled} with a User Id, ${s.openBeds} open), ${s.merges} merged ranges`,
      );
    } else {
      lines.push(`  ${s.name}: ${s.role}${s.note ? ` (${s.note})` : ""}`);
    }
  }
  const byStay = (stay: Stay) => plan.assignments.filter((a) => a.stay === stay).length;
  lines.push(
    `People: ${plan.people.length} User Ids with a room; ${plan.assignments.length} assignments to write ` +
      `(${STAYS.map((s) => `${s} ${byStay(s)}`).join(", ")}); ${plan.conflicts.length} skipped (conflicting rows)`,
  );

  lines.push("Room groups by stay and hotel (rooms by beds per room):");
  for (const stay of STAYS) {
    const rooms = plan.rooms.filter((r) => r.stay === stay);
    if (rooms.length === 0) continue;
    const line = (list: PlannedRoom[]) => {
      const bySize: Record<string, number> = {};
      for (const r of list) bySize[String(r.capacity)] = (bySize[String(r.capacity)] ?? 0) + 1;
      const beds = list.reduce((n, r) => n + r.capacity, 0);
      const open = list.reduce((n, r) => n + r.openBeds, 0);
      const held = list.reduce((n, r) => n + r.heldBeds, 0);
      const people = list.reduce((n, r) => n + r.registrationIds.length, 0);
      return (
        `${plural(list.length, "room")} (${sizeText(bySize, "beds")}), ${plural(beds, "bed")}, ${people} people, ${open} open` +
        (held ? `, ${held} held by skipped User Ids` : "")
      );
    };
    lines.push(`  ${stay} ${STAY_LABELS[stay]}: ${line(rooms)}`);
    for (const hotel of [...new Set(rooms.map((r) => r.hotel))].sort(compareHotels)) {
      lines.push(`    ${hotelInfo(hotel).name}: ${line(rooms.filter((r) => r.hotel === hotel))}`);
    }
  }

  const c = plan.continuity;
  lines.push(
    `Wednesday -> Thursday: ${c.both} people have both; ${c.sameRoom} keep the same room group ` +
      `(${c.sameBed} the same bed); ${c.moved.length} move; ${c.wedOnly.length} Wednesday only`,
  );

  if (plan.conflicts.length > 0) {
    lines.push(`Skipped, User Id on several bed rows in one stay (no assignment written or deleted): ${plan.conflicts.length}`);
    for (const x of plan.conflicts) lines.push(`  User Id ${x.registrationId} (${x.stay}): ${x.places.join(", ")}`);
  } else {
    lines.push("Conflicts: none");
  }

  for (const x of plan.crossChecks) {
    lines.push(`Cross-check "${x.sheet}": ${x.ok ? "matches" : "DIFFERS"} (tabs ${x.plannedTotal} room groups, summary ${x.summaryTotal})`);
    for (const h of x.hotels) {
      const summary = [sizeText(h.summaryBySize, "/room"), h.summaryFamily ? `family ${h.summaryFamily}` : ""].filter(Boolean).join(", ");
      lines.push(
        `  ${hotelInfo(h.hotel).name}: tabs ${h.plannedTotal} (${sizeText(h.plannedBySize, "beds")}); ` +
          `summary ${h.summaryTotal ?? "blank"} (${summary})${h.ok ? "" : "  <- differs"}`,
      );
    }
  }

  if (plan.notes.length > 0) {
    lines.push("Notes (not fixed):");
    for (const n of plan.notes) lines.push(`  ${NOTE_LABELS[n.kind]}: ${n.items.length}: ${idList(n.items, 20)}`);
  }
  lines.push(plan.errors.length > 0 ? `Errors (nothing can be written): ${plan.errors.length}` : "Checks: no errors");
  for (const e of plan.errors) lines.push(`  ${e}`);
  return lines;
}

/** The people check as report lines (User Ids and room keys only). */
export function peopleCheckSummary(check: RoomingPeopleCheck, plan: RoomingPlan, source: string): string[] {
  const lines: string[] = [];
  const onFile = plan.people.length - check.notOnFile.length;
  lines.push(`People on file (${source}): ${onFile} of ${plan.people.length} User Ids with a room`);
  if (check.notOnFile.length > 0) {
    lines.push(`  Not on file (stored anyway; they link by User Id once imported): ${check.notOnFile.length}: User Id ${idList(check.notOnFile)}`);
  }
  if (check.noGender.length > 0) lines.push(`  On file without a track (gender): ${check.noGender.length}: User Id ${idList(check.noGender)}`);
  lines.push("  Tracks by stay and hotel:");
  const rows = [...check.byStayHotel].sort((a, b) => STAYS.indexOf(a.stay) - STAYS.indexOf(b.stay) || compareHotels(a.hotel, b.hotel));
  for (const r of rows) {
    const parts = [`Bhaio ${r.bhaio}`, `Behno ${r.behno}`, r.unknown ? `no track ${r.unknown}` : "", r.notOnFile ? `not on file ${r.notOnFile}` : ""];
    lines.push(`    ${r.stay} ${hotelInfo(r.hotel).name}: ${parts.filter(Boolean).join(", ")}`);
  }
  if (check.mixedRooms.length > 0) {
    lines.push(`Room groups mixing Bhaio and Behno (fine only as a family / couple room; not fixed): ${check.mixedRooms.length}`);
    for (const m of check.mixedRooms) {
      lines.push(`  ${m.roomKey}: Bhaio ${m.bhaio}, Behno ${m.behno}${m.unknown ? `, no track / not on file ${m.unknown}` : ""}`);
    }
  } else {
    lines.push("Room groups mixing Bhaio and Behno: none");
  }
  if (check.roomsWithUnknownTrack.length > 0) {
    const tallies = check.roomsWithUnknownTrack.map(
      (m) => `${m.roomKey} (Bhaio ${m.bhaio}, Behno ${m.behno}, unknown ${m.unknown})`,
    );
    lines.push(`Room groups with a track unknown (not on file / no gender; a mix can't be ruled out): ${tallies.length}: ${idList(tallies, 20)}`);
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Reconciling with the database

/** A room_assignments row as the import reads it. */
export type ExistingAssignment = Omit<PlannedAssignment, "hotel"> & { hotel: string };

export type AssignmentRef = { id: string; registrationId: string; stay: Stay };

export type RoomingReconciliation = {
  creates: PlannedAssignment[];
  updates: { assignment: PlannedAssignment; changes: string[] }[];
  unchanged: number;
  /** Assignments whose person no longer has that stay in the workbook. */
  deletes: AssignmentRef[];
  /** Assignments of people skipped for that stay (conflicting rows): left as they are. */
  keptForConflicts: AssignmentRef[];
  /**
   * Stays and hotels the deletes would empty (rows on file, none planned):
   * --apply refuses these without --allow-deletes.
   */
  emptied: { stay: Stay; hotel: string; rows: number }[];
};

const stayKey = (registrationId: string, stay: Stay) => `${registrationId}|${stay}`;

/**
 * What applying the plan to these rows would do. Assignments match by
 * (registration_id, stay); those of people the plan skipped for a stay are
 * never touched. `users` is never written.
 */
export function reconcileRooming(plan: RoomingPlan, existing: readonly ExistingAssignment[]): RoomingReconciliation {
  const r: RoomingReconciliation = { creates: [], updates: [], unchanged: 0, deletes: [], keptForConflicts: [], emptied: [] };
  const current = new Map(existing.map((a) => [stayKey(a.registrationId, a.stay), a]));
  const planned = new Set(plan.assignments.map((a) => stayKey(a.registrationId, a.stay)));
  const skipped = new Set(plan.conflicts.map((c) => stayKey(c.registrationId, c.stay)));

  for (const a of plan.assignments) {
    const db = current.get(stayKey(a.registrationId, a.stay));
    if (!db) {
      r.creates.push(a);
      continue;
    }
    const changes = ASSIGNMENT_FIELDS.filter((k) => (db[k] ?? null) !== (a[k] ?? null)).map((k) => FIELD_LABELS[k]);
    if (changes.length === 0) r.unchanged++;
    else r.updates.push({ assignment: a, changes });
  }
  for (const a of existing) {
    const k = stayKey(a.registrationId, a.stay);
    if (planned.has(k)) continue;
    const ref = { id: a.id, registrationId: a.registrationId, stay: a.stay };
    if (skipped.has(k)) r.keptForConflicts.push(ref);
    else r.deletes.push(ref);
  }
  const order = (a: AssignmentRef, b: AssignmentRef) => STAYS.indexOf(a.stay) - STAYS.indexOf(b.stay) || byId(a.registrationId, b.registrationId);
  r.deletes.sort(order);
  r.keptForConflicts.sort(order);

  // A whole hotel (or stay) about to go: almost always a tab gone wrong, not everyone leaving.
  const deleted = new Set(r.deletes.map((d) => d.id));
  const plannedHotels = new Set(plan.assignments.map((a) => `${a.stay}|${a.hotel}`));
  const emptied = new Map<string, { stay: Stay; hotel: string; rows: number }>();
  for (const a of existing) {
    const k = `${a.stay}|${a.hotel}`;
    if (plannedHotels.has(k) || !deleted.has(a.id)) continue;
    const row = emptied.get(k) ?? { stay: a.stay, hotel: a.hotel, rows: 0 };
    row.rows++;
    emptied.set(k, row);
  }
  r.emptied = [...emptied.values()].sort(
    (a, b) => STAYS.indexOf(a.stay) - STAYS.indexOf(b.stay) || compareHotels(a.hotel, b.hotel),
  );
  return r;
}

/** A room_groups row as the import reads it. */
export type ExistingRoomGroup = {
  roomKey: string;
  stay: Stay;
  hotel: string;
  roomNumber: number;
  capacity: number;
  openBeds: number;
  heldBeds: number;
  heldRegistrationIds: string[];
  sourceSheet: string;
};

export type RoomGroupReconciliation = {
  creates: PlannedRoom[];
  updates: { room: PlannedRoom; changes: string[] }[];
  unchanged: number;
  /** Room keys no longer in the workbook. */
  deletes: string[];
};

/**
 * What applying the plan's room groups to these room_groups rows would do:
 * matched by room key; every planned room group is kept, whoever is in it.
 */
export function reconcileRoomGroups(plan: RoomingPlan, existing: readonly ExistingRoomGroup[]): RoomGroupReconciliation {
  const r: RoomGroupReconciliation = { creates: [], updates: [], unchanged: 0, deletes: [] };
  const current = new Map(existing.map((g) => [g.roomKey, g]));
  const planned = new Set(plan.rooms.map((room) => room.roomKey));
  const same = (a: unknown, b: unknown) =>
    Array.isArray(a) && Array.isArray(b) ? a.join("|") === b.join("|") : (a ?? null) === (b ?? null);
  for (const room of plan.rooms) {
    const db = current.get(room.roomKey);
    if (!db) {
      r.creates.push(room);
      continue;
    }
    const stored: Record<RoomGroupField, unknown> = {
      hotel: db.hotel,
      roomNumber: db.roomNumber,
      capacity: db.capacity,
      openBeds: db.openBeds,
      heldBeds: db.heldBeds,
      heldRegistrationIds: db.heldRegistrationIds,
      sheet: db.sourceSheet,
    };
    const changes = ROOM_GROUP_FIELDS.filter((k) => !same(stored[k], room[k])).map((k) => ROOM_GROUP_FIELD_LABELS[k]);
    if (changes.length === 0) r.unchanged++;
    else r.updates.push({ room, changes });
  }
  r.deletes = existing
    .filter((g) => !planned.has(g.roomKey))
    .map((g) => g.roomKey)
    .sort(byId);
  return r;
}
