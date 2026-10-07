/**
 * Who stays at which hotel, for announcements aimed at a hotel's guests
 * (the "hotel" dimension of the rule in src/lib/admin/announcements.ts).
 *
 * A person's hotels are the hotels of their room groups in room_assignments,
 * either stay (the Wednesday night or the main one), found by their User Id
 * (users.registration_id; no foreign key, as everywhere in rooming). Someone
 * without a User Id or without a room group has none. Before the rooming
 * tables are pushed to a database (P2021) nobody has a hotel.
 *
 * Server only (Prisma). What leaves it is hotel keys and User Ids, never names.
 */
import { cache } from "react";
import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";
import { compareHotels } from "@/lib/hotels";

type Db = Pick<PrismaClient, "roomAssignment">;

/** Rows of room_assignments, or none on a database without the table (P2021, as isRoomingTableMissing()). */
async function assignments<T>(read: () => Promise<T[]>): Promise<T[]> {
  try {
    return await read();
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2021") return [];
    throw err;
  }
}

/** The hotel keys of one person's room groups, in hotels.ts order ([] = none). Once per request. */
export const getHotelsOf = cache(async (registrationId: string | null | undefined): Promise<string[]> => {
  if (!registrationId) return [];
  const rows = await assignments(() =>
    prisma.roomAssignment.findMany({ where: { registrationId }, select: { hotel: true } }),
  );
  return [...new Set(rows.map((r) => r.hotel))].sort(compareHotels);
});

/** Every User Id with a room group, with the hotel keys of their room groups (hotels.ts order). */
export async function getHotelsByRegistrationId(db: Db = prisma): Promise<Map<string, string[]>> {
  const rows = await assignments(() =>
    db.roomAssignment.findMany({ select: { registrationId: true, hotel: true } }),
  );
  const out = new Map<string, string[]>();
  for (const r of rows) {
    const hotels = out.get(r.registrationId) ?? [];
    if (!hotels.includes(r.hotel)) hotels.push(r.hotel);
    out.set(r.registrationId, hotels);
  }
  for (const hotels of out.values()) hotels.sort(compareHotels);
  return out;
}

/** The User Ids with a room group at any of these hotels (usersReachedBy()'s `atHotels`). */
export async function registrationIdsAtHotels(hotels: readonly string[], db: Db = prisma): Promise<string[]> {
  if (hotels.length === 0) return [];
  const rows = await assignments(() =>
    db.roomAssignment.findMany({
      where: { hotel: { in: [...hotels] } },
      distinct: ["registrationId"],
      select: { registrationId: true },
    }),
  );
  return rows.map((r) => r.registrationId);
}
