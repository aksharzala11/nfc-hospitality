/**
 * Transport (airport pickups and drop-offs) for the UI: a person's own arrival
 * and departure (getTransportFor) and the admins' board (getTransportBoard).
 * The rows come from the organisers' transport workbook through
 * `npm run transport:import` (rules in src/lib/transportImport.ts).
 *
 * Server only (Prisma). What leaves this module is plain, serialisable data:
 * strings, numbers, booleans and ISO strings, never a whole `users` row.
 *
 * Times: a leg's localDate / localTime are the wall-clock date and time AT
 * THAT AIRPORT, exactly as the sheet gives them (a Calgary arrival is Calgary
 * time). The labels here format those strings as they are, without any time
 * zone conversion; sortAt (an Eastern reading of them) is for ordering only.
 *
 * Legs link to people by users.registration_id (the master list "User Id"),
 * not by a foreign key: a leg whose User Id has no account yet still shows on
 * the board, without a name.
 */
import { cache } from "react";
import { Prisma, type TransportLeg } from "@prisma/client";
import { prisma } from "@/lib/db";
import { expandSevaSelection } from "@/lib/admin/sevaFilter";
import { getUserSevas } from "@/lib/admin/sevaFilterData";
import { formatDayShort } from "@/lib/time";
import { sheetRole } from "@/lib/transportImport";

export type TransportDirection = "ARRIVAL" | "DEPARTURE";

/** "HH:MM" (24 h wall-clock) -> "2:35 PM"; null for anything else. No time zone is involved. */
export function wallClockLabel(localTime: string | null | undefined): string | null {
  const m = localTime?.match(/^(\d{2}):(\d{2})$/);
  if (!m) return null;
  const hour = Number(m[1]);
  if (hour > 23) return null;
  return `${hour % 12 === 0 ? 12 : hour % 12}:${m[2]} ${hour < 12 ? "AM" : "PM"}`;
}

/** "2026-10-08" -> "Thu, Oct 8"; null for anything else, including an impossible date ("2026-10-32"). */
function dateLabel(localDate: string | null): string | null {
  if (!localDate || !/^\d{4}-\d{2}-\d{2}$/.test(localDate)) return null;
  const at = new Date(`${localDate}T12:00:00Z`);
  return !Number.isNaN(at.getTime()) && at.toISOString().slice(0, 10) === localDate ? formatDayShort(localDate) : null;
}

/**
 * Whether a leg came from one of the transport team's airport tabs ("Arrival
 * …" / "Departures …", their working lists) rather than only from the full
 * registration record. Groups only ever come from those tabs, so a leg that
 * isn't on them can't be grouped until the team adds the person to the sheet.
 */
function onTeamList(sourceSheet: string | null): boolean {
  if (!sourceSheet) return false;
  const role = sheetRole(sourceSheet);
  return role === "arrival-tab" || role === "departure-tab";
}

/**
 * Whether an error is Prisma's P2021 ("the table does not exist"): the
 * schema with transport_legs hasn't been pushed to this database yet. Pages
 * treat that as "no transport data" rather than failing.
 */
export function isTransportTableMissing(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2021";
}

// ---------------------------------------------------------------------------
// One person's transport
// ---------------------------------------------------------------------------

/** One arrival or departure, ready for the UI. */
export type TransportLegView = {
  id: string;
  direction: TransportDirection;
  /** "FLYING", "DRIVING", other text as the sheet gave it, or null. */
  mode: string | null;
  /** Needs an airport pickup (arrival) / drop-off (departure); null = the sheet left it blank. */
  needsService: boolean | null;
  /**
   * On the transport team's airport tabs (their working lists), not only in the
   * registration record: only then is a pickup / drop-off actually arranged.
   */
  onTeamList: boolean;
  airportCode: string | null;
  airportName: string | null;
  /** "YYYY-MM-DD", wall-clock at the airport. */
  localDate: string | null;
  /** "HH:MM" (24 h), wall-clock at the airport. */
  localTime: string | null;
  /** e.g. "Thu, Oct 8". */
  dateLabel: string | null;
  /** e.g. "2:35 PM", local to the airport (not converted). */
  timeLabel: string | null;
  /** ISO; localDate + localTime read as Eastern. For ordering only. */
  sortAt: string | null;
  airline: string | null;
  flight: string | null;
  groupNumber: number | null;
  groupKey: string | null;
  /** How many legs share the group (this one included); null when not grouped. */
  groupSize: number | null;
  driverName: string | null;
  /** E.164, for tel: links. */
  driverPhone: string | null;
  /** When the import last changed this leg (ISO). */
  updatedAt: string;
};

export type TransportFor = { arrival: TransportLegView | null; departure: TransportLegView | null };

function legView(l: TransportLeg, groupSize: number | null): TransportLegView {
  return {
    id: l.id,
    direction: l.direction,
    mode: l.mode,
    needsService: l.needsService,
    onTeamList: onTeamList(l.sourceSheet),
    airportCode: l.airportCode,
    airportName: l.airportName,
    localDate: l.localDate,
    localTime: l.localTime,
    dateLabel: dateLabel(l.localDate),
    timeLabel: wallClockLabel(l.localTime),
    sortAt: l.sortAt?.toISOString() ?? null,
    airline: l.airline,
    flight: l.flight,
    groupNumber: l.groupNumber,
    groupKey: l.groupKey,
    groupSize: l.groupKey ? groupSize : null,
    driverName: l.driverName,
    driverPhone: l.driverPhone,
    updatedAt: l.updatedAt.toISOString(),
  };
}

/**
 * A person's arrival and departure by their users.registration_id (null or
 * blank -> neither). Each leg carries its group's size. Null while nothing has
 * been imported yet (like getStayFor()), so pages say the details aren't
 * available yet rather than "no pickup on file" to everyone. Cached per request.
 */
export const getTransportFor = cache(async (registrationId: string | null | undefined): Promise<TransportFor | null> => {
  const id = registrationId?.trim();
  if (!id) return { arrival: null, departure: null };
  const legs = await prisma.transportLeg.findMany({ where: { registrationId: id } });
  if (legs.length === 0) {
    const imported = await prisma.transportLeg.findFirst({ select: { id: true } });
    return imported ? { arrival: null, departure: null } : null;
  }
  const keys = [...new Set(legs.map((l) => l.groupKey).filter((k): k is string => Boolean(k)))];
  const sizes = new Map<string, number>();
  if (keys.length > 0) {
    const rows = await prisma.transportLeg.groupBy({ by: ["groupKey"], where: { groupKey: { in: keys } }, _count: { _all: true } });
    for (const r of rows) if (r.groupKey) sizes.set(r.groupKey, r._count._all);
  }
  const view = (direction: TransportDirection) => {
    const l = legs.find((x) => x.direction === direction);
    return l ? legView(l, l.groupKey ? (sizes.get(l.groupKey) ?? 1) : null) : null;
  };
  return { arrival: view("ARRIVAL"), departure: view("DEPARTURE") };
});

// ---------------------------------------------------------------------------
// The admins' board: days -> airports -> groups -> people
// ---------------------------------------------------------------------------

export type TransportBoardFilters = {
  /**
   * The console seva filter (readSevaFilter(searchParams)); empty = everyone.
   * When set, only legs whose User Id belongs to an account with one of those
   * sevas are shown (people without an account can't match).
   */
  sevas?: readonly string[];
  /** Local date "YYYY-MM-DD"; empty = every day. */
  day?: string | null;
  /** Airport code, e.g. "PHL"; empty = every airport. */
  airport?: string | null;
  /** Only people who need a pickup / drop-off (needsService true). */
  needsServiceOnly?: boolean;
};

export type TransportBoardPerson = {
  legId: string;
  registrationId: string;
  /** users.id, or null when this User Id has no account yet. */
  userId: string | null;
  /** Full name; null without an account. */
  name: string | null;
  bapsId: string | null;
  seva: string | null;
  /** E.164, from the account. */
  phone: string | null;
  mode: string | null;
  needsService: boolean | null;
  /** On the transport team's tabs for this direction (their working lists), not only in the registration record. */
  onTab: boolean;
  airline: string | null;
  flight: string | null;
  localTime: string | null;
  timeLabel: string | null;
  sortAt: string | null;
  driverName: string | null;
  driverPhone: string | null;
};

export type TransportBoardDriver = { name: string | null; phone: string | null };

export type TransportBoardGroup = {
  /** Unique within the board: the groupKey, or "<airport>|<day>|ungrouped". */
  key: string;
  groupKey: string | null;
  number: number | null;
  /** "Group 3", or "Not grouped yet". */
  label: string;
  /** Every leg in the group, whatever the filters (ungrouped: the people listed). */
  size: number;
  /** The group's driver (most common among its legs), or null. */
  driver: TransportBoardDriver | null;
  /** The group's legs name more than one driver. */
  driverConflict: boolean;
  /** Earliest and latest local time among the people listed. */
  firstTimeLabel: string | null;
  lastTimeLabel: string | null;
  needsService: number;
  people: TransportBoardPerson[];
};

export type TransportBoardAirport = {
  code: string | null;
  name: string | null;
  /** The code, or "No airport" (driving, or not given). */
  label: string;
  people: number;
  needsService: number;
  groups: TransportBoardGroup[];
};

export type TransportBoardDay = {
  day: string | null;
  /** "Thu, Oct 8", or "No date". */
  label: string;
  people: number;
  needsService: number;
  airports: TransportBoardAirport[];
};

export type TransportBoardOption = { value: string; label: string; count: number };

export type TransportBoard = {
  direction: TransportDirection;
  days: TransportBoardDay[];
  totals: {
    /** People listed (after every filter). */
    people: number;
    needsService: number;
    grouped: number;
    ungrouped: number;
    /** Grouped people whose group has a driver. */
    withDriver: number;
    /** Listed User Ids without an account. */
    notInApp: number;
  };
  /** Day and airport choices with counts, after the seva filter but before the day / airport filters. */
  dayOptions: TransportBoardOption[];
  airportOptions: TransportBoardOption[];
  /** Whether the seva filter narrowed the board. */
  sevaFiltered: boolean;
};

const PERSON_SELECT = { id: true, registrationId: true, name: true, bapsId: true, seva: true, phone: true } as const;

const byText = (a: string, b: string) => a.localeCompare(b, "en", { numeric: true });

/**
 * The transport board for one direction: days (in date order, "No date"
 * last) -> airports (busiest first, "No airport" last) -> groups (by number,
 * "Not grouped yet" last) -> people (by time, then name). Callers are admin
 * pages and actions (requireAdmin() / getAdmin()): the board lists names and
 * phone numbers. Honours the console seva filter via expandSevaSelection().
 */
export async function getTransportBoard(
  direction: TransportDirection,
  filters: TransportBoardFilters = {},
): Promise<TransportBoard> {
  const picked = (filters.sevas ?? []).map((s) => s.trim()).filter(Boolean);
  const [legs, everySeva] = await Promise.all([
    prisma.transportLeg.findMany({ where: { direction }, orderBy: [{ sortAt: "asc" }, { registrationId: "asc" }] }),
    picked.length > 0 ? getUserSevas() : Promise.resolve([] as string[]),
  ]);
  const users = await prisma.user.findMany({
    where: { registrationId: { in: [...new Set(legs.map((l) => l.registrationId))] } },
    select: PERSON_SELECT,
  });
  const userByReg = new Map(users.map((u) => [u.registrationId!, u]));

  // Group sizes over the whole direction, whatever the filters.
  const groupSize = new Map<string, number>();
  for (const l of legs) if (l.groupKey) groupSize.set(l.groupKey, (groupSize.get(l.groupKey) ?? 0) + 1);

  const { userSevas } = expandSevaSelection(picked, everySeva);
  const sevaSet = new Set(userSevas);
  const sevaFiltered = sevaSet.size > 0;
  const inSeva = sevaFiltered
    ? legs.filter((l) => {
        const u = userByReg.get(l.registrationId);
        return u !== undefined && sevaSet.has(u.seva);
      })
    : legs;

  const dayCounts = new Map<string, number>();
  const airportCounts = new Map<string, number>();
  for (const l of inSeva) {
    if (l.localDate) dayCounts.set(l.localDate, (dayCounts.get(l.localDate) ?? 0) + 1);
    if (l.airportCode) airportCounts.set(l.airportCode, (airportCounts.get(l.airportCode) ?? 0) + 1);
  }
  const dayOptions = [...dayCounts]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([value, count]) => ({ value, label: dateLabel(value) ?? value, count }));
  const airportOptions = [...airportCounts]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([value, count]) => ({ value, label: value, count }));

  const day = filters.day?.trim() || null;
  const airport = filters.airport?.trim().toUpperCase() || null;
  const shown = inSeva.filter(
    (l) =>
      (!day || l.localDate === day) &&
      (!airport || l.airportCode === airport) &&
      (!filters.needsServiceOnly || l.needsService === true),
  );

  const person = (l: TransportLeg): TransportBoardPerson => {
    const u = userByReg.get(l.registrationId);
    return {
      legId: l.id,
      registrationId: l.registrationId,
      userId: u?.id ?? null,
      name: u?.name ?? null,
      bapsId: u?.bapsId ?? null,
      seva: u?.seva ?? null,
      phone: u?.phone ?? null,
      mode: l.mode,
      needsService: l.needsService,
      onTab: onTeamList(l.sourceSheet),
      airline: l.airline,
      flight: l.flight,
      localTime: l.localTime,
      timeLabel: wallClockLabel(l.localTime),
      sortAt: l.sortAt?.toISOString() ?? null,
      driverName: l.driverName,
      driverPhone: l.driverPhone,
    };
  };

  // day -> airport -> group -> legs
  const tree = new Map<string, Map<string, Map<string, TransportLeg[]>>>();
  for (const l of shown) {
    const dKey = l.localDate ?? "";
    const aKey = l.airportCode ?? "";
    const gKey = l.groupKey ?? `${aKey}|${dKey}|ungrouped`;
    const airports = tree.get(dKey) ?? new Map<string, Map<string, TransportLeg[]>>();
    const groups = airports.get(aKey) ?? new Map<string, TransportLeg[]>();
    groups.set(gKey, [...(groups.get(gKey) ?? []), l]);
    airports.set(aKey, groups);
    tree.set(dKey, airports);
  }

  const lastIfBlank = (a: string, b: string) => (a === "" ? 1 : 0) - (b === "" ? 1 : 0);
  const days: TransportBoardDay[] = [...tree]
    .sort((a, b) => lastIfBlank(a[0], b[0]) || a[0].localeCompare(b[0]))
    .map(([dKey, airports]) => {
      const airportList: TransportBoardAirport[] = [...airports].map(([aKey, groups]) => {
        const groupList = [...groups].map(([gKey, list]) => buildGroup(gKey, list, groupSize, person));
        groupList.sort(
          (a, b) =>
            (a.number === null ? 1 : 0) - (b.number === null ? 1 : 0) || (a.number ?? 0) - (b.number ?? 0) || byText(a.key, b.key),
        );
        const first = [...groups.values()][0][0];
        return {
          code: aKey || null,
          name: first.airportName,
          label: aKey || "No airport",
          people: groupList.reduce((n, g) => n + g.people.length, 0),
          needsService: groupList.reduce((n, g) => n + g.needsService, 0),
          groups: groupList,
        };
      });
      airportList.sort(
        (a, b) => lastIfBlank(a.code ?? "", b.code ?? "") || b.people - a.people || byText(a.label, b.label),
      );
      return {
        day: dKey || null,
        label: dateLabel(dKey || null) ?? "No date",
        people: airportList.reduce((n, a) => n + a.people, 0),
        needsService: airportList.reduce((n, a) => n + a.needsService, 0),
        airports: airportList,
      };
    });

  const allGroups = days.flatMap((d) => d.airports.flatMap((a) => a.groups));
  return {
    direction,
    days,
    totals: {
      people: shown.length,
      needsService: shown.filter((l) => l.needsService === true).length,
      grouped: shown.filter((l) => l.groupKey).length,
      ungrouped: shown.filter((l) => !l.groupKey).length,
      withDriver: allGroups.filter((g) => g.groupKey && g.driver).reduce((n, g) => n + g.people.length, 0),
      notInApp: shown.filter((l) => !userByReg.has(l.registrationId)).length,
    },
    dayOptions,
    airportOptions,
    sevaFiltered,
  };
}

function buildGroup(
  key: string,
  legs: TransportLeg[],
  groupSize: ReadonlyMap<string, number>,
  person: (l: TransportLeg) => TransportBoardPerson,
): TransportBoardGroup {
  const people = legs.map(person).sort(
    (a, b) =>
      (a.sortAt ?? "~").localeCompare(b.sortAt ?? "~") ||
      byText(a.name ?? "~", b.name ?? "~") ||
      byText(a.registrationId, b.registrationId),
  );
  const groupKey = legs[0].groupKey;
  const number = groupKey ? legs[0].groupNumber : null;

  // The most common driver among the group's legs (a group should have one).
  const drivers = new Map<string, { driver: TransportBoardDriver; count: number }>();
  for (const l of legs) {
    if (!l.driverName && !l.driverPhone) continue;
    const k = `${(l.driverName ?? "").trim().toLowerCase()}|${l.driverPhone ?? ""}`;
    const entry = drivers.get(k) ?? { driver: { name: l.driverName, phone: l.driverPhone }, count: 0 };
    entry.count++;
    drivers.set(k, entry);
  }
  const ranked = [...drivers.values()].sort((a, b) => b.count - a.count);

  const times = people.map((p) => p.localTime).filter((t): t is string => Boolean(t)).sort();
  return {
    key,
    groupKey,
    number,
    label: number !== null ? `Group ${number}` : "Not grouped yet",
    size: groupKey ? (groupSize.get(groupKey) ?? legs.length) : legs.length,
    driver: groupKey ? (ranked[0]?.driver ?? null) : null,
    driverConflict: ranked.length > 1,
    firstTimeLabel: wallClockLabel(times[0]),
    lastTimeLabel: wallClockLabel(times[times.length - 1]),
    needsService: people.filter((p) => p.needsService === true).length,
    people,
  };
}
