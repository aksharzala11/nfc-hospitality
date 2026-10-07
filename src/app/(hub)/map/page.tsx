import type { Metadata } from "next";
import { MapPinned } from "lucide-react";
import { requireGuest } from "@/lib/auth";
import { trackGender, tracksFor } from "@/lib/admin/announcements";
import { pageNow, type SearchParams } from "@/lib/pageNow";
import { EVENT_NAME } from "@/lib/branding";
import { annotateBreakouts, getBreakoutsForUser, goshthiFor } from "@/lib/schedule";
import { formatDayShort, formatTime } from "@/lib/time";
import { getVenueForPages } from "@/lib/venue/data";
import { venueTrackOf } from "@/lib/venue/route";
import { listedRooms } from "@/lib/venue/directions";
import { aliasCoverage, aliasEntriesFor, normalizeVenueName, splitVenueNames } from "@/lib/venue/aliases";
import { VENUE_ALIAS_ENTRIES, VENUE_ALIAS_TENTATIVE } from "@/lib/venue/aliasTable";
import { hereLinks, mapDeepLink, mapHereLink, mapPlace, mapRules, programmePlaces } from "@/lib/venue/mapPage";
import { HERE_PLACE_RE } from "@/lib/here";
import { welcomeName } from "@/lib/users";
import { HubPageHeader } from "@/components/HubPageHeader";
import { TimeTravelBanner } from "@/components/TimeTravelBanner";
import { VenueMap } from "@/components/map/VenueMap";
import type { MapCoverage, QuickPlace } from "@/components/map/mapTypes";

export const metadata: Metadata = { title: "Venue map" };
export const dynamic = "force-dynamic";

const queryText = (value: string | string[] | undefined, max = 160) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

/**
 * The venue map: every public room of the Edison mandir on its floor under the organisers' name
 * for it ("Ashro", "Sahajanand Hall", "Main Foyer"), search by that name, an event name ("Main
 * Hall") or a room number, and walking directions across floors (stairs, or elevators only when
 * step-free), in 2D per floor or as a 3D stack of floors. Rooms the organisers' plans mark staff
 * only are drawn and named but have no directions.
 *
 * The map comes from the `venue_maps` table (npm run venue:import) or, in local development,
 * VENUE_DATA_FILE (src/lib/venue/data.ts); until then the page says it isn't available yet. The
 * guest's own rooms (their breakout rooms and goshthi room, from the requireGuest() object so
 * mirror testers see the mirrored delegate's) come first as one-tap destinations, resolved
 * through the alias table (src/lib/venue/aliasTable.ts, server only: the browser gets the list
 * aliasEntriesFor() filters to rooms on the map and narrows to the guest's track, so a place with
 * one room per track, "Samp Square", is theirs); an event room nobody has placed on the map yet
 * shows as "not on the map yet". ?to= and ?from= take an event name, a room's name or number, or
 * a map id (the breakouts page links rooms here); ?stepFree=1 opens with Step-free on (the
 * breakouts page's "How to get there" passes it while its switch is on). ?here= is an NFC tag's
 * place (/here/<place>, src/lib/here.ts): the start, opened on its floor as "You are here"; admins
 * see the tag link for each room in its sheet (hereLinks()).
 *
 * Directions follow the organisers' flow rules for the guest's track (getVenueForPages()'s
 * rulesAt(), src/lib/venue/flowRules.ts) in force at the page's time (?now= honoured), or at
 * ?at= (a /breakouts card's link: the session it worked its route out for; mapRules() in
 * src/lib/venue/mapPage.ts): the browser gets only that set, already narrowed (no gender on file:
 * the rules for everyone, either track's doors), and refreshes when a rule's window opens or closes.
 *
 * Directions use only the stairs / elevators on the guest's side (Bhaio right, Behno left;
 * src/lib/venue/route.ts TRACK_SIDE): their track comes from the requireGuest() object's gender
 * (trackGender() / tracksFor(), so a mirror tester gets the mirrored delegate's). Only an account
 * with no gender on file may use every stair and elevator; admins follow their own gender like
 * anyone else (no exemption by role: `guest.role` only adds the admin coverage note).
 *
 * The Pujya Santo view has the same map at /sant/map (src/app/sant/map/page.tsx); the deep links
 * and the Programme places are shared through src/lib/venue/mapPage.ts.
 */
export default async function MapPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const { now, traveling, label } = pageNow(sp);
  const guest = await requireGuest();
  const map = await getVenueForPages();

  const nfc = typeof sp.here === "string" && HERE_PLACE_RE.test(sp.here);
  const destination = queryText(sp.to);
  const programme = queryText(sp.programme);
  const starts = queryText(sp.starts, 40);
  const startsAt = starts ? new Date(starts) : null;
  const routeSummary = destination
    ? programme
      ? sp.active === "1"
        ? `${programme} is happening now in ${destination}.`
        : startsAt && Number.isFinite(startsAt.getTime())
          ? `${programme} starts at ${formatTime(startsAt)} in ${destination}.`
          : `Your next stop is ${programme} in ${destination}.`
      : `Follow the route to ${destination}.`
    : "You are here. Choose any destination below.";

  const header = (
    <>
      {traveling && <TimeTravelBanner label={label} />}
      <HubPageHeader
        eyebrow={nfc ? `Jay Swāminārāyan, ${welcomeName(guest)}` : `${EVENT_NAME} · Edison mandir`}
        title={nfc ? "Your route" : "Venue map"}
        subtitle={nfc ? routeSummary : "Find any room and get directions between floors"}
      />
    </>
  );

  if (!map) {
    return (
      <div>
        {header}
        <section className="card flex flex-col items-center px-6 py-10 text-center">
          <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-ink-100 text-ink-700">
            <MapPinned aria-hidden="true" className="h-5 w-5" />
          </span>
          <h2 className="font-display text-[1.375rem] leading-tight text-ink-900">The venue map isn&rsquo;t available yet</h2>
          <p className="mt-1.5 max-w-xs text-sm leading-relaxed text-ink-500">
            The mandir&rsquo;s floor plans will show here soon, with directions to every room.
          </p>
        </section>
      </div>
    );
  }

  const { venue, index, problems } = map;

  // Their side's stairs / elevators only (Bhaio right, Behno left), by gender whatever their role
  // (admins too); null = no gender on file: all of them. Also which room a per-track place means.
  const track = venueTrackOf(tracksFor(trackGender(guest)));

  // The guest's own rooms: their goshthi room, then their breakout rooms (upcoming first).
  const quick: QuickPlace[] = [];
  const seen = new Set<string>();
  const add = (name: string, context: string) => {
    const key = normalizeVenueName(name);
    if (!key || seen.has(key)) return;
    seen.add(key);
    quick.push(mapPlace(`q-${key}`, name, context, index, track));
  };
  const goshthi = goshthiFor(guest);
  if (goshthi?.room) add(goshthi.room, `Your goshthi group · ${goshthi.label}`);
  const sessions = annotateBreakouts(await getBreakoutsForUser(guest), now);
  const ordered = [...sessions.filter((s) => s.status !== "past"), ...sessions.filter((s) => s.status === "past")];
  for (const s of ordered) {
    const when = `${formatDayShort(s.day).split(",")[0]} ${formatTime(new Date(s.startsAt))}`;
    for (const room of splitVenueNames(s.room)) add(room, `${s.title} · ${when}`);
  }

  // The programme's main places (src/lib/venue/mapPage.ts, shared with /sant/map), one chip per room.
  const places = programmePlaces(index, track);
  // The organisers' flow rules for their track: at a /breakouts card's session (?at=), else now.
  const rules = mapRules(map, sp.at, now, traveling, track);

  let coverage: MapCoverage | null = null;
  if (guest.role === "ADMIN") {
    const c = aliasCoverage(index, VENUE_ALIAS_ENTRIES);
    // Rooms guests can look up (not stairs / elevators) and how many carry the organisers' name.
    const listed = listedRooms(
      venue.levels.flatMap((l) => l.rooms),
      index,
    ).filter((r) => r.kind !== "stair" && r.kind !== "elevator");
    coverage = {
      total: c.total,
      mapped: c.total - c.unmapped.length + c.resolvable.length,
      unmapped: c.unmapped.filter((n) => !c.resolvable.includes(n)),
      tentative: c.mapped.filter((n) => Object.hasOwn(VENUE_ALIAS_TENTATIVE, n)),
      rooms: listed.length,
      namedRooms: listed.filter((r) => r.named).length,
      problems,
    };
  }

  return (
    <div>
      {header}
      <VenueMap
        venue={venue}
        track={track}
        aliases={aliasEntriesFor(index, track)}
        quick={quick}
        places={places}
        initialTo={mapDeepLink(sp.to, index, track)}
        initialFrom={mapDeepLink(sp.from, index, track)}
        initialHere={mapHereLink(sp.here, index)}
        initialStepFree={sp.stepFree === "1"}
        coverage={coverage}
        tagLinks={guest.role === "ADMIN" ? hereLinks(venue, index) : null}
        rules={rules.rules}
        rulesUntil={rules.until}
        rulesNote={rules.note}
      />
    </div>
  );
}
