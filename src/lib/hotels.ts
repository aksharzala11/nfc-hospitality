/**
 * The hotels delegates stay at during NAAM 2026, and the nights of each stay.
 * Pure config: no database access, safe in client components.
 *
 * The rooming import (src/lib/roomingImport.ts) keys every room assignment by
 * a HotelKey read from the organisers' "Hotel" column (hotelKeyFor()); the
 * delegate view and the admin board (src/lib/rooming.ts) take the display name
 * and details from here. An unknown hotel in the workbook stops the import
 * until it is added below.
 *
 * Organiser decisions (2026-09-26): delegates see the hotel name now; the full
 * name, address, phone and check-in / check-out times come later, so they are
 * null until confirmed and the UI shows only what is filled in. The workbook's
 * room numbers are ASSIGNMENTS, not hotel room numbers: they are shown as
 * "Room group N" (roomGroupLabel()); real room numbers come at check-in.
 */
import { formatDayShort } from "./time";

export const HOTEL_KEYS = ["hampton", "courtyard", "doubletree", "hilton"] as const;
export type HotelKey = (typeof HOTEL_KEYS)[number];

export type HotelInfo = {
  /** A HotelKey, or the stored key itself for a hotel no longer in this list. */
  key: string;
  /** Short display name, e.g. "DoubleTree". */
  name: string;
  /** Full property name, e.g. "DoubleTree by Hilton ..." (null until confirmed). */
  fullName: string | null;
  /** Street address on one line (null until confirmed). */
  address: string | null;
  /** Front desk, E.164 for tel: links (null until confirmed). */
  phone: string | null;
  /** e.g. "3:00 PM" (null until confirmed). */
  checkInTime: string | null;
  /** e.g. "11:00 AM" (null until confirmed). */
  checkOutTime: string | null;
};

type HotelConfig = Omit<HotelInfo, "key"> & {
  /** How the rooming workbook's "Hotel" column spells it (case, spaces and punctuation ignored). */
  sheetNames: readonly string[];
};

/** In display order: the eBKY hotels, the shared one, then iBKY. */
const HOTEL_CONFIG: Record<HotelKey, HotelConfig> = {
  hampton: {
    name: "Hampton",
    fullName: null,
    address: null,
    phone: null,
    checkInTime: null,
    checkOutTime: null,
    sheetNames: ["Hampton", "Hampton Inn"],
  },
  courtyard: {
    name: "Courtyard",
    fullName: null,
    address: null,
    phone: null,
    checkInTime: null,
    checkOutTime: null,
    sheetNames: ["Courtyard", "Courtyard by Marriott"],
  },
  doubletree: {
    name: "DoubleTree",
    fullName: null,
    address: null,
    phone: null,
    checkInTime: null,
    checkOutTime: null,
    sheetNames: ["DoubleTree", "Double Tree"],
  },
  hilton: {
    name: "Hilton",
    fullName: null,
    address: null,
    phone: null,
    checkInTime: null,
    checkOutTime: null,
    sheetNames: ["Hilton"],
  },
};

export function isHotelKey(value: string | null | undefined): value is HotelKey {
  return (HOTEL_KEYS as readonly string[]).includes(value ?? "");
}

/** Letters and digits only, lower case: "Double Tree", "doubletree" and "DOUBLETREE" share a key. */
function nameKey(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

const KEY_BY_SHEET_NAME: ReadonlyMap<string, HotelKey> = (() => {
  const map = new Map<string, HotelKey>();
  for (const key of HOTEL_KEYS) {
    for (const name of [key, HOTEL_CONFIG[key].name, ...HOTEL_CONFIG[key].sheetNames]) {
      const k = nameKey(name);
      const other = map.get(k);
      if (other && other !== key) throw new Error(`hotels: "${name}" names both ${other} and ${key}`);
      map.set(k, key);
    }
  }
  return map;
})();

/**
 * The hotel a workbook "Hotel" cell names, or null when it names none of
 * them: "Doubletree", "DoubleTree", "double tree" -> "doubletree". Whole names
 * only, so "DoubleTree by Hilton" is not read as the Hilton (add it to
 * sheetNames instead).
 */
export function hotelKeyFor(text: string | null | undefined): HotelKey | null {
  return KEY_BY_SHEET_NAME.get(nameKey(text)) ?? null;
}

/**
 * The one hotel a worksheet's name mentions ("eBKY-iBKY DoubleTree" ->
 * "doubletree"), or null when it mentions none or several. The import's
 * fallback for a blank "Hotel" cell.
 */
export function hotelKeyInText(text: string | null | undefined): HotelKey | null {
  const k = nameKey(text);
  const found = HOTEL_KEYS.filter((key) =>
    [HOTEL_CONFIG[key].name, ...HOTEL_CONFIG[key].sheetNames].some((n) => k.includes(nameKey(n))),
  );
  return found.length === 1 ? found[0] : null;
}

/** Display name and details for a stored hotel key (a key no longer listed shows as itself). */
export function hotelInfo(key: string): HotelInfo {
  if (isHotelKey(key)) {
    const c = HOTEL_CONFIG[key];
    return {
      key,
      name: c.name,
      fullName: c.fullName,
      address: c.address,
      phone: c.phone,
      checkInTime: c.checkInTime,
      checkOutTime: c.checkOutTime,
    };
  }
  return { key, name: key, fullName: null, address: null, phone: null, checkInTime: null, checkOutTime: null };
}

/** Hotels in display order (HOTEL_KEYS first, any other key after, alphabetically). */
export function compareHotels(a: string, b: string): number {
  const ia = HOTEL_KEYS.indexOf(a as HotelKey);
  const ib = HOTEL_KEYS.indexOf(b as HotelKey);
  return (ia === -1 ? HOTEL_KEYS.length : ia) - (ib === -1 ? HOTEL_KEYS.length : ib) || a.localeCompare(b);
}

/** "Room group 12": how the app names the organisers' room assignment number. */
export function roomGroupLabel(roomNumber: number): string {
  return `Room group ${roomNumber}`;
}

// ---------------------------------------------------------------------------
// Stays
// ---------------------------------------------------------------------------

/**
 * Which nights a room assignment covers (the RoomStay enum in
 * prisma/schema.prisma): WED = the night of Wed, Oct 7 (early arrivals);
 * MAIN = from Thu, Oct 8.
 */
export type Stay = "WED" | "MAIN";
export const STAYS: readonly Stay[] = ["WED", "MAIN"];

/** The first night of each stay, "YYYY-MM-DD" (Eastern). */
export const STAY_FIRST_NIGHT: Record<Stay, string> = { WED: "2026-10-07", MAIN: "2026-10-08" };

/** Short names for the admin board and the import report. */
export const STAY_LABELS: Record<Stay, string> = {
  WED: `Wednesday night (${formatDayShort(STAY_FIRST_NIGHT.WED)})`,
  MAIN: `From ${formatDayShort(STAY_FIRST_NIGHT.MAIN)}`,
};

/** "MAIN-hampton-12": a room group's identity (room_assignments.room_key). */
export function roomKeyFor(stay: Stay, hotel: string, roomNumber: number): string {
  return `${stay}-${hotel}-${roomNumber}`;
}

/**
 * How a delegate's nights read for the stays one room group covers:
 *   ["WED", "MAIN"] -> "From Wed, Oct 7"   (the Wednesday room carries on)
 *   ["MAIN"]        -> "From Thu, Oct 8"
 *   ["WED"]         -> "Night of Wed, Oct 7"
 */
export function stayNightsLabel(stays: readonly Stay[]): string {
  if (stays.includes("WED") && !stays.includes("MAIN")) return `Night of ${formatDayShort(STAY_FIRST_NIGHT.WED)}`;
  return `From ${formatDayShort(STAY_FIRST_NIGHT[stays.includes("WED") ? "WED" : "MAIN"])}`;
}
