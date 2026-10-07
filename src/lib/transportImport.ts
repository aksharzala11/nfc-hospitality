/**
 * The planning half of the transport import (scripts/import-transport.ts).
 * Turns the organisers' transport workbook ("Transportation Information")
 * into one transport_legs row per person and direction, plus each person's
 * accommodation package, and says what disagrees, what was skipped and what
 * looks odd. reconcileTransport() then compares the plan with the database.
 *
 * Pure: no database, no file access. The script reads the workbook (exceljs)
 * and passes each sheet in as rows of raw cell values plus its merged ranges;
 * nothing from the spreadsheet lives in the repo.
 *
 * The workbook, keyed by "User Id" (= users.registration_id):
 * - Airport tabs, the transport team's working lists. Arrivals: "Arrival PHL
 *   8th Pickup", "Arrival PHL 7 & 9 Pickup", "Arrival EWR 8th Pickup" (no date
 *   column: the day comes from the tab name), "Arrival EWR 7th & 9th Pickup",
 *   "Arrival OTHER" (full row layout, airport in a column). Departures:
 *   "Departures - PHL", "Departures EWR", "Departures - Others" (airport in a
 *   column). The airport is the one in the tab name unless the tab has an
 *   airport column. "PICKUP Group" / "Group #" cells may be merged across
 *   rows: a merged range's value applies to every row it spans.
 * - Full-record tabs ("Transport - With Accom", "Transport - No Accom"): every
 *   person's mode, need pickup / drop-off, airports, dates, times, airlines,
 *   flights, and the accommodation package ("Fee Description").
 * - "Non EWR-PHL Airports": a cross-check copy, compared with the full record
 *   and otherwise ignored. "Sheet1" (an email list) and any other tab are ignored.
 *
 * Rules (the organisers'):
 * - Precedence: for a person on an airport tab, that tab wins for the airport,
 *   date, time, airline and flight (a blank or placeholder cell there falls
 *   back to the full record), and is the only source of the group and driver.
 *   Mode and need pickup / drop-off come from the tab when it has that column
 *   and a value, else from the full record. Everyone else's leg is the full
 *   record. Every field on which a tab and the full record disagree is
 *   reported (User Id + field).
 * - Duplicates: rows of one User Id within one source (the full record, the
 *   arrival tabs, the departure tabs) that carry the same transport details
 *   count once; if they differ, that person's transport is skipped entirely
 *   (no legs written, none deleted, no package) and listed.
 * - Wall-clock date and time are stored as given for that airport ("YYYY-MM-DD",
 *   "HH:MM"), never converted; sortAt reads them as Eastern for sorting.
 * - Airport code from "Philadelphia International Airport - PHL" -> PHL; a bare
 *   code stays ("YYC"). Flights and airlines "TBD" / "Na" / "x" / blank -> null
 *   (a placeholder flight is flagged). Need Pickup / Need Dropoff "Yes" / "No" /
 *   blank -> true / false / null. Mode "Flying" / "Driving" -> "FLYING" /
 *   "DRIVING".
 * - Group identity = direction + airport code + local date + group number.
 *   Driver / Driver Phone # are read when filled (drivers are expected from a
 *   separate spreadsheet later).
 * - Oddities are flagged, never fixed.
 */
import { cellText, idList, type SheetRows } from "./delegateImport";
import { sheetKey } from "./sevaMapping";
import { EVENT_DAYS, parseInEventTz } from "./time";
import { toE164 } from "./users";

// ---------------------------------------------------------------------------
// Types

export type Direction = "ARRIVAL" | "DEPARTURE";
export const DIRECTIONS: readonly Direction[] = ["ARRIVAL", "DEPARTURE"];

/** One worksheet: rows[0] is the header row; `merges` like "K49:K57" (exceljs `ws.model.merges`). */
export type TransportSheet = SheetRows & { merges?: readonly string[] };

/** A transport_legs row as the import writes it. */
export type PlannedLeg = {
  /** "<registrationId>-arrival" / "<registrationId>-departure". */
  id: string;
  registrationId: string;
  direction: Direction;
  mode: string | null;
  needsService: boolean | null;
  airportCode: string | null;
  airportName: string | null;
  /** "YYYY-MM-DD", wall-clock at the airport. */
  localDate: string | null;
  /** "HH:MM" (24 h), wall-clock at the airport. */
  localTime: string | null;
  /** ISO instant of localDate + localTime read as Eastern (EVENT_TZ); midnight when there is no time. */
  sortAt: string | null;
  airline: string | null;
  flight: string | null;
  groupNumber: number | null;
  groupKey: string | null;
  driverName: string | null;
  driverPhone: string | null;
  sourceSheet: string;
};

/** The fields a leg is compared on, with report labels. */
export const LEG_FIELDS = [
  "mode",
  "needsService",
  "airportCode",
  "airportName",
  "localDate",
  "localTime",
  "sortAt",
  "airline",
  "flight",
  "groupNumber",
  "groupKey",
  "driverName",
  "driverPhone",
  "sourceSheet",
] as const satisfies readonly (keyof PlannedLeg)[];
export type LegField = (typeof LEG_FIELDS)[number];

const FIELD_LABELS: Record<LegField | "fee", string> = {
  mode: "mode",
  needsService: "need pickup/drop-off",
  airportCode: "airport",
  airportName: "airport name",
  localDate: "date",
  localTime: "time",
  sortAt: "sort time",
  airline: "airline",
  flight: "flight",
  groupNumber: "group",
  groupKey: "group key",
  driverName: "driver",
  driverPhone: "driver phone",
  sourceSheet: "source sheet",
  fee: "fee description",
};

export type SheetRole = "arrival-tab" | "departure-tab" | "full-record" | "cross-check" | "ignored";

export type SheetInfo = {
  name: string;
  role: SheetRole;
  /** Data rows below the header with a User Id. */
  rows: number;
  /** Distinct User Ids. */
  people: number;
  /** Rows with data but no User Id (1-based). */
  rowsWithoutUserId: number[];
  /** For airport tabs: the airport from the tab name, the day from the tab name. */
  impliedAirport?: string | null;
  impliedDate?: string | null;
  merges?: number;
  /** Why the tab was ignored. */
  note?: string;
};

/** A field on which an airport tab (or the cross-check copy) and the full record disagree. */
export type Disagreement = {
  registrationId: string;
  direction: Direction | null;
  field: string;
  sheet: string;
  row: number;
  /** Normalised values (kept for the --out JSON only; the printed report shows User Id + field). */
  tabValue: string | null;
  fullValue: string | null;
  /** Which one the leg uses. */
  used: "tab" | "full record" | "neither (cross-check only)";
};

/** One person skipped because rows of one source disagree. */
export type TransportConflict = {
  registrationId: string;
  source: "full record" | "arrival tabs" | "departure tabs";
  rows: string[];
  /** Field labels that differ. */
  fields: string[];
};

export type MergedDuplicate = { registrationId: string; source: TransportConflict["source"]; rows: string[] };

/**
 * A flagged oddity: never fixed. The printed report shows User Ids only;
 * `details` (direction, airport, date, sheet and row per User Id) is for the
 * --out JSON.
 */
export type Flag = { kind: FlagKind; registrationIds: string[]; details: Record<string, string[]> };

export type FlagKind =
  | "far-airport"
  | "airport-code-only"
  | "airport-unreadable"
  | "date-outside-event"
  | "departs-before-arrives"
  | "placeholder-flight"
  | "flying-without-flight"
  | "pickup-blank"
  | "dropoff-blank"
  | "needs-pickup-not-on-tab"
  | "needs-dropoff-not-on-tab"
  | "on-tab-not-needed"
  | "on-tab-without-full-record"
  | "time-read-loosely"
  | "unreadable-cell"
  | "unknown-mode"
  | "group-without-airport-or-date"
  | "group-several-drivers"
  | "fee-blank";

export const FLAG_LABELS: Record<FlagKind, string> = {
  "far-airport": "Airport outside the NY / NJ / PA / DC area",
  "airport-code-only": "Airport given as a bare code (no airport name)",
  "airport-unreadable": "Airport text without a recognisable code (name kept, no code)",
  "date-outside-event": "Date outside Oct 7 - Oct 12",
  "departs-before-arrives": "Departure before arrival",
  "placeholder-flight": "Flight is a placeholder (TBD / Na / x): stored as blank",
  "flying-without-flight": "Flying but no flight number",
  "pickup-blank": "Flying in with Need Pickup blank",
  "dropoff-blank": "Flying out with Need Dropoff blank",
  "needs-pickup-not-on-tab": "Full record says Need Pickup Yes, but they are on no arrival tab",
  "needs-dropoff-not-on-tab": "Full record says Need Dropoff Yes, but they are on no departure tab",
  "on-tab-not-needed": "On a pickup/drop-off tab, but the full record says No",
  "on-tab-without-full-record": "On an airport tab but not in the full record",
  "time-read-loosely": "Time text read loosely (e.g. \"AN\" read as AM)",
  "unreadable-cell": "Cell that could not be read (left blank)",
  "unknown-mode": "Mode other than Flying / Driving (kept as given)",
  "group-without-airport-or-date": "Group number but no airport or date (no group key)",
  "group-several-drivers": "Group with more than one driver",
  "fee-blank": "Fee Description blank (accommodation package left as it is)",
};

export type TransportPlan = {
  sheets: SheetInfo[];
  legs: PlannedLeg[];
  /** Accommodation package per person from the full record (blank cells left out). */
  packages: { registrationId: string; accommodationPackage: string }[];
  /** Distinct User Ids anywhere in the transport tabs (airport tabs + full record). */
  people: string[];
  /** Skipped: rows of one source disagree. Their legs and package are left as they are. */
  conflicts: TransportConflict[];
  /** Identical duplicate rows, counted once. */
  mergedDuplicates: MergedDuplicate[];
  disagreements: Disagreement[];
  flags: Flag[];
  /** Invariant failures: the import refuses to write while there are any. */
  errors: string[];
};

// ---------------------------------------------------------------------------
// Cells

const PLACEHOLDERS = new Set(["tbd", "tba", "na", "n/a", "n.a.", "x", "-", "--", "none", "?", "unknown"]);

/** Placeholder cell ("TBD", "Na", "x"), which counts as blank. */
export function isPlaceholder(text: string | null): boolean {
  return text !== null && PLACEHOLDERS.has(sheetKey(text));
}

/** A cell as text, numbers as plain digits ("12345", not "12345.0"). */
function text(value: unknown): string | null {
  if (typeof value === "number" && Number.isInteger(value)) return String(value);
  return cellText(value);
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Excel's day 0 (1899-12-30) in ms: exceljs dates are that epoch + serial days, as UTC. */
const EXCEL_EPOCH = Date.UTC(1899, 11, 30);
const DAY_MS = 86_400_000;

/** A Date rounded to the nearest minute (exceljs time cells come out as 14:34:59.999). */
function roundToMinute(d: Date): Date {
  return new Date(Math.round(d.getTime() / 60_000) * 60_000);
}

type Parsed<T> = { value: T | null; problem?: string; loose?: boolean };

/** "YYYY-MM-DD" from a date cell: a Date (UTC parts), an Excel serial, "MM/DD/YYYY" or "YYYY-MM-DD". */
export function parseDateCell(value: unknown): Parsed<string> {
  if (value === null || value === undefined) return { value: null };
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return { value: null, problem: "invalid date" };
    const d = roundToMinute(value);
    if (d.getUTCFullYear() < 1901) return { value: null, problem: "a time, not a date" };
    return { value: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` };
  }
  if (typeof value === "number") {
    if (value < 367) return { value: null, problem: "a number, not a date" };
    return parseDateCell(new Date(EXCEL_EPOCH + Math.floor(value) * DAY_MS));
  }
  const s = text(value);
  if (!s) return { value: null };
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (m) {
    const [month, day, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const year = y < 100 ? 2000 + y : y;
    if (isRealDate(year, month, day)) return { value: `${year}-${pad(month)}-${pad(day)}` };
    return { value: null, problem: "invalid date" };
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/);
  if (m) {
    if (isRealDate(Number(m[1]), Number(m[2]), Number(m[3]))) return { value: `${m[1]}-${m[2]}-${m[3]}` };
    return { value: null, problem: "invalid date" };
  }
  return { value: null, problem: "unreadable date" };
}

/** True for a calendar date that exists (no "Oct 32", "Sep 31" or month 13). */
function isRealDate(year: number, month: number, day: number): boolean {
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

/**
 * "HH:MM" (24 h) from a time cell: a Date (exceljs time-only cells are
 * 1899-12-30 plus the time, as UTC), a fraction of a day, "HH:MM[:SS]" (24 h)
 * or "h:mm AM/PM". A suffix that is only nearly AM / PM ("AN") is read by its
 * first letter and marked loose.
 */
export function parseTimeCell(value: unknown): Parsed<string> {
  if (value === null || value === undefined) return { value: null };
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return { value: null, problem: "invalid time" };
    const d = roundToMinute(value);
    return { value: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}` };
  }
  if (typeof value === "number") {
    const minutes = Math.round((((value % 1) + 1) % 1) * 1440) % 1440;
    return { value: `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}` };
  }
  const s = text(value);
  if (!s) return { value: null };
  const m = s.match(/^(\d{1,2})(?::|\.)(\d{2})(?::(\d{2}))?\s*(?:([ap])\.?\s*([a-z])?\.?)?$/i);
  if (!m) return { value: null, problem: "unreadable time" };
  let hour = Number(m[1]);
  const minute = Number(m[2]);
  const half = m[4]?.toLowerCase();
  const loose = half !== undefined && (m[5] ?? "m").toLowerCase() !== "m";
  if (minute > 59) return { value: null, problem: "unreadable time" };
  if (half) {
    if (hour < 1 || hour > 12) return { value: null, problem: "unreadable time" };
    hour = (hour % 12) + (half === "p" ? 12 : 0);
  } else if (hour > 23) {
    return { value: null, problem: "unreadable time" };
  }
  return { value: `${pad(hour)}:${pad(minute)}`, ...(loose ? { loose } : {}) };
}

/** "Yes" / "No" / blank -> true / false / null. */
export function parseYesNo(value: unknown): Parsed<boolean> {
  const s = text(value);
  if (!s) return { value: null };
  const k = sheetKey(s);
  if (k === "yes" || k === "y" || k === "true") return { value: true };
  if (k === "no" || k === "n" || k === "false") return { value: false };
  return { value: null, problem: "not Yes / No" };
}

/** "Flying" / "Driving" -> "FLYING" / "DRIVING"; anything else as given (flagged). */
export function parseMode(value: unknown): Parsed<string> {
  const s = text(value);
  if (!s) return { value: null };
  const k = sheetKey(s);
  if (k === "flying" || k === "fly" || k === "flight") return { value: "FLYING" };
  if (k === "driving" || k === "drive") return { value: "DRIVING" };
  return { value: s, problem: "unknown mode" };
}

export type Airport = { code: string | null; name: string | null };

/** Well-known names for airports that tabs give by code only. */
const AIRPORT_NAMES: Record<string, string> = {
  PHL: "Philadelphia International Airport",
  EWR: "Newark Liberty International Airport",
  JFK: "John F. Kennedy International Airport",
  LGA: "LaGuardia Airport",
  TTN: "Trenton Mercer Airport",
};

/** Airports a pickup / drop-off can reasonably serve from Edison, NJ; others are flagged. */
const AREA_AIRPORTS: ReadonlySet<string> = new Set([
  "PHL", "EWR", "JFK", "LGA", "TTN", "ABE", "HPN", "ISP", "SWF", "ACY", "BWI", "DCA", "IAD",
]);

/**
 * "Philadelphia International Airport - PHL" -> { PHL, "Philadelphia
 * International Airport" }; "YYC" -> { YYC, null }. Non-breaking spaces and
 * runs of spaces collapse. Text without a code keeps the name, code null.
 */
export function parseAirport(value: unknown): Parsed<Airport> & { codeOnly?: boolean } {
  const s = text(value);
  if (!s) return { value: null };
  if (/^[A-Za-z]{3}$/.test(s)) return { value: { code: s.toUpperCase(), name: null }, codeOnly: true };
  const m = s.match(/^(.*?)\s*[-–(]\s*([A-Z]{3})\s*\)?$/);
  if (m) return { value: { code: m[2], name: m[1].trim() || null } };
  return { value: { code: null, name: s }, problem: "airport without a code" };
}

/** Flight or airline text; placeholders ("TBD", "Na", "x") -> null, marked. */
function parseFree(value: unknown): Parsed<string> & { placeholder?: boolean } {
  const s = text(value);
  if (!s) return { value: null };
  if (isPlaceholder(s)) return { value: null, placeholder: true };
  return { value: s };
}

/** "3", 3, "Group 3", "#3" -> 3. */
export function parseGroup(value: unknown): Parsed<number> {
  if (typeof value === "number") {
    return Number.isInteger(value) && value > 0 ? { value } : { value: null, problem: "unreadable group" };
  }
  const s = text(value);
  if (!s) return { value: null };
  const m = s.match(/^(?:group\s*)?#?\s*(\d+)$/i);
  return m ? { value: Number(m[1]) } : { value: null, problem: "unreadable group" };
}

/** Comparison key for flights: upper case, spaces / "#" / "-" dropped ("aa 1234" == "AA1234"). */
const flightKey = (s: string | null) => (s === null ? null : s.toUpperCase().replace(/[\s#-]/g, ""));

// ---------------------------------------------------------------------------
// Sheets

const COLUMNS = {
  userId: ["User Id", "UserId", "User ID"],
  fee: ["Fee Description"],
  arrivalMode: ["Arrival Mode"],
  needPickup: ["Need Pickup", "Needs Pickup"],
  arrivalAirport: ["Arrival Airport"],
  arrivalDate: ["Arrival Date"],
  arrivalTime: ["Arrival Time"],
  arrivalAirline: ["Arrival Airline"],
  arrivalFlight: ["Arrival Flight #", "Arrival Flight"],
  departureMode: ["Departure Mode"],
  needDropoff: ["Need Dropoff", "Need Drop-off", "Need Drop Off", "Needs Dropoff"],
  departureAirport: ["Departure Airport"],
  departureDate: ["Departure Date"],
  departureTime: ["Departure Time"],
  departureAirline: ["Departure Airline"],
  departureFlight: ["Departure Flight #", "Departure Flight"],
  pickupGroup: ["PICKUP Group", "Pickup Group"],
  groupNo: ["Group #", "Group No", "Group"],
  driver: ["Driver", "Driver Name"],
  driverPhone: ["Driver Phone #", "Driver Phone"],
} as const;
type ColumnKey = keyof typeof COLUMNS;

const DIRECTION_COLUMNS: Record<
  Direction,
  { mode: ColumnKey; need: ColumnKey; airport: ColumnKey; date: ColumnKey; time: ColumnKey; airline: ColumnKey; flight: ColumnKey }
> = {
  ARRIVAL: {
    mode: "arrivalMode",
    need: "needPickup",
    airport: "arrivalAirport",
    date: "arrivalDate",
    time: "arrivalTime",
    airline: "arrivalAirline",
    flight: "arrivalFlight",
  },
  DEPARTURE: {
    mode: "departureMode",
    need: "needDropoff",
    airport: "departureAirport",
    date: "departureDate",
    time: "departureTime",
    airline: "departureAirline",
    flight: "departureFlight",
  },
};

function columnIndexes(sheet: TransportSheet): Partial<Record<ColumnKey, number>> {
  const header = (sheet.rows[0] ?? []).map((v) => sheetKey(cellText(v)));
  const cols: Partial<Record<ColumnKey, number>> = {};
  for (const key of Object.keys(COLUMNS) as ColumnKey[]) {
    const idx = header.findIndex((h) => h !== "" && COLUMNS[key].some((name) => sheetKey(name) === h));
    if (idx >= 0) cols[key] = idx;
  }
  return cols;
}

/** How a tab is used, from its name. */
export function sheetRole(name: string): SheetRole {
  const k = sheetKey(name);
  if (k.startsWith("arrival")) return "arrival-tab";
  if (k.startsWith("departure")) return "departure-tab";
  if (k.startsWith("transport")) return "full-record";
  if (k.includes("non ewr-phl") || k.includes("non ewr phl")) return "cross-check";
  return "ignored";
}

/** The airport a tab's name names ("Arrival PHL 8th Pickup" -> PHL), or null ("Arrival OTHER"). */
export function impliedAirport(name: string): string | null {
  const m = name.toUpperCase().match(/\b(PHL|EWR|JFK|LGA|TTN)\b/);
  return m ? m[1] : null;
}

/** The single event day a tab's name names ("... 8th Pickup" -> "2026-10-08"); null for "7 & 9" or none. */
export function impliedDate(name: string): string | null {
  const days = [...name.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)?\b/gi)].map((m) => Number(m[1]));
  if (days.length !== 1 || days[0] < 1 || days[0] > 31) return null;
  return `${EVENT_DAYS[0].slice(0, 8)}${pad(days[0])}`;
}

/** Column letters to a 0-based index ("A" -> 0, "K" -> 10, "AA" -> 26). */
function columnIndex(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** The rows with every merged range's top-left value copied into its other cells. */
function fillMerges(sheet: TransportSheet): unknown[][] {
  const rows = sheet.rows.map((r) => [...r]);
  for (const range of sheet.merges ?? []) {
    const m = range.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/i);
    if (!m) continue;
    const [c0, r0, c1, r1] = [columnIndex(m[1]), Number(m[2]) - 1, columnIndex(m[3]), Number(m[4]) - 1];
    const master = rows[r0]?.[c0];
    for (let r = r0; r <= r1; r++) {
      rows[r] ??= [];
      for (let c = c0; c <= c1; c++) if (rows[r][c] === null || rows[r][c] === undefined) rows[r][c] = master;
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Reading rows

/**
 * What one row says about one direction. `undefined` = the sheet has no such
 * column (so it neither overrides nor disagrees); null = the cell is blank.
 */
type LegInput = {
  mode?: string | null;
  needsService?: boolean | null;
  /** From the tab name when the tab has no airport column. */
  airport?: Airport | null;
  localDate?: string | null;
  localTime?: string | null;
  airline?: string | null;
  flight?: string | null;
  groupNumber?: number | null;
  driverName?: string | null;
  driverPhone?: string | null;
  /** The tab implies a pickup (an arrival "Pickup" tab without a Need Pickup column). */
  impliedNeed?: boolean;
  /** The flight cell held a placeholder ("TBD", "Na", "x"), read as blank. */
  flightPlaceholder?: boolean;
  /** The airport cell was a bare code ("YYC"). */
  codeOnlyAirport?: boolean;
};

type SourceRow = {
  sheet: string;
  row: number;
  role: SheetRole;
  registrationId: string;
  fee?: string | null;
  /** The direction this row is authoritative for (tabs), or both (full record). */
  primary: Direction[];
  legs: Partial<Record<Direction, LegInput>>;
};

type Note = { kind: FlagKind; registrationId: string; detail: string };

function readSheet(sheet: TransportSheet, role: SheetRole, notes: Note[]): { info: SheetInfo; rows: SourceRow[] } {
  const cols = columnIndexes(sheet);
  const info: SheetInfo = { name: sheet.name, role, rows: 0, people: 0, rowsWithoutUserId: [] };
  if (role === "ignored") return { info: { ...info, note: "not a transport tab" }, rows: [] };
  if (cols.userId === undefined) return { info: { ...info, role: "ignored", note: 'no "User Id" column' }, rows: [] };

  const airportFromName = role === "arrival-tab" || role === "departure-tab" ? impliedAirport(sheet.name) : null;
  const dateFromName = role === "arrival-tab" || role === "departure-tab" ? impliedDate(sheet.name) : null;
  if (role === "arrival-tab" || role === "departure-tab") {
    info.impliedAirport = airportFromName;
    info.impliedDate = dateFromName;
    info.merges = sheet.merges?.length ?? 0;
  }

  const rows = fillMerges(sheet);
  const out: SourceRow[] = [];
  const ids = new Set<string>();
  rows.slice(1).forEach((r, i) => {
    const rowNo = i + 2;
    const cell = (key: ColumnKey) => (cols[key] === undefined ? undefined : r[cols[key]!]);
    const registrationId = text(cell("userId"));
    if (!registrationId) {
      if (r.some((v) => text(v))) info.rowsWithoutUserId.push(rowNo);
      return;
    }
    const where = `${sheet.name} row ${rowNo}`;
    const note = (kind: FlagKind, detail: string) => notes.push({ kind, registrationId, detail: `${detail} (${where})` });

    const directions: Direction[] =
      role === "arrival-tab" || role === "departure-tab"
        ? DIRECTIONS.filter((d) => cols[DIRECTION_COLUMNS[d].time] !== undefined || cols[DIRECTION_COLUMNS[d].flight] !== undefined)
        : [...DIRECTIONS];
    const primary: Direction[] =
      role === "arrival-tab" ? ["ARRIVAL"] : role === "departure-tab" ? ["DEPARTURE"] : role === "full-record" ? [...DIRECTIONS] : [];

    const legs: Partial<Record<Direction, LegInput>> = {};
    for (const d of directions) {
      const c = DIRECTION_COLUMNS[d];
      const isTabLeg = primary.includes(d) && role !== "full-record";
      const leg: LegInput = {};
      const has = (key: ColumnKey) => cols[key] !== undefined;

      if (has(c.mode)) {
        const p = parseMode(cell(c.mode));
        leg.mode = p.value;
        if (p.problem) note("unknown-mode", `${d.toLowerCase()} mode`);
      }
      if (has(c.need)) {
        const p = parseYesNo(cell(c.need));
        leg.needsService = p.value;
        if (p.problem) note("unreadable-cell", `${d.toLowerCase()} need pickup/drop-off`);
      } else if (isTabLeg && d === "ARRIVAL" && sheetKey(sheet.name).includes("pickup")) {
        leg.impliedNeed = true;
      }
      if (has(c.airport)) {
        const p = parseAirport(cell(c.airport));
        leg.airport = p.value;
        if (p.problem) note("airport-unreadable", `${d.toLowerCase()} airport`);
        if (p.codeOnly) leg.codeOnlyAirport = true;
      } else if (isTabLeg && airportFromName) {
        leg.airport = { code: airportFromName, name: AIRPORT_NAMES[airportFromName] ?? null };
      }
      if (has(c.date)) {
        const p = parseDateCell(cell(c.date));
        leg.localDate = p.value;
        if (p.problem) note("unreadable-cell", `${d.toLowerCase()} date: ${p.problem}`);
      } else if (isTabLeg && dateFromName) {
        leg.localDate = dateFromName;
      }
      if (has(c.time)) {
        const p = parseTimeCell(cell(c.time));
        leg.localTime = p.value;
        if (p.problem) note("unreadable-cell", `${d.toLowerCase()} time: ${p.problem}`);
        if (p.loose) note("time-read-loosely", `${d.toLowerCase()} time`);
      }
      if (has(c.airline)) leg.airline = parseFree(cell(c.airline)).value;
      if (has(c.flight)) {
        const p = parseFree(cell(c.flight));
        leg.flight = p.value;
        if (p.placeholder) leg.flightPlaceholder = true;
      }
      if (isTabLeg) {
        const groupCol: ColumnKey = has("pickupGroup") ? "pickupGroup" : "groupNo";
        if (has(groupCol)) {
          const p = parseGroup(cell(groupCol));
          leg.groupNumber = p.value;
          if (p.problem) note("unreadable-cell", "group");
        }
        if (has("driver")) leg.driverName = text(cell("driver"));
        if (has("driverPhone")) {
          const raw = text(cell("driverPhone"));
          leg.driverPhone = toE164(raw);
          if (raw && !leg.driverPhone) note("unreadable-cell", "driver phone");
        }
      }
      legs[d] = leg;
    }
    out.push({
      sheet: sheet.name,
      row: rowNo,
      role,
      registrationId,
      ...(cols.fee !== undefined ? { fee: text(cell("fee")) } : {}),
      primary,
      legs,
    });
    ids.add(registrationId);
  });
  info.rows = out.length;
  info.people = ids.size;
  return { info, rows: out };
}

// ---------------------------------------------------------------------------
// Planning

/** The comparable values of a leg input, as strings (null = blank or no column). */
function comparable(leg: LegInput | undefined): Record<string, string | null> {
  const s = (v: unknown) => (v === undefined || v === null ? null : String(v));
  return {
    mode: s(leg?.mode),
    needsService: s(leg?.needsService),
    airportCode: leg?.airport?.code ?? null,
    localDate: s(leg?.localDate),
    localTime: s(leg?.localTime),
    airline: leg?.airline ? sheetKey(leg.airline) : null,
    flight: flightKey(leg?.flight ?? null),
    groupNumber: s(leg?.groupNumber),
    driverName: leg?.driverName ? sheetKey(leg.driverName) : null,
    driverPhone: s(leg?.driverPhone),
  };
}

/** Field labels on which two rows' transport details differ (only `directions`, plus fee when asked). */
function differingFields(a: SourceRow, b: SourceRow, directions: readonly Direction[], withFee: boolean): string[] {
  const out: string[] = [];
  if (withFee && sheetKey(a.fee ?? "") !== sheetKey(b.fee ?? "")) out.push(FIELD_LABELS.fee);
  for (const d of directions) {
    const ca = comparable(a.legs[d]);
    const cb = comparable(b.legs[d]);
    for (const k of Object.keys(ca)) {
      if (ca[k] !== cb[k]) out.push(`${d.toLowerCase()} ${FIELD_LABELS[k as LegField]}`);
    }
  }
  return out;
}

/**
 * One row per person from a source: identical duplicates merge, differing
 * ones make a conflict (null row).
 */
function dedupe(
  rows: SourceRow[],
  source: TransportConflict["source"],
  directions: readonly Direction[],
  withFee: boolean,
  conflicts: TransportConflict[],
  merged: MergedDuplicate[],
): Map<string, SourceRow | null> {
  const byId = new Map<string, SourceRow[]>();
  for (const r of rows) byId.set(r.registrationId, [...(byId.get(r.registrationId) ?? []), r]);
  const out = new Map<string, SourceRow | null>();
  for (const [id, list] of byId) {
    if (list.length === 1) {
      out.set(id, list[0]);
      continue;
    }
    const where = list.map((r) => `${r.sheet} row ${r.row}`);
    const fields = [...new Set(list.slice(1).flatMap((r) => differingFields(list[0], r, directions, withFee)))];
    if (fields.length === 0) {
      merged.push({ registrationId: id, source, rows: where });
      out.set(id, list[0]);
    } else {
      conflicts.push({ registrationId: id, source, rows: where, fields });
      out.set(id, null);
    }
  }
  return out;
}

/** Dates outside this window are flagged (the event days, one either side). */
const EVENT_WINDOW = { from: "2026-10-07", to: "2026-10-12" };

/** The tab's value when it has one, else the full record's. */
function pick<T>(tabValue: T | null | undefined, fullValue: T | null | undefined): T | null {
  return tabValue !== undefined && tabValue !== null ? tabValue : (fullValue ?? null);
}

/** "arrival-PHL-2026-10-08-3", or null without an airport, date or number. */
export function groupKeyFor(direction: Direction, airportCode: string | null, localDate: string | null, n: number | null): string | null {
  if (n === null || !airportCode || !localDate) return null;
  return `${direction.toLowerCase()}-${airportCode}-${localDate}-${n}`;
}

/** localDate + localTime read as EVENT_TZ wall-clock (midnight without a time), as ISO. */
export function sortAtFor(localDate: string | null, localTime: string | null): string | null {
  if (!localDate) return null;
  const at = parseInEventTz(`${localDate}T${localTime ?? "00:00"}`);
  return at && !Number.isNaN(at.getTime()) ? at.toISOString() : null;
}

/**
 * The import plan for the transport workbook's sheets (every worksheet, in
 * workbook order). Throws when no full-record tab is found.
 */
export function planTransport(sheets: readonly TransportSheet[]): TransportPlan {
  const notes: Note[] = [];
  const infos: SheetInfo[] = [];
  const all: SourceRow[] = [];
  for (const sheet of sheets) {
    const { info, rows } = readSheet(sheet, sheetRole(sheet.name), notes);
    infos.push(info);
    all.push(...rows);
  }
  if (!infos.some((s) => s.role === "full-record" && s.rows > 0)) {
    throw new Error(
      `No full-record tab ("Transport - With Accom" / "Transport - No Accom") with a "User Id" column ` +
        `(sheets: ${sheets.map((s) => s.name).join(", ")})`,
    );
  }

  const conflicts: TransportConflict[] = [];
  const mergedDuplicates: MergedDuplicate[] = [];
  const full = dedupe(all.filter((r) => r.role === "full-record"), "full record", DIRECTIONS, true, conflicts, mergedDuplicates);
  const tabs: Record<Direction, Map<string, SourceRow | null>> = {
    ARRIVAL: dedupe(all.filter((r) => r.role === "arrival-tab"), "arrival tabs", ["ARRIVAL"], false, conflicts, mergedDuplicates),
    DEPARTURE: dedupe(all.filter((r) => r.role === "departure-tab"), "departure tabs", ["DEPARTURE"], false, conflicts, mergedDuplicates),
  };
  const skipped = new Set(conflicts.map((c) => c.registrationId));

  const people = [...new Set(all.filter((r) => r.role !== "cross-check").map((r) => r.registrationId))];
  const flags = new Map<FlagKind, Map<string, string[]>>();
  const flag = (kind: FlagKind, id: string, detail?: string) => {
    const byId = flags.get(kind) ?? new Map<string, string[]>();
    const list = byId.get(id) ?? [];
    if (detail && !list.includes(detail)) list.push(detail);
    byId.set(id, list);
    flags.set(kind, byId);
  };
  for (const n of notes) if (!skipped.has(n.registrationId)) flag(n.kind, n.registrationId, n.detail);

  const disagreements: Disagreement[] = [];
  const legs: PlannedLeg[] = [];
  const packages: TransportPlan["packages"] = [];

  for (const id of people) {
    if (skipped.has(id)) continue;
    const fr = full.get(id) ?? null;
    if (fr) {
      if (fr.fee) packages.push({ registrationId: id, accommodationPackage: fr.fee });
      else flag("fee-blank", id);
    }
    const legsOfPerson: Partial<Record<Direction, PlannedLeg>> = {};
    for (const d of DIRECTIONS) {
      const tab = tabs[d].get(id) ?? null;
      const f = fr?.legs[d];
      if (tab && !fr) flag("on-tab-without-full-record", id, tab.sheet);
      if (tab && fr) compareRows(tab, fr, disagreements, true);
      const t = tab?.legs[d];
      const tabAirport = t?.airport !== undefined && t.airport !== null;
      const airport = tabAirport ? t!.airport! : (f?.airport ?? null);
      const leg: Omit<PlannedLeg, "sortAt" | "groupKey"> = {
        id: `${id}-${d.toLowerCase()}`,
        registrationId: id,
        direction: d,
        mode: pick(t?.mode, f?.mode),
        needsService: pick(t?.needsService, f?.needsService),
        airportCode: airport?.code ?? null,
        airportName: airport?.name ?? (airport?.code ? (AIRPORT_NAMES[airport.code] ?? null) : null),
        localDate: pick(t?.localDate, f?.localDate),
        localTime: pick(t?.localTime, f?.localTime),
        airline: pick(t?.airline, f?.airline),
        flight: pick(t?.flight, f?.flight),
        groupNumber: t?.groupNumber ?? null,
        driverName: t?.driverName ?? null,
        driverPhone: t?.driverPhone ?? null,
        sourceSheet: tab?.sheet ?? fr?.sheet ?? "",
      };
      const hasData = [leg.mode, leg.needsService, leg.airportCode, leg.airportName, leg.localDate, leg.localTime, leg.airline, leg.flight].some(
        (v) => v !== null,
      );
      if (!tab && !hasData) continue;
      const planned: PlannedLeg = {
        ...leg,
        sortAt: sortAtFor(leg.localDate, leg.localTime),
        groupKey: groupKeyFor(d, leg.airportCode, leg.localDate, leg.groupNumber),
      };
      legs.push(planned);
      legsOfPerson[d] = planned;

      // Oddities of the leg as stored.
      const dir = d.toLowerCase();
      const flying = planned.mode === "FLYING" || (planned.mode === null && planned.airportCode !== null);
      if (planned.airportCode && !AREA_AIRPORTS.has(planned.airportCode)) flag("far-airport", id, `${dir} ${planned.airportCode}`);
      if (tabAirport ? t?.codeOnlyAirport : f?.codeOnlyAirport) flag("airport-code-only", id, `${dir} ${planned.airportCode}`);
      if (planned.localDate && (planned.localDate < EVENT_WINDOW.from || planned.localDate > EVENT_WINDOW.to)) {
        flag("date-outside-event", id, `${dir} ${planned.localDate}`);
      }
      const placeholder = Boolean(t?.flightPlaceholder || f?.flightPlaceholder);
      if (planned.flight === null && placeholder) flag("placeholder-flight", id, dir);
      if (flying && planned.flight === null && !placeholder) flag("flying-without-flight", id, dir);
      if (flying && planned.needsService === null) flag(d === "ARRIVAL" ? "pickup-blank" : "dropoff-blank", id);
      if (planned.groupNumber !== null && planned.groupKey === null) flag("group-without-airport-or-date", id, dir);
      if (f?.needsService === true && !tab) {
        flag(d === "ARRIVAL" ? "needs-pickup-not-on-tab" : "needs-dropoff-not-on-tab", id, `${planned.airportCode ?? "no airport"} ${planned.localDate ?? "no date"}`);
      }
      if (tab && t && (t.needsService === false || (t.needsService == null && f?.needsService === false))) {
        flag("on-tab-not-needed", id, `${dir} (${tab.sheet})`);
      }
    }
    const a = legsOfPerson.ARRIVAL;
    const dep = legsOfPerson.DEPARTURE;
    if (a?.sortAt && dep?.sortAt && dep.sortAt < a.sortAt) flag("departs-before-arrives", id);
  }

  // The cross-check copy: compared with the full record only.
  for (const r of all.filter((x) => x.role === "cross-check")) {
    const fr = full.get(r.registrationId);
    if (fr) compareRows(r, fr, disagreements, false);
    else if (!skipped.has(r.registrationId)) flag("on-tab-without-full-record", r.registrationId, r.sheet);
  }

  // Groups with more than one driver.
  const drivers = new Map<string, Set<string>>();
  for (const l of legs) {
    if (!l.groupKey || (!l.driverName && !l.driverPhone)) continue;
    const set = drivers.get(l.groupKey) ?? new Set<string>();
    set.add(`${sheetKey(l.driverName ?? "")}|${l.driverPhone ?? ""}`);
    drivers.set(l.groupKey, set);
  }
  for (const [key, set] of drivers) {
    if (set.size < 2) continue;
    for (const l of legs.filter((x) => x.groupKey === key)) flag("group-several-drivers", l.registrationId, key);
  }

  legs.sort(
    (a, b) =>
      (a.direction < b.direction ? -1 : a.direction > b.direction ? 1 : 0) ||
      (a.sortAt ?? "~").localeCompare(b.sortAt ?? "~") ||
      a.registrationId.localeCompare(b.registrationId, "en", { numeric: true }),
  );

  const flagList: Flag[] = (Object.keys(FLAG_LABELS) as FlagKind[])
    .filter((k) => flags.has(k))
    .map((kind) => {
      const byId = flags.get(kind)!;
      const ids = [...byId.keys()].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
      return { kind, registrationIds: ids, details: Object.fromEntries(ids.map((i) => [i, byId.get(i)!])) };
    });

  const plan: TransportPlan = {
    sheets: infos,
    legs,
    packages,
    people: people.sort((a, b) => a.localeCompare(b, "en", { numeric: true })),
    conflicts,
    mergedDuplicates,
    disagreements,
    flags: flagList,
    errors: [],
  };
  plan.errors = validatePlan(plan);
  return plan;
}

/**
 * Every field on which a tab row (or the cross-check copy) and the person's
 * full-record row disagree, for each direction the tab has columns for
 * (plus the fee when the tab has that column). Only fields both sides carry
 * are compared; an arrival "Pickup" tab counts as saying "Need Pickup: Yes".
 */
function compareRows(tab: SourceRow, fr: SourceRow, out: Disagreement[], contributes: boolean) {
  const push = (direction: Direction | null, field: string, tv: string | null, fv: string | null, used: Disagreement["used"]) =>
    out.push({ registrationId: tab.registrationId, direction, field, sheet: tab.sheet, row: tab.row, tabValue: tv, fullValue: fv, used });
  if (tab.fee !== undefined && sheetKey(tab.fee ?? "") !== sheetKey(fr.fee ?? "")) {
    push(null, FIELD_LABELS.fee, tab.fee ?? null, fr.fee ?? null, contributes ? "full record" : "neither (cross-check only)");
  }
  for (const d of DIRECTIONS) {
    const t = tab.legs[d];
    const f = fr.legs[d];
    if (!t) continue;
    const authoritative = contributes && tab.primary.includes(d);
    const usedFor = (tv: unknown): Disagreement["used"] =>
      !authoritative ? "neither (cross-check only)" : tv !== null && tv !== undefined ? "tab" : "full record";
    const pairs: [string, unknown, unknown, string | null, string | null][] = [
      ["mode", t.mode, f?.mode, t.mode ?? null, f?.mode ?? null],
      ["needsService", t.needsService, f?.needsService, str(t.needsService), str(f?.needsService)],
      ["airportCode", t.airport === undefined ? undefined : (t.airport?.code ?? null), f?.airport?.code, t.airport?.code ?? null, f?.airport?.code ?? null],
      ["localDate", t.localDate, f?.localDate, t.localDate ?? null, f?.localDate ?? null],
      ["localTime", t.localTime, f?.localTime, t.localTime ?? null, f?.localTime ?? null],
      ["airline", t.airline === undefined ? undefined : t.airline ? sheetKey(t.airline) : null, f?.airline ? sheetKey(f.airline) : null, t.airline ?? null, f?.airline ?? null],
      ["flight", t.flight === undefined ? undefined : flightKey(t.flight), flightKey(f?.flight ?? null), t.flight ?? null, f?.flight ?? null],
    ];
    for (const [field, tv, fv, tShow, fShow] of pairs) {
      if (tv === undefined) continue; // the tab has no such column
      if ((tv ?? null) === (fv ?? null)) continue;
      // Mode / need pickup: the tab only overrides with a value.
      push(d, `${d.toLowerCase()} ${FIELD_LABELS[field as LegField]}`, tShow, fShow, usedFor(tv));
    }
    if (t.impliedNeed && f?.needsService !== true) {
      push(d, `${d.toLowerCase()} ${FIELD_LABELS.needsService} (on a pickup tab)`, "true", str(f?.needsService), contributes ? "full record" : "neither (cross-check only)");
    }
  }
}

const str = (v: boolean | null | undefined) => (v === undefined || v === null ? null : String(v));

/** Checks the invariants the database relies on. */
function validatePlan(plan: TransportPlan): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const l of plan.legs) {
    const who = `User Id ${l.registrationId} ${l.direction.toLowerCase()}`;
    if (seen.has(l.id)) problems.push(`${who}: planned more than once`);
    seen.add(l.id);
    if (!/^\S{1,64}$/.test(l.registrationId)) problems.push(`${who}: User Id must be one word`);
    if (l.localDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(l.localDate)) problems.push(`${who}: date is not YYYY-MM-DD`);
    if (l.localTime !== null && !/^([01]\d|2[0-3]):[0-5]\d$/.test(l.localTime)) problems.push(`${who}: time is not HH:MM`);
    if (l.localDate !== null && l.sortAt === null) problems.push(`${who}: date without a sort time`);
    if (l.driverPhone !== null && !/^\+\d{8,15}$/.test(l.driverPhone)) problems.push(`${who}: driver phone is not E.164`);
    if (l.groupNumber !== null && (!Number.isInteger(l.groupNumber) || l.groupNumber < 1)) problems.push(`${who}: bad group number`);
  }
  const packaged = new Set<string>();
  for (const p of plan.packages) {
    if (packaged.has(p.registrationId)) problems.push(`User Id ${p.registrationId}: two accommodation packages`);
    packaged.add(p.registrationId);
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Summary

const DIRECTION_LABEL: Record<Direction, string> = { ARRIVAL: "Arrivals", DEPARTURE: "Departures" };
const byId = (a: string, b: string) => a.localeCompare(b, "en", { numeric: true });

function fmtCounts(rec: Record<string, number>): string {
  return Object.entries(rec)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([k, n]) => `${k} ${n}`)
    .join(", ");
}

function countBy<T>(items: readonly T[], key: (t: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) out[key(item)] = (out[key(item)] ?? 0) + 1;
  return out;
}

/**
 * The plan as report lines: counts, sheet names, field names and User Ids
 * only (no names, phones, flights or times), so it is safe to print.
 */
export function planSummary(plan: TransportPlan): string[] {
  const lines: string[] = [];
  lines.push("Sheets:");
  for (const s of plan.sheets) {
    const extra = [
      s.impliedAirport !== undefined ? `airport ${s.impliedAirport ?? "from its column"}` : null,
      s.impliedDate ? `day ${s.impliedDate} from the tab name` : null,
      s.merges ? `${s.merges} merged ranges` : null,
      s.rowsWithoutUserId.length ? `rows without a User Id: ${idList(s.rowsWithoutUserId.map(String), 10)}` : null,
      s.note ?? null,
    ].filter(Boolean);
    lines.push(`  ${s.name}: ${s.role}, ${s.rows} rows, ${s.people} people${extra.length ? ` (${extra.join("; ")})` : ""}`);
  }
  lines.push(
    `People: ${plan.people.length} User Ids with transport data; ${plan.legs.length} legs to write; ` +
      `${plan.packages.length} accommodation packages; ${plan.conflicts.length} skipped (conflicting rows)`,
  );
  lines.push(`  Accommodation packages: ${fmtCounts(countBy(plan.packages, (p) => p.accommodationPackage))}`);

  for (const d of DIRECTIONS) {
    const legs = plan.legs.filter((l) => l.direction === d);
    const svc = d === "ARRIVAL" ? "pickup" : "drop-off";
    lines.push(`${DIRECTION_LABEL[d]}: ${legs.length} legs`);
    lines.push(`  Mode: ${fmtCounts(countBy(legs, (l) => l.mode ?? "(blank)"))}`);
    lines.push(
      `  Need ${svc}: yes ${legs.filter((l) => l.needsService === true).length}, ` +
        `no ${legs.filter((l) => l.needsService === false).length}, blank ${legs.filter((l) => l.needsService === null).length}`,
    );
    lines.push(`  By airport: ${fmtCounts(countBy(legs, (l) => l.airportCode ?? "(none)"))}`);
    lines.push(`  By day: ${fmtCounts(countBy(legs, (l) => l.localDate ?? "(none)"))}`);
    lines.push(`  From: ${fmtCounts(countBy(legs, (l) => l.sourceSheet))}`);
    // Airport x day, with groups.
    const cells = new Map<string, PlannedLeg[]>();
    for (const l of legs) {
      if (!l.airportCode) continue;
      const k = `${l.airportCode} ${l.localDate ?? "(no date)"}`;
      cells.set(k, [...(cells.get(k) ?? []), l]);
    }
    for (const [k, list] of [...cells].sort((a, b) => a[0].localeCompare(b[0]))) {
      const needing = list.filter((l) => l.needsService === true).length;
      const grouped = list.filter((l) => l.groupKey);
      const groups = countBy(grouped, (l) => String(l.groupNumber));
      const groupText = Object.entries(groups)
        .sort((a, b) => Number(a[0]) - Number(b[0]))
        .map(([n, c]) => `G${n}:${c}`)
        .join(" ");
      lines.push(
        `    ${k}: ${list.length} people, ${needing} need ${svc}, ${Object.keys(groups).length} groups` +
          `${grouped.length < list.length ? `, ${list.length - grouped.length} not grouped` : ""}${groupText ? ` [${groupText}]` : ""}`,
      );
    }
  }

  if (plan.mergedDuplicates.length > 0) {
    lines.push(`Duplicate rows with the same transport details (counted once): ${plan.mergedDuplicates.length}`);
    for (const m of plan.mergedDuplicates) lines.push(`  User Id ${m.registrationId} (${m.source}): ${m.rows.join(", ")}`);
  }
  if (plan.conflicts.length > 0) {
    lines.push(`Skipped, rows disagree (no legs written or deleted, no package): ${plan.conflicts.length}`);
    for (const c of plan.conflicts) {
      lines.push(`  User Id ${c.registrationId} (${c.source}: ${c.rows.join(", ")}) differs in ${c.fields.join(", ")}`);
    }
  }

  const tabDis = plan.disagreements.filter((x) => x.used !== "neither (cross-check only)");
  const crossDis = plan.disagreements.filter((x) => x.used === "neither (cross-check only)");
  const printDis = (title: string, list: Disagreement[]) => {
    if (list.length === 0) {
      lines.push(`${title}: none`);
      return;
    }
    const people = new Set(list.map((x) => x.registrationId));
    lines.push(`${title}: ${list.length} fields, ${people.size} people`);
    lines.push(`  By field: ${fmtCounts(countBy(list, (x) => x.field))}`);
    const byPerson = new Map<string, Disagreement[]>();
    for (const x of list) byPerson.set(x.registrationId, [...(byPerson.get(x.registrationId) ?? []), x]);
    for (const [id, xs] of [...byPerson].sort((a, b) => byId(a[0], b[0]))) {
      lines.push(`  User Id ${id}: ${xs.map((x) => `${x.field} [${x.sheet}; uses ${x.used}]`).join(", ")}`);
    }
  };
  printDis("Tab vs full record disagreements", tabDis);
  printDis("Report-only disagreements (the cross-check copy, and a tab's columns for the other direction)", crossDis);

  if (plan.flags.length > 0) {
    lines.push("Flagged (not fixed):");
    for (const f of plan.flags) lines.push(`  ${FLAG_LABELS[f.kind]}: ${f.registrationIds.length}: User Id ${idList(f.registrationIds)}`);
  }
  lines.push(plan.errors.length > 0 ? `Errors (nothing can be written): ${plan.errors.length}` : "Checks: no errors");
  for (const e of plan.errors) lines.push(`  ${e}`);
  return lines;
}

// ---------------------------------------------------------------------------
// Reconciling with the database

/** A transport_legs row as the import reads it. */
export type ExistingLeg = Omit<PlannedLeg, "sortAt" | "sourceSheet"> & { sortAt: Date | null; sourceSheet: string | null };

/** A users row as the import reads it (only what it needs). */
export type ExistingUserRef = { id: string; registrationId: string | null; accommodationPackage: string | null };

export type TransportReconciliation = {
  creates: PlannedLeg[];
  updates: { leg: PlannedLeg; changes: string[] }[];
  unchanged: number;
  /** Legs whose person no longer has that leg in the workbook. */
  deletes: { id: string; registrationId: string; direction: Direction }[];
  /** Legs of people skipped for conflicting rows: left as they are. */
  keptForConflicts: { id: string; registrationId: string; direction: Direction }[];
  packageUpdates: { userId: string; registrationId: string; from: string | null; to: string }[];
  packagesUnchanged: number;
  /** A package on file for someone whose Fee Description is blank or who is not in the full record: kept. */
  packagesKept: string[];
  /** User Ids with legs planned but no users row (stored anyway, linked later by registration_id). */
  notUsers: string[];
};

const legKey = (registrationId: string, direction: Direction) => `${registrationId}|${direction}`;

/**
 * What applying the plan to these rows would do. Legs match by
 * (registration_id, direction); legs of people the plan skipped are never
 * touched. users.accommodation_package is set by registration_id and never
 * cleared.
 */
export function reconcileTransport(
  plan: TransportPlan,
  existing: readonly ExistingLeg[],
  users: readonly ExistingUserRef[],
): TransportReconciliation {
  const r: TransportReconciliation = {
    creates: [],
    updates: [],
    unchanged: 0,
    deletes: [],
    keptForConflicts: [],
    packageUpdates: [],
    packagesUnchanged: 0,
    packagesKept: [],
    notUsers: [],
  };
  const current = new Map(existing.map((l) => [legKey(l.registrationId, l.direction), l]));
  const planned = new Set(plan.legs.map((l) => legKey(l.registrationId, l.direction)));
  const skipped = new Set(plan.conflicts.map((c) => c.registrationId));

  for (const leg of plan.legs) {
    const db = current.get(legKey(leg.registrationId, leg.direction));
    if (!db) {
      r.creates.push(leg);
      continue;
    }
    const changes = LEG_FIELDS.filter((k) => {
      if (k === "sortAt") return (db.sortAt?.toISOString() ?? null) !== leg.sortAt;
      return (db[k] ?? null) !== (leg[k] ?? null);
    }).map((k) => FIELD_LABELS[k]);
    if (changes.length === 0) r.unchanged++;
    else r.updates.push({ leg, changes });
  }
  for (const l of existing) {
    if (planned.has(legKey(l.registrationId, l.direction))) continue;
    const ref = { id: l.id, registrationId: l.registrationId, direction: l.direction };
    if (skipped.has(l.registrationId)) r.keptForConflicts.push(ref);
    else r.deletes.push(ref);
  }

  const userByReg = new Map(users.filter((u) => u.registrationId).map((u) => [u.registrationId!, u]));
  const packaged = new Set<string>();
  for (const p of plan.packages) {
    packaged.add(p.registrationId);
    const u = userByReg.get(p.registrationId);
    if (!u) continue;
    if (u.accommodationPackage === p.accommodationPackage) r.packagesUnchanged++;
    else r.packageUpdates.push({ userId: u.id, registrationId: p.registrationId, from: u.accommodationPackage, to: p.accommodationPackage });
  }
  for (const u of users) {
    if (u.registrationId && u.accommodationPackage !== null && !packaged.has(u.registrationId)) r.packagesKept.push(u.registrationId);
  }
  r.packagesKept.sort(byId);
  r.notUsers = [...new Set(plan.legs.map((l) => l.registrationId))].filter((id) => !userByReg.has(id)).sort(byId);
  return r;
}
