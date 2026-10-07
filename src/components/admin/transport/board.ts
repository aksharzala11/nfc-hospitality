/**
 * Logic behind the admin transport board (/admin/transport) and its overview
 * card: the URL format (?dir=, ?day=), the buckets an airport splits into
 * (numbered groups, "Not grouped yet", "No pickup needed"), the oddities shown
 * as small warnings, and the counts.
 *
 * Pure and client-safe: only type imports from the server lib
 * (src/lib/transport.ts), so the board's search runs in the browser.
 *
 * The warnings mirror the import's flags (src/lib/transportImport.ts) as far
 * as the board's data allows: they are shown, never fixed. A leg's date and
 * time are the wall-clock AT THAT AIRPORT, exactly as the sheet gives them.
 */
import type {
  TransportBoardAirport,
  TransportBoardDay,
  TransportBoardGroup,
  TransportBoardPerson,
  TransportDirection,
} from "@/lib/transport";
import { withSevaFilter } from "@/lib/admin/sevaFilter";
import { withNow } from "@/components/sant/shell/links";
import { EVENT_DAYS } from "@/lib/time";

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

export type DirectionParam = "arrivals" | "departures";

export const DIRECTION_PARAM = "dir";
export const DAY_PARAM = "day";
/** ?day= values besides a "YYYY-MM-DD" date. */
export const ALL_DAYS = "all";
export const NO_DATE = "none";

const PARAM_OF: Record<TransportDirection, DirectionParam> = { ARRIVAL: "arrivals", DEPARTURE: "departures" };

/** The words that change with the direction. */
export const WORDS: Record<
  TransportDirection,
  { title: string; people: string; service: string; needService: string; noService: string; blank: string; tabs: string }
> = {
  ARRIVAL: {
    title: "Arrivals",
    people: "arrivals",
    service: "pickup",
    needService: "Need pickup",
    noService: "No pickup needed",
    blank: "Need Pickup left blank",
    tabs: "arrival tabs",
  },
  DEPARTURE: {
    title: "Departures",
    people: "departures",
    service: "drop-off",
    needService: "Need drop-off",
    noService: "No drop-off needed",
    blank: "Need Dropoff left blank",
    tabs: "departure tabs",
  },
};

/**
 * With no ?dir=, the board opens on arrivals until Day 3 (Sat, Oct 10), then
 * on departures: arrivals are Wed to Fri, departures from Sat on.
 */
const DEPARTURES_FROM: string = EVENT_DAYS[2];

export function defaultDirection(today: string): TransportDirection {
  return today >= DEPARTURES_FROM ? "DEPARTURE" : "ARRIVAL";
}

type ParamValue = string | string[] | undefined;
const first = (v: ParamValue) => (Array.isArray(v) ? v[0] : v)?.trim() ?? "";

/** ?dir=arrivals / departures, else the default for `today` ("YYYY-MM-DD", event time zone). */
export function readDirection(value: ParamValue, today: string): TransportDirection {
  const v = first(value).toLowerCase();
  if (v === "arrivals" || v === "arrival") return "ARRIVAL";
  if (v === "departures" || v === "departure") return "DEPARTURE";
  return defaultDirection(today);
}

/** ?day=: "all", "none" (legs without a date), a "YYYY-MM-DD" date, or null (not given / unreadable). */
export function readDay(value: ParamValue): string | null {
  const v = first(value).toLowerCase();
  if (v === ALL_DAYS || v === NO_DATE) return v;
  // A real calendar date only ("2026-13-45" would make the date formatters throw).
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const at = new Date(`${v}T12:00:00Z`);
  return !Number.isNaN(at.getTime()) && at.toISOString().slice(0, 10) === v ? v : null;
}

/**
 * A board link with the demo ?now= (while time-travelling) and the console's
 * seva filter kept, e.g. "/admin/transport?dir=arrivals&day=2026-10-08&seva=BM%20RA".
 */
export function transportHref(
  direction: TransportDirection,
  day: string | null,
  keep: { now: string | null; sevas: readonly string[] },
): string {
  const query = [`${DIRECTION_PARAM}=${PARAM_OF[direction]}`];
  if (day) query.push(`${DAY_PARAM}=${encodeURIComponent(day)}`);
  return withSevaFilter(withNow(`/admin/transport?${query.join("&")}`, keep.now), keep.sevas);
}

/** A person's page in the delegate directory, with the same params kept. */
export function directoryHref(bapsId: string, keep: { now: string | null; sevas: readonly string[] }): string {
  return withSevaFilter(withNow(`/admin/delegates?person=${encodeURIComponent(bapsId)}`, keep.now), keep.sevas);
}

// ---------------------------------------------------------------------------
// Buckets
// ---------------------------------------------------------------------------

/** Sure not to need a pickup / drop-off: the sheet says No, or they drive (and the sheet is blank). */
export function needsNoService(p: Pick<TransportBoardPerson, "needsService" | "mode">): boolean {
  return p.needsService === false || (p.needsService === null && p.mode === "DRIVING");
}

export type AirportBuckets = {
  /** The transport team's numbered groups, by number. */
  groups: TransportBoardGroup[];
  /**
   * No group yet, and a pickup / drop-off is (or may be) needed: on the team's
   * tabs without a group number, asked for in the registration but on no tab
   * (needsServiceOffTab), or flying with the need left blank.
   */
  notGrouped: TransportBoardPerson[];
  /** No group, and no pickup / drop-off needed. */
  noService: TransportBoardPerson[];
};

/** Splits an airport's groups: the board lists everyone without a group as one "Not grouped yet" group. */
export function airportBuckets(airport: TransportBoardAirport): AirportBuckets {
  const groups: TransportBoardGroup[] = [];
  const notGrouped: TransportBoardPerson[] = [];
  const noService: TransportBoardPerson[] = [];
  for (const g of airport.groups) {
    if (g.groupKey) {
      groups.push(g);
      continue;
    }
    for (const p of g.people) (needsNoService(p) ? noService : notGrouped).push(p);
  }
  return { groups, notGrouped, noService };
}

// ---------------------------------------------------------------------------
// Warnings (oddities: flagged, never fixed)
// ---------------------------------------------------------------------------

/** Mirrors src/lib/transportImport.ts: airports a pickup / drop-off can reasonably serve from Edison, NJ. */
const AREA_AIRPORTS: ReadonlySet<string> = new Set([
  "PHL", "EWR", "JFK", "LGA", "TTN", "ABE", "HPN", "ISP", "SWF", "ACY", "BWI", "DCA", "IAD",
]);

/** Mirrors src/lib/transportImport.ts: the event days, one either side. */
const EVENT_WINDOW = { from: "2026-10-07", to: "2026-10-12", label: "Oct 7 – 12" };

/** A day outside the event window. Legs without a date are flagged per person instead. */
export function dayWarning(day: string | null): string | null {
  if (!day) return null;
  return day < EVENT_WINDOW.from || day > EVENT_WINDOW.to ? `Outside the event dates (${EVENT_WINDOW.label})` : null;
}

/** An airport outside the area the transport team serves. */
export function airportWarning(code: string | null): string | null {
  return code && !AREA_AIRPORTS.has(code) ? "Outside the NY / NJ / PA / DC area" : null;
}

/**
 * Asked for a pickup / drop-off in the registration but on none of the transport
 * team's tabs for that direction: groups only come from those tabs, so the team
 * has to add them to the sheet (the import's needs-pickup/dropoff-not-on-tab flag).
 */
export function needsServiceOffTab(p: Pick<TransportBoardPerson, "needsService" | "onTab">): boolean {
  return p.needsService === true && !p.onTab;
}

/** Where a person sits on the board, for their warnings. */
export type PersonPlace = {
  direction: TransportDirection;
  day: string | null;
  airportCode: string | null;
  /** In one of the transport team's numbered groups. */
  grouped: boolean;
};

/** The person's own oddities, as short labels. */
export function personWarnings(p: TransportBoardPerson, place: PersonPlace): string[] {
  const words = WORDS[place.direction];
  const flying = p.mode === "FLYING";
  const out: string[] = [];
  if (p.mode && p.mode !== "FLYING" && p.mode !== "DRIVING") out.push(`Mode “${p.mode}”`);
  if (flying && !p.flight) out.push("No flight number");
  if (flying && !place.airportCode) out.push("No airport given");
  if (flying && !place.day) out.push("No date given");
  if (flying && !p.localTime) out.push("No time given");
  if (flying && p.needsService === null) out.push(words.blank);
  if (!place.grouped && needsServiceOffTab(p)) out.push(`Not on the ${words.tabs}: add to the sheet`);
  if (place.grouped && p.needsService === false) out.push(`In a group, but the sheet says no ${words.service}`);
  return out;
}

/** Whether a person carries any warning, their day's and airport's included. */
export function isFlagged(p: TransportBoardPerson, place: PersonPlace): boolean {
  return dayWarning(place.day) !== null || airportWarning(place.airportCode) !== null || personWarnings(p, place).length > 0;
}

// ---------------------------------------------------------------------------
// Counts
// ---------------------------------------------------------------------------

export type BoardSummary = {
  people: number;
  /** needsService true. */
  needService: number;
  /** In a numbered group. */
  grouped: number;
  /** No group yet, and a pickup / drop-off is (or may be) needed. */
  notGrouped: number;
  /** Of those: asked for one in the registration but on none of the team's tabs (needsServiceOffTab). */
  notOnTab: number;
  noService: number;
  groups: number;
  groupsWithDriver: number;
  /** People with any warning (their day's and airport's included). */
  flagged: number;
  /** User Ids without an account. */
  notInApp: number;
};

export function summarize(days: readonly TransportBoardDay[], direction: TransportDirection): BoardSummary {
  const s: BoardSummary = {
    people: 0,
    needService: 0,
    grouped: 0,
    notGrouped: 0,
    notOnTab: 0,
    noService: 0,
    groups: 0,
    groupsWithDriver: 0,
    flagged: 0,
    notInApp: 0,
  };
  for (const day of days) {
    for (const airport of day.airports) {
      const b = airportBuckets(airport);
      s.groups += b.groups.length;
      s.groupsWithDriver += b.groups.filter((g) => g.driver).length;
      s.grouped += b.groups.reduce((n, g) => n + g.people.length, 0);
      s.notGrouped += b.notGrouped.length;
      s.notOnTab += b.notGrouped.filter(needsServiceOffTab).length;
      s.noService += b.noService.length;
      for (const g of airport.groups) {
        const place: PersonPlace = { direction, day: day.day, airportCode: airport.code, grouped: Boolean(g.groupKey) };
        for (const p of g.people) {
          s.people++;
          if (p.needsService === true) s.needService++;
          if (!p.userId) s.notInApp++;
          if (isFlagged(p, place)) s.flagged++;
        }
      }
    }
  }
  return s;
}

/** "1 person" / "3 people". */
export function people(n: number): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? "person" : "people"}`;
}

/** "1 group" / "3 groups" and the like. */
export function plural(n: number, word: string, pluralWord = `${word}s`): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? word : pluralWord}`;
}
