/**
 * The anonymous facet groups every announcement count is made from: how many
 * accounts share one role / gender / seva / region / hotels combination. No
 * names, ids or contact details, so they can go to the browser (the composer's
 * live "Reaches N people"). Hotels are the person's room-group hotels
 * (src/lib/hotelGuests.ts), sorted, [] = no hotel room on file.
 *
 * Server only (Prisma).
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { FacetGroup } from "@/lib/admin/announcements";
import { getHotelsByRegistrationId } from "@/lib/hotelGuests";

/** The facet groups of the accounts `where` selects (default: every account). */
export async function getFacetGroups(where?: Prisma.UserWhereInput): Promise<FacetGroup[]> {
  const [users, hotelsById] = await Promise.all([
    prisma.user.findMany({
      where,
      select: { role: true, gender: true, seva: true, region: true, registrationId: true },
    }),
    getHotelsByRegistrationId(),
  ]);
  const groups = new Map<string, FacetGroup>();
  for (const u of users) {
    const hotels = (u.registrationId ? hotelsById.get(u.registrationId) : undefined) ?? [];
    const key = JSON.stringify([u.role, u.gender, u.seva, u.region, hotels]);
    const group = groups.get(key);
    if (group) group.count += 1;
    else groups.set(key, { role: u.role, gender: u.gender, seva: u.seva, region: u.region, hotels, count: 1 });
  }
  return [...groups.values()];
}
