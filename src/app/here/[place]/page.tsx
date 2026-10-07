import { redirect } from "next/navigation";
import { getSession, requireGuest } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { HERE_PLACE_RE, herePath } from "@/lib/here";
import { pageNow, type SearchParams } from "@/lib/pageNow";
import {
  forAudience,
  getBreakoutsForUser,
  getScheduleItems,
  personalizeBreakouts,
  personalizeGoshthi,
} from "@/lib/schedule";
import { getSantSchedules, santVenueTrack } from "@/lib/sant";
import { trackGender, tracksFor } from "@/lib/admin/announcements";
import { getVenueForPages } from "@/lib/venue/data";
import { venueTrackOf } from "@/lib/venue/route";
import { findNfcNextStop } from "@/lib/nfcNextStop";

export const dynamic = "force-dynamic";

/**
 * An NFC tag's link (src/lib/here.ts): opens the venue map with the tag's place as "You are here",
 * on the viewer's own map: /sant/map for a sant, /map for everyone else (delegates, admins, the
 * volunteer account). Signed out, the middleware has already sent them to sign in with this path
 * as `next`; a session that is no longer valid goes the same way, through /api/auth/expired, which
 * clears the cookie. `?now=` is passed on (time travel, for testing).
 */
export default async function HerePage({
  params,
  searchParams,
}: {
  params: Promise<{ place: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const [{ place: raw }, sp] = await Promise.all([params, searchParams]);
  let place = raw;
  try {
    place = decodeURIComponent(raw);
  } catch {
    // Not percent-encoding after all: as given.
  }
  const valid = HERE_PLACE_RE.test(place);
  // The cookie is there (the middleware checked) but no longer valid, or its account is gone:
  // cleared, then sign-in, which comes back here.
  const session = await getSession();
  const account = session ? await prisma.user.findUnique({ where: { id: session.sub }, select: { id: true } }) : null;
  if (!account) redirect(valid ? `/api/auth/expired?next=${encodeURIComponent(herePath(place))}` : "/api/auth/expired");
  const guest = await requireGuest();
  const { now } = pageNow(sp);

  // Resolve the person's programme only after authentication. The NFC tag contains no identity
  // or secret; it says only which public room it is attached to.
  const venueMap = await getVenueForPages(guest.role === "SANT" ? guest : undefined);
  let stop = null;
  if (venueMap) {
    const track = guest.role === "SANT" ? santVenueTrack(guest) : venueTrackOf(tracksFor(trackGender(guest)));
    if (guest.role === "SANT") {
      const schedules = await getSantSchedules(guest.dataUserId, now);
      // A personal appointment wins an overlapping general item; otherwise the helper chooses
      // the first current/next mapped place across both timelines.
      stop = findNfcNextStop(
        [
          ...schedules.personal.map((item) => ({ ...item, nfcPriority: 0 })),
          ...schedules.general.map((item) => ({ ...item, nfcPriority: 1 })),
        ],
        now,
        venueMap.index,
        venueMap.venue,
        track,
      );
    } else {
      const [allItems, sessions] = await Promise.all([
        getScheduleItems(),
        getBreakoutsForUser(guest).catch((err: unknown) => {
          console.error("[here] breakout rooms unavailable:", err);
          return [];
        }),
      ]);
      const items = personalizeBreakouts(personalizeGoshthi(forAudience(allItems, guest.gender), guest), sessions, now);
      stop = findNfcNextStop(items, now, venueMap.index, venueMap.venue, track);
    }
  }

  const query = new URLSearchParams();
  if (valid) query.set("here", place);
  if (typeof sp.now === "string" && sp.now) query.set("now", sp.now);
  if (stop) {
    query.set("to", stop.location);
    query.set("programme", stop.title);
    query.set("starts", stop.startsAt.toISOString());
    if (stop.active) query.set("active", "1");
  }
  const map = guest.role === "SANT" ? "/sant/map" : "/map";
  redirect(query.size > 0 ? `${map}?${query}` : map);
}
