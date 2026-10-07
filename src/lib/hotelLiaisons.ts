/**
 * Hotel Liaisons: each hotel's points of contact from the rooming team, for
 * delegates with a hotel issue. Shown as "Hotel Liaison" (or "Hotel Liaisons"
 * when there are several) on the /stay card of the hotel a delegate stays at
 * (every liaison of their track, and any for everyone, each with its own Call
 * button) and, read-only, in the hotel headers of the admin rooming board.
 *
 * One `hotel_liaisons` row per liaison: a hotel (a src/lib/hotels.ts key), a
 * track (`audience` BHAIO / BEHNO / ALL) and a sort order; a hotel can have
 * several for one track. The names and phone numbers are the organisers'
 * contacts and live only in the database: they are set with
 * `npm run hotel:liaisons -- --add ...` (scripts/hotel-liaisons.ts), never in
 * code, data files or docs.
 *
 * Server only (Prisma). What leaves this module is plain, serialisable data.
 */
import { cache } from "react";
import { Prisma, type Audience, type Gender } from "@prisma/client";
import { prisma } from "@/lib/db";
import { tracksFor } from "@/lib/admin/announcements";
import { compareHotels } from "@/lib/hotels";
import { formatPhone } from "@/lib/sant";
import { toE164 } from "@/lib/users";

export type HotelLiaisonView = {
  id: string;
  /** Hotel key, e.g. "hampton". */
  hotel: string;
  /** Whose liaison: BHAIO, BEHNO or ALL (everyone at the hotel). */
  audience: Audience;
  name: string;
  /** e.g. "(332) 555-0142" */
  phoneDisplay: string;
  /** e.g. "tel:+13325550142" */
  telHref: string;
};

/**
 * A liaison as a guest sees it on /stay. `forTrack` names the track ("Bhaio" /
 * "Behno") only for a guest with no gender on file, who sees both tracks'
 * liaisons; null otherwise (their own track's, or one for everyone).
 */
export type StayLiaisonView = HotelLiaisonView & { forTrack: "Bhaio" | "Behno" | null };

/** ALL first, then Bhaio, then Behno (after sortOrder). */
const AUDIENCE_ORDER: readonly Audience[] = ["ALL", "BHAIO", "BEHNO"];

/**
 * Every liaison: hotels in display order, then sortOrder, then ALL / Bhaio /
 * Behno, then name (so one track's liaisons read by sortOrder, then name).
 * Empty while the hotel_liaisons table isn't in this database yet (P2021: the
 * schema not pushed), so pages keep working until then. Cached per request.
 */
export const getHotelLiaisons = cache(async (): Promise<HotelLiaisonView[]> => {
  let rows;
  try {
    rows = await prisma.hotelLiaison.findMany();
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2021") return [];
    throw err;
  }
  return rows
    .sort(
      (a, b) =>
        compareHotels(a.hotel, b.hotel) ||
        a.sortOrder - b.sortOrder ||
        AUDIENCE_ORDER.indexOf(a.audience) - AUDIENCE_ORDER.indexOf(b.audience) ||
        a.name.localeCompare(b.name),
    )
    .map((l) => ({
      id: l.id,
      hotel: l.hotel,
      audience: l.audience,
      name: l.name,
      phoneDisplay: formatPhone(l.phone),
      telHref: `tel:${toE164(l.phone) ?? l.phone.replace(/[^\d+]/g, "")}`,
    }));
});

/**
 * The liaisons a guest at `hotelKey` sees, out of `liaisons`: every one of
 * that hotel's rows for everyone (ALL) or for the guest's track, in the order
 * given. `track` is the guest's
 * trackGender() (src/lib/admin/announcements.ts): MALE -> Bhaio, FEMALE ->
 * Behno, null (no gender on file) -> both, like every other track rule, each
 * then marked with its track (forTrack).
 */
export function pickLiaisons(
  liaisons: readonly HotelLiaisonView[],
  hotelKey: string,
  track: Gender | null,
): StayLiaisonView[] {
  const audiences = tracksFor(track);
  return liaisons
    .filter((l) => l.hotel === hotelKey && audiences.includes(l.audience))
    .map((l) => ({
      ...l,
      forTrack: track !== null || l.audience === "ALL" ? null : l.audience === "BHAIO" ? "Bhaio" : "Behno",
    }));
}

/** The liaisons a guest of `track` (trackGender()) at `hotelKey` sees. */
export async function liaisonsFor(hotelKey: string, track: Gender | null): Promise<StayLiaisonView[]> {
  return pickLiaisons(await getHotelLiaisons(), hotelKey, track);
}
