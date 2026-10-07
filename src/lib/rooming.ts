/**
 * Rooming (hotel room groups) for the UI: a delegate's own stay (getStayFor)
 * and the admins' board (getRoomingBoard). The rows come from the organisers'
 * rooming workbook through `npm run rooming:import` (rules in
 * src/lib/roomingImport.ts); hotel names and details from src/lib/hotels.ts.
 *
 * Server only (Prisma). What leaves this module is plain, serialisable data:
 * strings, numbers, booleans and ISO strings, never a whole `users` row.
 *
 * Organiser decisions: the room numbers are ASSIGNMENTS ("Room group N"), not
 * the hotel's room numbers, which come at check-in. A delegate sees their
 * roommates' names only. Stays: WED = the night of Wed, Oct 7 (early
 * arrivals), MAIN = from Thu, Oct 8; someone whose Wednesday room group
 * carries on into Thursday sees one stay "From Wed, Oct 7".
 *
 * Assignments link to people by users.registration_id (the master list "User
 * Id"), not by a foreign key: a roommate whose User Id has no account yet is
 * counted but not named, and shows on the board without a name.
 */
import { cache } from "react";
import { Prisma, type Gender, type RoomAssignment } from "@prisma/client";
import { prisma } from "@/lib/db";
import { expandSevaSelection } from "@/lib/admin/sevaFilter";
import { getUserSevas } from "@/lib/admin/sevaFilterData";
import {
  STAYS,
  STAY_FIRST_NIGHT,
  STAY_LABELS,
  compareHotels,
  hotelInfo,
  roomGroupLabel,
  stayNightsLabel,
  type HotelInfo,
  type Stay,
} from "@/lib/hotels";
import { greetingName } from "@/lib/users";

export type { HotelInfo, Stay } from "@/lib/hotels";

/**
 * Whether an error is Prisma's P2021 ("the table does not exist"): the schema
 * with room_assignments hasn't been pushed to this database yet. Pages treat
 * that as "no rooming data" rather than failing.
 */
export function isRoomingTableMissing(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2021";
}

const byText = (a: string, b: string) => a.localeCompare(b, "en", { numeric: true });
const stayOrder = (a: Stay, b: Stay) => STAYS.indexOf(a) - STAYS.indexOf(b);

// ---------------------------------------------------------------------------
// One person's stay
// ---------------------------------------------------------------------------

export type StayRoommate = {
  /** "First Last" (greetingName()). Only the name and the center of a roommate leave the server. */
  name: string;
  /** Their center (users.center, from the master list), or null when none is on file. */
  center: string | null;
  /**
   * The nights of this stay they share the room group: "ALL", or, for a stay
   * that starts Wednesday, "WED" (Wednesday night only) / "FROM_THU" (they
   * join on Thursday).
   */
  nights: "ALL" | "WED" | "FROM_THU";
};

/** One room group a person stays in, ready for the UI. */
export type RoomStayView = {
  /** The stays this room group covers, in night order: ["WED", "MAIN"] when the Wednesday room carries on. */
  stays: Stay[];
  /** First night, "YYYY-MM-DD". */
  firstNight: string;
  /** "From Wed, Oct 7", "From Thu, Oct 8" or "Night of Wed, Oct 7". */
  nightsLabel: string;
  /** Display name, plus details that stay null until the organisers confirm them. */
  hotel: HotelInfo;
  roomNumber: number;
  /** "Room group 12": an assignment, not the hotel's room number (that comes at check-in). */
  roomLabel: string;
  /** Room group identity of the latest stay, e.g. "MAIN-hampton-12". */
  roomKey: string;
  /** The organisers' bed number within the room group, or null. */
  bed: number | null;
  /** Beds in the room group (the person included). */
  capacity: number;
  /** Roommates with an account, by name. */
  roommates: StayRoommate[];
  /** Roommates without an account in the app yet (counted, not named). */
  roommatesNotInApp: number;
  /** ISO: when the import last changed this person's assignment. */
  updatedAt: string;
};

export type StayFor = {
  /**
   * In night order; empty = no room on file yet. Normally one; two when the
   * Wednesday night is in a different room group from the Thursday one.
   */
  stays: RoomStayView[];
};

/**
 * A person's hotel stay by their users.registration_id (null or blank -> no
 * stays): hotel, room group, from which night, capacity and roommates' names.
 * Null while nothing has been imported yet (room_assignments exists but is
 * empty): the pages then say the details aren't available yet rather than "no
 * room on file" to everyone. Pass only the signed-in user's own registration
 * id. Cached per request.
 */
export const getStayFor = cache(async (registrationId: string | null | undefined): Promise<StayFor | null> => {
  const id = registrationId?.trim();
  if (!id) return { stays: [] };
  const own = await prisma.roomAssignment.findMany({ where: { registrationId: id } });
  if (own.length === 0) {
    const imported = await prisma.roomAssignment.findFirst({ select: { id: true } });
    return imported ? { stays: [] } : null;
  }
  own.sort((a, b) => stayOrder(a.stay, b.stay));

  const mates = await prisma.roomAssignment.findMany({
    where: { roomKey: { in: own.map((a) => a.roomKey) }, registrationId: { not: id } },
    select: { registrationId: true, roomKey: true },
  });
  const mateIds = [...new Set(mates.map((m) => m.registrationId))];
  const users =
    mateIds.length > 0
      ? await prisma.user.findMany({
          where: { registrationId: { in: mateIds } },
          select: { registrationId: true, name: true, displayName: true, center: true },
        })
      : [];
  const nameOf = new Map(
    users.map((u) => [u.registrationId!, { name: greetingName(u), center: u.center?.trim() || null }]),
  );
  const matesIn = (roomKey: string) => new Set(mates.filter((m) => m.roomKey === roomKey).map((m) => m.registrationId));

  const wed = own.find((a) => a.stay === "WED");
  const main = own.find((a) => a.stay === "MAIN");
  const groups: RoomAssignment[][] =
    wed && main && wed.hotel === main.hotel && wed.roomNumber === main.roomNumber ? [[wed, main]] : own.map((a) => [a]);
  return { stays: groups.map((g) => stayView(g, matesIn, nameOf)) };
});

function stayView(
  group: RoomAssignment[],
  matesIn: (roomKey: string) => Set<string>,
  nameOf: ReadonlyMap<string, { name: string; center: string | null }>,
): RoomStayView {
  const stays = group.map((a) => a.stay);
  const latest = group[group.length - 1];
  const nights = new Map<string, StayRoommate["nights"]>();
  if (group.length === 2) {
    const wedIds = matesIn(group[0].roomKey);
    const mainIds = matesIn(group[1].roomKey);
    for (const m of new Set([...wedIds, ...mainIds])) {
      nights.set(m, wedIds.has(m) && mainIds.has(m) ? "ALL" : wedIds.has(m) ? "WED" : "FROM_THU");
    }
  } else {
    for (const m of matesIn(latest.roomKey)) nights.set(m, "ALL");
  }
  const roommates: StayRoommate[] = [];
  let notInApp = 0;
  for (const [m, n] of nights) {
    const mate = nameOf.get(m);
    if (mate) roommates.push({ name: mate.name, center: mate.center, nights: n });
    else notInApp++;
  }
  roommates.sort((a, b) => byText(a.name, b.name));
  const updatedAt = group.reduce((t, a) => (a.updatedAt > t ? a.updatedAt : t), group[0].updatedAt);
  return {
    stays,
    firstNight: STAY_FIRST_NIGHT[stays[0]],
    nightsLabel: stayNightsLabel(stays),
    hotel: hotelInfo(latest.hotel),
    roomNumber: latest.roomNumber,
    roomLabel: roomGroupLabel(latest.roomNumber),
    roomKey: latest.roomKey,
    bed: latest.bed,
    capacity: latest.roomCapacity,
    roommates,
    roommatesNotInApp: notInApp,
    updatedAt: updatedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// The admins' board: hotels -> room groups -> occupants
// ---------------------------------------------------------------------------

/** A person's track: BHAIO (users.gender MALE) or BEHNO (FEMALE). */
export type RoomingTrack = "BHAIO" | "BEHNO";

function trackOf(gender: Gender | null | undefined): RoomingTrack | null {
  return gender === "MALE" ? "BHAIO" : gender === "FEMALE" ? "BEHNO" : null;
}

export type RoomingBoardFilters = {
  /**
   * The console seva filter (readSevaFilter(searchParams)); empty = everyone.
   * When set, only room groups with at least one person of those sevas are
   * listed, with all their occupants (inFilter marks the matching ones).
   * People without an account can't match.
   */
  sevas?: readonly string[];
  /** Which stay; default MAIN (from Thu, Oct 8). */
  stay?: Stay | null;
  /** Hotel key, e.g. "hilton"; empty = every hotel. */
  hotel?: string | null;
  /** Only room groups with an open bed. */
  openBedsOnly?: boolean;
};

export type RoomingBoardOccupant = {
  assignmentId: string;
  registrationId: string;
  /** users.id, or null when this User Id has no account yet. */
  userId: string | null;
  /** Full name; null without an account. */
  name: string | null;
  bapsId: string | null;
  seva: string | null;
  track: RoomingTrack | null;
  /** Master list "Registration Status", e.g. "Registered". */
  status: string | null;
  bed: number | null;
  /** Matches the console seva filter (true when there is none). */
  inFilter: boolean;
  /**
   * Their room group in the other stay (Wednesday on the MAIN board, from
   * Thursday on the WED board): "SAME_ROOM" = this one carries on,
   * "OTHER_ROOM" = a different one (otherStayLabel names it), null = none.
   */
  otherStay: "SAME_ROOM" | "OTHER_ROOM" | null;
  /** "Hampton, Room group 5" when otherStay is OTHER_ROOM. */
  otherStayLabel: string | null;
};

export type RoomingBoardRoom = {
  roomKey: string;
  stay: Stay;
  hotel: string;
  roomNumber: number;
  /** "Room group 12". */
  label: string;
  /** Beds in the room group per the sheet. */
  capacity: number;
  /** Beds with no User Id in the sheet. */
  openBeds: number;
  /** Beds the sheet gives to people the import skipped (a User Id on two bed rows in the stay). */
  heldBeds: number;
  /**
   * The User Id on each held bed, in bed order (one twice when it holds two
   * beds here); empty when only the count is known (an import from before
   * room_groups).
   */
  heldRegistrationIds: string[];
  /** Every occupant, by bed (whatever the filters). */
  occupants: RoomingBoardOccupant[];
  bhaio: number;
  behno: number;
  /** Occupants with an account but no gender on file. */
  noTrack: number;
  /** Occupants without an account. */
  notInApp: number;
  /** Bhaio and Behno share it: fine only as a family / couple room. */
  mixedTrack: boolean;
};

export type RoomingBoardHotel = {
  key: string;
  /** Display name, e.g. "DoubleTree". */
  name: string;
  info: HotelInfo;
  rooms: RoomingBoardRoom[];
  /** Occupants listed. */
  people: number;
  capacity: number;
  openBeds: number;
  mixedRooms: number;
};

/** A room group mixing the tracks, for the board's notes. */
export type RoomingMixedNote = {
  roomKey: string;
  hotel: string;
  hotelName: string;
  roomNumber: number;
  label: string;
  bhaio: number;
  behno: number;
};

export type RoomingBoardOption<T extends string = string> = { value: T; label: string; count: number };

export type RoomingBoard = {
  stay: Stay;
  /** "From Thu, Oct 8" / "Wednesday night (Wed, Oct 7)". */
  stayLabel: string;
  /** Hotels in display order, each with its room groups by number. */
  hotels: RoomingBoardHotel[];
  totals: {
    rooms: number;
    capacity: number;
    openBeds: number;
    heldBeds: number;
    /** Occupants listed (every occupant of the listed rooms). */
    people: number;
    /** Occupants matching the seva filter (= people without one). */
    inFilter: number;
    notInApp: number;
    mixedRooms: number;
  };
  /** Room groups that mix Bhaio and Behno among those listed. */
  mixedTrackNotes: RoomingMixedNote[];
  /** Hotels in this stay with how many people match the seva filter, before the hotel filter. */
  hotelOptions: RoomingBoardOption[];
  /** Both stays with how many people match the seva filter. */
  stayOptions: RoomingBoardOption<Stay>[];
  /** Whether the seva filter narrowed the board. */
  sevaFiltered: boolean;
};

const BOARD_PERSON_SELECT = {
  id: true,
  registrationId: true,
  name: true,
  bapsId: true,
  seva: true,
  gender: true,
  registrationStatus: true,
} as const satisfies Prisma.UserSelect;

/** A room group's own figures, from room_groups or (before it was imported) its assignments. */
type RoomBase = {
  roomKey: string;
  stay: Stay;
  hotel: string;
  roomNumber: number;
  capacity: number;
  openBeds: number;
  /** null: work it out from the occupants (no room_groups row). */
  heldBeds: number | null;
  heldRegistrationIds: string[];
};

/**
 * The rooming board for one stay (default MAIN): hotels (display order) ->
 * room groups (by number) -> occupants (by bed), with open beds, beds held by
 * a sheet conflict and the rooms that mix Bhaio and Behno. Every room group
 * the import stored (room_groups) is listed, even one nobody could be placed
 * in; a room group with assignments but no room_groups row (an import from
 * before that table) is listed from its assignments. Callers are admin pages
 * and actions (requireAdmin() / getAdmin()): the board lists names and BAPS
 * IDs. Honours the console seva filter via expandSevaSelection().
 */
export async function getRoomingBoard(filters: RoomingBoardFilters = {}): Promise<RoomingBoard> {
  const stay: Stay = filters.stay ?? "MAIN";
  const picked = (filters.sevas ?? []).map((s) => s.trim()).filter(Boolean);
  const [rows, groups, everySeva] = await Promise.all([
    prisma.roomAssignment.findMany({ orderBy: [{ roomKey: "asc" }, { bed: "asc" }] }),
    // room_groups not pushed yet: the board still works from the assignments alone.
    prisma.roomGroup.findMany({ where: { stay } }).catch((err: unknown) => {
      if (isRoomingTableMissing(err)) return [];
      throw err;
    }),
    picked.length > 0 ? getUserSevas() : Promise.resolve([] as string[]),
  ]);
  const users = await prisma.user.findMany({
    where: { registrationId: { in: [...new Set(rows.map((r) => r.registrationId))] } },
    select: BOARD_PERSON_SELECT,
  });
  const userByReg = new Map(users.map((u) => [u.registrationId!, u]));

  const { userSevas } = expandSevaSelection(picked, everySeva);
  const sevaSet = new Set(userSevas);
  const sevaFiltered = sevaSet.size > 0;
  const matches = (registrationId: string) => {
    if (!sevaFiltered) return true;
    const u = userByReg.get(registrationId);
    return u !== undefined && sevaSet.has(u.seva);
  };

  // The other stay's room group per person.
  const otherStay: Stay = stay === "MAIN" ? "WED" : "MAIN";
  const otherOf = new Map(rows.filter((r) => r.stay === otherStay).map((r) => [r.registrationId, r]));

  const stayOptions: RoomingBoardOption<Stay>[] = STAYS.map((s) => ({
    value: s,
    label: STAY_LABELS[s],
    count: rows.filter((r) => r.stay === s && matches(r.registrationId)).length,
  }));

  const inStay = rows.filter((r) => r.stay === stay);
  const hotelCounts = new Map<string, number>();
  for (const r of inStay) if (matches(r.registrationId)) hotelCounts.set(r.hotel, (hotelCounts.get(r.hotel) ?? 0) + 1);
  const hotelOptions: RoomingBoardOption[] = [...hotelCounts]
    .sort((a, b) => compareHotels(a[0], b[0]))
    .map(([value, count]) => ({ value, label: hotelInfo(value).name, count }));

  const hotelFilter = filters.hotel?.trim().toLowerCase() || null;
  const byRoom = new Map<string, RoomAssignment[]>();
  for (const r of inStay) {
    if (hotelFilter && r.hotel !== hotelFilter) continue;
    byRoom.set(r.roomKey, [...(byRoom.get(r.roomKey) ?? []), r]);
  }
  const bases = new Map<string, RoomBase>();
  for (const g of groups) {
    if (hotelFilter && g.hotel !== hotelFilter) continue;
    bases.set(g.roomKey, {
      roomKey: g.roomKey,
      stay: g.stay,
      hotel: g.hotel,
      roomNumber: g.roomNumber,
      capacity: g.capacity,
      openBeds: g.openBeds,
      heldBeds: g.heldBeds,
      heldRegistrationIds: g.heldRegistrationIds,
    });
  }
  for (const [roomKey, [first]] of byRoom) {
    if (bases.has(roomKey)) continue;
    bases.set(roomKey, {
      roomKey,
      stay: first.stay,
      hotel: first.hotel,
      roomNumber: first.roomNumber,
      capacity: first.roomCapacity,
      openBeds: first.roomOpenBeds,
      heldBeds: null,
      heldRegistrationIds: [],
    });
  }

  const occupant = (a: RoomAssignment): RoomingBoardOccupant => {
    const u = userByReg.get(a.registrationId);
    const other = otherOf.get(a.registrationId);
    const same = other !== undefined && other.hotel === a.hotel && other.roomNumber === a.roomNumber;
    return {
      assignmentId: a.id,
      registrationId: a.registrationId,
      userId: u?.id ?? null,
      name: u?.name ?? null,
      bapsId: u?.bapsId ?? null,
      seva: u?.seva ?? null,
      track: trackOf(u?.gender),
      status: u?.registrationStatus ?? null,
      bed: a.bed,
      inFilter: matches(a.registrationId),
      otherStay: other === undefined ? null : same ? "SAME_ROOM" : "OTHER_ROOM",
      otherStayLabel: other !== undefined && !same ? `${hotelInfo(other.hotel).name}, ${roomGroupLabel(other.roomNumber)}` : null,
    };
  };

  const roomList: RoomingBoardRoom[] = [];
  for (const base of bases.values()) {
    const occupants = (byRoom.get(base.roomKey) ?? []).map(occupant).sort(
      (a, b) => (a.bed ?? 99) - (b.bed ?? 99) || byText(a.name ?? "~", b.name ?? "~") || byText(a.registrationId, b.registrationId),
    );
    if (sevaFiltered && !occupants.some((o) => o.inFilter)) continue;
    if (filters.openBedsOnly && base.openBeds === 0) continue;
    const bhaio = occupants.filter((o) => o.track === "BHAIO").length;
    const behno = occupants.filter((o) => o.track === "BEHNO").length;
    roomList.push({
      roomKey: base.roomKey,
      stay: base.stay,
      hotel: base.hotel,
      roomNumber: base.roomNumber,
      label: roomGroupLabel(base.roomNumber),
      capacity: base.capacity,
      openBeds: base.openBeds,
      heldBeds: base.heldBeds ?? Math.max(0, base.capacity - base.openBeds - occupants.length),
      heldRegistrationIds: base.heldRegistrationIds,
      occupants,
      bhaio,
      behno,
      noTrack: occupants.filter((o) => o.userId !== null && o.track === null).length,
      notInApp: occupants.filter((o) => o.userId === null).length,
      mixedTrack: bhaio > 0 && behno > 0,
    });
  }
  roomList.sort((a, b) => compareHotels(a.hotel, b.hotel) || a.roomNumber - b.roomNumber);

  const hotels: RoomingBoardHotel[] = [];
  for (const room of roomList) {
    let h = hotels[hotels.length - 1];
    if (!h || h.key !== room.hotel) {
      const info = hotelInfo(room.hotel);
      h = { key: room.hotel, name: info.name, info, rooms: [], people: 0, capacity: 0, openBeds: 0, mixedRooms: 0 };
      hotels.push(h);
    }
    h.rooms.push(room);
    h.people += room.occupants.length;
    h.capacity += room.capacity;
    h.openBeds += room.openBeds;
    if (room.mixedTrack) h.mixedRooms++;
  }

  const mixedTrackNotes: RoomingMixedNote[] = roomList
    .filter((r) => r.mixedTrack)
    .map((r) => ({
      roomKey: r.roomKey,
      hotel: r.hotel,
      hotelName: hotelInfo(r.hotel).name,
      roomNumber: r.roomNumber,
      label: r.label,
      bhaio: r.bhaio,
      behno: r.behno,
    }));

  const all = roomList.flatMap((r) => r.occupants);
  return {
    stay,
    stayLabel: STAY_LABELS[stay],
    hotels,
    totals: {
      rooms: roomList.length,
      capacity: roomList.reduce((n, r) => n + r.capacity, 0),
      openBeds: roomList.reduce((n, r) => n + r.openBeds, 0),
      heldBeds: roomList.reduce((n, r) => n + r.heldBeds, 0),
      people: all.length,
      inFilter: all.filter((o) => o.inFilter).length,
      notInApp: all.filter((o) => o.userId === null).length,
      mixedRooms: mixedTrackNotes.length,
    },
    mixedTrackNotes,
    hotelOptions,
    stayOptions,
    sevaFiltered,
  };
}
